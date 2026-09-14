-- =============================================================================
-- 0016_driver_contacts.sql
--
-- บันทึกการโทรหา พขร. — เก็บเป็นประวัติ (โทรกี่ครั้งก็เก็บแยกแถว ไม่เขียนทับ)
-- กันพนักงานสองคนโทรหาคนเดียวกันซ้ำ และให้คนที่มารับช่วงต่อรู้ว่าติดต่อไปล่าสุด
-- เมื่อไร โดยใคร ผลเป็นอย่างไร
--
-- ตัดสินใจร่วมกับผู้ใช้:
--   ผลการโทร 4 แบบ   รับสาย / ไม่รับสาย / ตอบรับงาน / ปฏิเสธงาน
--   วันเวลาที่โทร     ลงย้อนหลังได้ (โทรตอนเช้า มาบันทึกตอนบ่าย) ค่าเริ่มต้นเป็นตอนนี้
--   ลบ/แก้ไข          ได้ตลอด ไม่มีกรอบเวลา — เจ้าของรายการ หรือ admin
--   บันทึกกิจกรรม     แสดงด้วย
-- =============================================================================

create table driver_contacts (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references drivers(id) on delete cascade,
  caller_id   uuid not null default auth.uid() references profiles(id),
  outcome     text not null
              check (outcome in ('answered', 'no_answer', 'accepted', 'declined')),
  note        text,
  called_at   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index driver_contacts_driver_idx on driver_contacts (driver_id, called_at desc);
create index driver_contacts_caller_idx on driver_contacts (caller_id);

-- -----------------------------------------------------------------------------
-- ตอนแก้ไข: ล็อกเจ้าของรายการ คนขับ และเวลาสร้างไว้ตามเดิมเสมอ
--
-- policy update ตรวจแค่ "ใครแก้ได้" ไม่ได้ตรวจว่า "แก้คอลัมน์ไหน" ถ้าไม่กันไว้ที่นี่
-- คนที่มีสิทธิ์แก้รายการของตัวเองจะเปลี่ยน caller_id เป็นชื่อพนักงานคนอื่นได้
-- (ใส่ความว่าคนอื่นเป็นคนโทร) หรือย้ายรายการไปเป็นของคนขับอีกคน
-- -----------------------------------------------------------------------------
create or replace function fn_driver_contacts_guard() returns trigger
language plpgsql as $$
begin
  new.caller_id  := old.caller_id;
  new.driver_id  := old.driver_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

create trigger driver_contacts_guard
  before update on driver_contacts
  for each row execute function fn_driver_contacts_guard();

-- -----------------------------------------------------------------------------
-- สิทธิ์ — ชุดเดียวกับคนที่ประเมินและเปลี่ยนสถานะได้ (admin / hr / ops)
-- เงื่อนไข can_write_master() อยู่ในทั้งแก้และลบด้วย ไม่ใช่แค่ตอนเพิ่ม เพราะคนที่
-- เคยเป็น ops แล้วถูกลดสิทธิ์เป็น viewer ไม่ควรกลับมาแก้/ลบรายการเก่าของตัวเองได้
-- -----------------------------------------------------------------------------
alter table driver_contacts enable row level security;

create policy driver_contacts_read on driver_contacts
  for select to authenticated
  using (true);

create policy driver_contacts_insert on driver_contacts
  for insert to authenticated
  with check (caller_id = auth.uid() and can_write_master());

create policy driver_contacts_update on driver_contacts
  for update to authenticated
  using      ((caller_id = auth.uid() and can_write_master()) or has_role('admin'))
  with check ((caller_id = auth.uid() and can_write_master()) or has_role('admin'));

create policy driver_contacts_delete on driver_contacts
  for delete to authenticated
  using ((caller_id = auth.uid() and can_write_master()) or has_role('admin'));

grant select, insert, update, delete on driver_contacts to authenticated;

-- -----------------------------------------------------------------------------
-- บันทึกกิจกรรม — เพิ่มสาขาการโทร
--
-- พ่วงแก้ป้ายชื่อที่ค้างมาจากตอนรวมคำทั้งระบบเป็น "ประเมิน": ตารางในหน้าบันทึก
-- กิจกรรมแสดง action_label จาก view นี้ตรง ๆ (ไม่ได้อ่านจาก format.ts) ป้ายจึงยัง
-- เขียนว่า "ให้คะแนน" อยู่ ขณะที่ตัวกรองด้านบนเขียนว่า "ประเมิน" ไปแล้ว
--
-- ข้อจำกัดที่ควรรู้: view นี้รวมจากแถวที่ยังมีอยู่จริง รายการโทรที่ถูกลบจะหายจาก
-- บันทึกกิจกรรมไปด้วย ส่วนรายการที่ถูกแก้จะแสดงค่าล่าสุด ไม่ใช่ค่าก่อนแก้
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
) x
left join profiles ap on ap.id = x.actor_id
where has_role('admin');

grant select on activity_log to authenticated;
