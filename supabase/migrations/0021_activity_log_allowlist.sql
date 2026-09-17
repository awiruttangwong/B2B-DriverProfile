-- =============================================================================
-- 0021_activity_log_allowlist.sql
--
-- จำกัดสิทธิ์ดูบันทึกกิจกรรม จากเดิม "admin ทุกคน" ให้เหลือเฉพาะ 3 อีเมลที่ระบุ
-- เท่านั้น (ไม่ผูกกับ role อีกต่อไป — ถึงเป็น admin ถ้าไม่ใช่ 3 คนนี้ก็เห็นไม่ได้)
-- บังคับที่ view ชั้นเดียวเหมือนเดิม หน้าเว็บแค่ซ่อนเมนูให้สวยงาม
-- =============================================================================

create or replace function can_see_activity_log() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active
      and lower(email) = any(array[
        'kritpat.t@2klogistics.co.th',
        'awirut.tan@2klogistics.co.th',
        'datacenter@2klogistics.co.th'
      ])
  )
$$;

grant execute on function can_see_activity_log to authenticated;

-- ต้องเขียน view ทั้งตัวใหม่ (create or replace view แก้ทีละบรรทัดไม่ได้) —
-- เนื้อหาเหมือน 0016_driver_contacts.sql ทุกประการ เปลี่ยนแค่บรรทัด where สุดท้าย
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
) x
left join profiles ap on ap.id = x.actor_id
-- เดิม where has_role('admin') — เปลี่ยนเป็น allowlist 3 อีเมลตามที่ตกลงกัน
where can_see_activity_log();

grant select on activity_log to authenticated;
