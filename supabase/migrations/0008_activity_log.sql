-- =============================================================================
-- 0008_activity_log.sql
-- log กลางของระบบ — ใครทำอะไร เมื่อไร กับข้อมูลไหน
--
-- ไม่สร้างตารางใหม่ให้แอปเขียนเอง เพราะจะเปิดช่องให้ log ขาดหายถ้าแอปลืมเรียก
-- (เหมือนปัญหาที่ driver_status_history เคยแก้ไปแล้ว) ใช้วิธีรวม (union) ร่องรอย
-- ที่ทุกตารางเก็บอยู่แล้วจากคอลัมน์ created_by / rater_id / uploaded_by / changed_by
-- ที่มีอยู่ในระบบมาตั้งแต่ต้น เข้าเป็นมุมมองเดียว
--
-- รองรับ user ใหม่ในอนาคตโดยอัตโนมัติ: การรวมนี้ join กับ profiles ด้วย id
-- ไม่ได้ผูกกับรายชื่อ user ที่ระบุตายตัว ใครก็ตามที่มี profile และทำรายการ
-- จะปรากฏในนี้เอง ไม่ต้องแก้ view เพิ่มเมื่อเพิ่มพนักงานใหม่
-- =============================================================================

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

  -- ให้คะแนนงาน
  select
    'rating:' || r.id::text,
    r.created_at,
    r.rater_id,
    'rating_create',
    'ให้คะแนน พขร.',
    d.full_name,
    'driver',
    d.id,
    jsonb_build_object('score', r.overall_score, 'tags', r.tags, 'reason', r.reason)
  from driver_ratings r
  join drivers d on d.id = r.driver_id

  union all

  -- ยกเลิกใบให้คะแนน (ยังไม่มีปุ่มในหน้าเว็บวันนี้ แต่ policy ratings_admin_void
  -- เปิดให้ admin ทำได้แล้ว — เตรียม log ไว้ล่วงหน้าเผื่อเปิดใช้ทีหลัง)
  select
    'rating_void:' || r.id::text,
    r.voided_at,
    r.voided_by,
    'rating_void',
    'ยกเลิกใบให้คะแนน',
    d.full_name,
    'driver',
    d.id,
    jsonb_build_object('void_reason', r.void_reason)
  from driver_ratings r
  join drivers d on d.id = r.driver_id
  where r.voided_at is not null

  union all

  -- บันทึกงาน — ทั้งกรอกทีละเที่ยวและอัปโหลดไฟล์ไหลผ่าน ingestRows() เส้นเดียวกัน
  -- จึงมีแถวใน import_batches เสมอไม่ว่าจะมาทางไหน (filename = 'กรอกด้วยมือ' สำหรับกรอกมือ)
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

  -- ผู้ใช้งานใหม่เข้าระบบ — โผล่เองทันทีที่ fn_handle_new_user() สร้าง profile ให้
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
) x
left join profiles ap on ap.id = x.actor_id
-- log ของทั้งระบบเป็นข้อมูลกำกับดูแลพนักงาน จำกัดให้ admin เห็นเท่านั้น
-- (เหมือนกับ driver_private และ profiles_admin_all — บังคับที่ฐานข้อมูลชั้นเดียว)
where has_role('admin');

grant select on activity_log to authenticated;
