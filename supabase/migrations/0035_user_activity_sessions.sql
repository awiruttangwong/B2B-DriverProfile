-- =============================================================================
-- 0035_user_activity_sessions.sql
--
-- เพิ่มประเภทกิจกรรมใหม่ "เข้าใช้งานระบบ" ในหน้าบันทึกกิจกรรม — เก็บเวลาเข้า เวลาออก และ
-- ระยะเวลาที่อยู่ในระบบต่อครั้งที่เปิดแอป
--
-- จุดยาก: ระบบตั้ง persistSession ไว้ คนส่วนใหญ่ปิดแท็บ/เบราว์เซอร์ทิ้งเฉย ๆ ไม่กดปุ่ม
-- "ออกจากระบบ" ก่อน ถ้าอิงแค่ event ออกจากระบบจริงจะได้ "เวลาออก" ว่างเปล่าสำหรับเกือบทุกคน —
-- ตกลงกับผู้ใช้แล้วว่าใช้แนวทาง heartbeat: แท็บที่เปิดอยู่ส่งสัญญาณ "ยังอยู่" เข้ามาเป็นระยะ ๆ
-- (last_seen_at) แล้วใช้เวลาสัญญาณล่าสุดเป็นตัวประมาณเวลาออกในกรณีที่ไม่มีการกดออกจากระบบจริง
-- (logout_at เป็น null) — หน้าเว็บ (ActivityLog.tsx) จะติดป้าย "ประมาณ" ให้ชัดเจนในกรณีนี้
-- ไม่ได้หลอกว่ารู้เวลาออกที่แม่นยำ
--
-- ตั้งชื่อ user_activity_sessions ไม่ใช่ user_sessions เฉย ๆ — กันสับสนกับ auth.sessions
-- ภายในของ Supabase เอง (คนละตารางคนละ schema แต่ชื่อสับสนได้ถ้าตั้งซ้ำ)
-- =============================================================================

create table user_activity_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references profiles(id) on delete cascade,
  login_at      timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),  -- heartbeat อัปเดตทุกครั้งที่แท็บยังเปิด+เห็นอยู่
  logout_at     timestamptz  -- null = ไม่มีการกดออกจากระบบจริง ต้องอนุมานจาก last_seen_at แทน
);

create index user_activity_sessions_user_idx on user_activity_sessions (user_id, login_at desc);

alter table user_activity_sessions enable row level security;

-- insert/update แถวของตัวเองได้เท่านั้น (รูปแบบเดียวกับ driver_favorites ใน 0034 — private ต่อ user)
-- ไม่มี delete policy — session log เป็นบันทึกถาวร ไม่มีเหตุผลให้ผู้ใช้ลบของตัวเองได้
create policy user_activity_sessions_insert on user_activity_sessions for insert to authenticated
  with check (user_id = auth.uid());

create policy user_activity_sessions_update on user_activity_sessions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- select: can_see_activity_log() (0021) เห็นทุกคน + เจ้าของแถวเห็นของตัวเองได้เสมอ
--
-- เดิมตั้งใจให้ select จำกัดแค่ can_see_activity_log() เท่านั้น (ข้อมูลนี้คือเวลาเข้า/ออกของ
-- พนักงาน อยากล็อกให้แคบที่สุด) แต่ทดสอบด้วย PGlite แล้วพบว่าใช้ไม่ได้จริง: UPDATE (ที่ heartbeat/
-- markLoggedOut ต้องใช้) ต้องอาศัย USING ของ policy update เพื่อ "มองเห็น" แถวที่จะแก้ก็จริง แต่
-- Postgres ยังต้องให้แถวนั้นผ่าน select policy ด้วยถึงจะนับว่ามองเห็น — ถ้า select policy ไม่รวม
-- user_id = auth.uid() แล้ว UPDATE ของเจ้าของแถวเองจะเงียบ ๆ ไม่โดน error แต่ affected 0 แถวเสมอ
-- (พิสูจน์แล้วด้วย PGlite: เพิ่ม user_id = auth.uid() เข้า select policy ถึงจะ UPDATE ติด)
-- จึงต้องเปิดให้เจ้าของเห็นแถวตัวเองด้วย — ไม่ใช่ช่องโหว่ความเป็นส่วนตัว เพราะผู้ใช้ก็รู้เวลา
-- เข้า/ออกของตัวเองอยู่แล้วโดยธรรมชาติ (เป็นคนกดเข้า/ออกเอง) สิ่งที่ยังปิดอยู่คือเห็นของคนอื่น
create policy user_activity_sessions_read on user_activity_sessions for select to authenticated
  using (can_see_activity_log() or user_id = auth.uid());

grant select, insert, update on user_activity_sessions to authenticated;

-- -----------------------------------------------------------------------------
-- เพิ่ม branch ใหม่เข้า view activity_log — ต้อง create or replace view ใหม่ทั้งก้อน (แก้ทีละ
-- บรรทัดไม่ได้) เนื้อหาเดิมทั้งหมดคัดลอกมาจาก 0021_activity_log_allowlist.sql เป๊ะ เปลี่ยนแค่
-- เพิ่ม union all ก้อนสุดท้ายเข้าไปหนึ่งก้อน
-- -----------------------------------------------------------------------------
create or replace view activity_log
with (security_invoker = on) as
select
  x.id,
  x.at,
  x.actor_id,
  ap.full_name as actor_name,
  ap.email     as actor_email,
  ap.role      as actor_role,
  x.action,
  x.action_label,
  x.target_label,
  x.target_type,
  x.target_id,
  x.detail
from (
  -- เปลี่ยนสถานะ พขร. (ทริกเกอร์ fn_log_driver_status_change บันทึกให้)
  select
    'status:' || h.id::text            as id,
    h.changed_at                       as at,
    h.changed_by                       as actor_id,
    'driver_status'                    as action,
    'เปลี่ยนสถานะ พขร.'                  as action_label,
    d.full_name                        as target_label,
    'driver'                           as target_type,
    d.id                               as target_id,
    jsonb_build_object('from', h.from_status, 'to', h.to_status, 'reason', h.reason) as detail
  from driver_status_history h
  join drivers d on d.id = h.driver_id

  union all

  -- ประเมิน พขร.
  select
    'rating:' || r.id::text,
    r.created_at,
    r.rater_id,
    'rating_create',
    'ประเมิน พขร.',
    d.full_name,
    'driver',
    d.id,
    jsonb_build_object('score', r.overall_score, 'tags', r.tags, 'reason', r.reason)
  from driver_ratings r
  join drivers d on d.id = r.driver_id

  union all

  -- ยกเลิกใบประเมิน (ยังไม่มีปุ่มในหน้าเว็บ แต่ policy ratings_admin_void เปิดให้ admin
  -- ทำได้แล้ว — เตรียม log ไว้ล่วงหน้าเผื่อเปิดใช้ทีหลัง)
  select
    'rating_void:' || r.id::text,
    r.voided_at,
    r.voided_by,
    'rating_void',
    'ยกเลิกใบประเมิน',
    d.full_name,
    'driver',
    d.id,
    jsonb_build_object('void_reason', r.void_reason)
  from driver_ratings r
  join drivers d on d.id = r.driver_id
  where r.voided_at is not null

  union all

  -- บันทึกงาน — ทั้งกรอกทีละเที่ยวและอัปโหลดไฟล์ไหลผ่าน ingestRows() เส้นเดียวกัน
  select
    'batch:' || b.id::text,
    b.created_at,
    b.uploaded_by,
    'job_import',
    case when b.filename = 'กรอกด้วยมือ' then 'บันทึกงานด้วยมือ' else 'อัปโหลดไฟล์งาน' end,
    b.filename,
    'batch',
    b.id,
    jsonb_build_object(
      'row_total', b.row_total, 'row_inserted', b.row_inserted,
      'row_skipped', b.row_skipped, 'row_failed', b.row_failed, 'status', b.status
    )
  from import_batches b

  union all

  -- ผู้ใช้งานใหม่เข้าระบบ
  select
    'user:' || p.id::text,
    p.created_at,
    p.id,
    'user_join',
    'ผู้ใช้งานใหม่เข้าระบบ',
    coalesce(p.full_name, p.email, '-'),
    'user',
    p.id,
    jsonb_build_object('role', p.role, 'email', p.email)
  from profiles p

  union all

  -- บันทึกการโทรหา พขร. — ใช้ created_at (เวลาที่บันทึก) เป็นเวลาของกิจกรรม เพราะ
  -- หน้านี้คือไทม์ไลน์ว่าใครทำอะไรในระบบเมื่อไร ส่วนเวลาที่โทรจริงอยู่ใน detail
  select
    'contact:' || c.id::text,
    c.created_at,
    c.caller_id,
    'driver_contact',
    'บันทึกการโทร',
    d.full_name,
    'driver',
    d.id,
    jsonb_build_object('outcome', c.outcome, 'note', c.note, 'called_at', c.called_at)
  from driver_contacts c
  join drivers d on d.id = c.driver_id

  union all

  -- เข้าใช้งานระบบ — หนึ่งแถวต่อหนึ่ง session (หนึ่งครั้งที่เปิดแอป) ไม่ใช่แยก login/logout
  -- เป็นคนละแถว เพื่อให้อ่านระยะเวลารวมได้จากแถวเดียว เวลา "at" คือ login_at (จุดเริ่มกิจกรรม)
  -- เวลาออก/ระยะเวลาอยู่ใน detail ให้หน้าเว็บคำนวณเอง (ดูคอมเมนต์หัวไฟล์เรื่อง logout_at ที่
  -- อาจเป็น null)
  select
    'session:' || s.id::text,
    s.login_at,
    s.user_id,
    'login_session',
    'เข้าใช้งานระบบ',
    coalesce(p2.full_name, p2.email, '-'),
    'user',
    s.user_id,
    jsonb_build_object('logout_at', s.logout_at, 'last_seen_at', s.last_seen_at)
  from user_activity_sessions s
  join profiles p2 on p2.id = s.user_id
) x
left join profiles ap on ap.id = x.actor_id
where can_see_activity_log();

grant select on activity_log to authenticated;
