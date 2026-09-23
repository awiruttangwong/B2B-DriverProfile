-- =============================================================================
-- 0031_driver_suspension_duration.sql
--
-- ฟีเจอร์ "พักงาน 30/60/90 วัน" — ตั้งกำหนดเวลาพักงานได้ พอครบกำหนดระบบดึงกลับเป็น
-- "ใช้งาน" ให้เอง ไม่ต้องมีใครมาคอยเปลี่ยนสถานะคืนด้วยมือ
--
-- ไม่พึ่ง pg_cron หรือ job ตามเวลาใด ๆ เลย — ใช้ driver_effective_status() คำนวณสด
-- ทุกครั้งที่ query จึงถูกต้องทันทีที่วันครบกำหนดผ่านไป ไม่มีดีเลย์แม้แต่วินาทีเดียว
-- ไม่ว่าจะมีคนเปิดแอปหรือไม่ก็ตาม ส่วนแถวจริงในตาราง drivers (และประวัติ) จะ "ซ่อมตัวเอง"
-- ทุกครั้งที่มีคนเปิดแอป (เรียก fn_expire_driver_suspensions() ครั้งเดียวตอนแอปโหลด
-- ดู apps/web/src/App.tsx) เพื่อให้ประวัติการเปลี่ยนสถานะมีรายการ "พ้นกำหนด" บันทึกไว้
-- จริง ๆ ด้วย ไม่ใช่แค่ค่าที่ view คำนวณลอย ๆ
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) คอลัมน์ใหม่
-- -----------------------------------------------------------------------------
alter table drivers add column if not exists status_until date;

comment on column drivers.status_until is
  'วันที่พักงานจะครบกำหนดและกลับเป็น active เอง — มีค่าได้เฉพาะตอน status=''inactive''
   เท่านั้น (บังคับด้วย constraint ด้านล่าง) null = พักงานแบบไม่กำหนดเวลา (พฤติกรรมเดิม
   ก่อนมีฟีเจอร์นี้)';

alter table drivers drop constraint if exists drivers_status_until_scope;
alter table drivers add constraint drivers_status_until_scope check (
  status_until is null or status = 'inactive'
);

-- เก็บกำหนดเวลาที่ตั้งไว้ ณ ตอนนั้นไว้ในประวัติด้วย แยกจาก drivers.status_until เพราะ
-- แถวจริงจะถูกเคลียร์ทิ้ง (กลับเป็น null) เมื่อพ้นกำหนดหรือเปลี่ยนสถานะออกจากพักงาน แต่
-- ประวัติต้องยังย้อนดูได้เสมอว่าตอนนั้นตั้งไว้กี่วัน
alter table driver_status_history add column if not exists status_until date;

-- -----------------------------------------------------------------------------
-- 2) ทริกเกอร์บันทึกประวัติ — แก้เงื่อนไข "นับเป็นการเปลี่ยน" และเพิ่มการซ่อนตัวตนผู้สั่ง
--    เฉพาะตอนที่เป็นการปลดพักงานอัตโนมัติ
--
--    เดิม (0004_driver_status.sql) เช็คแค่ new.status is distinct from old.status —
--    ฟีเจอร์ปรับ/ต่อ/ย่นระยะเวลาระหว่างพักงานทำให้ status ยังเป็น 'inactive' เท่าเดิม
--    แค่ status_until เปลี่ยน ถ้าไม่แก้เงื่อนไข การปรับระยะเวลาจะไม่ถูกบันทึกลงประวัติเลย
--
--    เรื่อง "ใครสั่ง": fn_expire_driver_suspensions() ด้านล่างถูกเรียกจาก client ของ
--    พนักงานคนไหนก็ได้ที่บังเอิญเปิดแอปอยู่ตอนนั้น (ไม่ใช่ปุ่มที่เขากด) auth.uid() จะยัง
--    คืนค่าอีเมลของคนนั้นอยู่ดีแม้ฟังก์ชันจะเป็น security definer (auth.uid() อ่านจาก JWT
--    ของ request ไม่เกี่ยวกับสิทธิ์ของฟังก์ชัน) ถ้าไม่กันไว้ ประวัติจะโชว์ผิดว่าเขาเป็นคน
--    สั่งปลด ทั้งที่ไม่ได้กดอะไรเลย จึงให้ fn_expire_driver_suspensions() ตั้งค่าเซสชัน
--    ชั่วคราว app.auto_expire ก่อน แล้วทริกเกอร์เช็คค่านี้เพื่อบันทึก changed_by เป็น null
--    แทน (หน้าเว็บตีความ changed_by ว่างคู่กับ inactive→active ว่าเป็น "ระบบ" อยู่แล้ว)
-- -----------------------------------------------------------------------------
create or replace function fn_log_driver_status_change() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status
     or new.status_until is distinct from old.status_until then
    insert into driver_status_history
      (driver_id, from_status, to_status, reason, status_until, changed_by)
    values (
      new.id, old.status, new.status,
      nullif(btrim(coalesce(new.status_reason, '')), ''),
      new.status_until,
      case when current_setting('app.auto_expire', true) = 'true' then null else auth.uid() end
    );
  end if;
  return new;
end $$;

-- ทริกเกอร์เดิม (0004) ผูกไว้กับ "after update of status" เท่านั้น — คำสั่ง UPDATE ที่แก้แค่
-- status_until (ไม่แตะ status เลย เช่นตอนปรับ/ต่อ/ย่นระยะเวลาโดยสถานะยังเป็นพักงานเหมือนเดิม)
-- จะไม่ยิงทริกเกอร์เลยไม่ว่าตัวฟังก์ชันด้านบนจะเขียนเงื่อนไขถูกแค่ไหนก็ตาม (of <column>
-- ใน CREATE TRIGGER กรองที่ระดับ "จะยิงหรือไม่" ก่อนเข้าฟังก์ชันเสียอีก) ต้องผูกทริกเกอร์
-- กับทั้งสองคอลัมน์ใหม่ด้วย ฟังก์ชันด้านในถึงจะได้ทำงานจริง — พลาดจุดนี้ไปตอนแรก จับได้จาก
-- การทดสอบ PGlite ที่ฟีเจอร์ "ปรับระยะเวลาระหว่างพักงาน" ไม่ถูกบันทึกลงประวัติเลยสักรายการ
drop trigger if exists drivers_log_status on drivers;
create trigger drivers_log_status
  after update of status, status_until on drivers
  for each row execute function fn_log_driver_status_change();

-- driver_status_log ต้องเพิ่มคอลัมน์ใหม่เข้าไปด้วย ไม่งั้นหน้าเว็บ (ประวัติการเปลี่ยนสถานะ,
-- หน้าพักงาน, บันทึกกิจกรรม) จะดึง status_until ไม่ได้เลยแม้ตารางจริงจะมีข้อมูลแล้วก็ตาม
-- ต่อคอลัมน์ท้ายรายการ (ไม่แทรกกลาง) ปลอดภัยสำหรับ create or replace view
create or replace view driver_status_log
with (security_invoker = on) as
select
  h.id,
  h.driver_id,
  h.from_status,
  h.to_status,
  h.reason,
  h.changed_at,
  h.changed_by,
  p.full_name as changed_by_name,
  h.status_until
from driver_status_history h
left join profiles p on p.id = h.changed_by;

grant select on driver_status_log to authenticated;

-- -----------------------------------------------------------------------------
-- 3) สถานะที่แท้จริง ณ ตอนนี้ — จุดศูนย์กลางที่ทุก view/ฟังก์ชันด้านล่างเรียกใช้ร่วมกัน
--    เขียนกฎ "พ้นกำหนดแล้วนับเป็น active" ไว้ที่เดียว ไม่ต้องพ่นเงื่อนไขเดียวกันซ้ำไปทุกจุด
-- -----------------------------------------------------------------------------
create or replace function driver_effective_status(p_status driver_status, p_status_until date)
returns driver_status
language sql stable
as $$
  select case
    when p_status = 'inactive' and p_status_until is not null and p_status_until < current_date
      then 'active'::driver_status
    else p_status
  end
$$;

comment on function driver_effective_status is
  'สถานะที่ควรถือว่าเป็นจริง ณ ขณะนี้ — ต่างจาก drivers.status ตรงที่พักงานที่พ้นกำหนดแล้ว
   จะคำนวณเป็น active ทันที แม้แถวจริงจะยังไม่ถูกเคลียร์ก็ตาม (ดูคอมเมนต์หัวไฟล์)';

-- -----------------------------------------------------------------------------
-- 4) ซ่อมแถวจริง + ประวัติ ให้ตามทันสถานะที่แท้จริง — เรียกจาก client ครั้งเดียวตอนแอปโหลด
--    (fire-and-forget ไม่บล็อกหน้าจอ ความถูกต้องที่ผู้ใช้เห็นมาจากข้อ 3 อยู่แล้วไม่ว่าจะมี
--    ใครเรียกฟังก์ชันนี้หรือไม่) ทำได้แค่ปิดเคสที่ "พ้นกำหนดแล้วจริง ๆ" เท่านั้น จึงปลอดภัย
--    พอจะให้ authenticated ทุก role เรียกได้ ไม่ต้องจำกัดแค่ admin/hr/ops เหมือนการเขียน
--    สถานะเองจากหน้าจอ (เทียบ can_write_master() ที่ policy ของ drivers ใช้อยู่)
-- -----------------------------------------------------------------------------
create or replace function fn_expire_driver_suspensions() returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform set_config('app.auto_expire', 'true', true); -- true = local ต่อทรานแซกชันนี้เท่านั้น
  update drivers
  set status = 'active',
      status_reason = null,
      status_until = null
  where status = 'inactive'
    and status_until is not null
    and status_until < current_date;
end $$;

grant execute on function fn_expire_driver_suspensions() to authenticated;

-- -----------------------------------------------------------------------------
-- 5) driver_directory — ใช้สถานะที่แท้จริงแทน d.status ตรง ๆ (เนื้อหาเดิมทั้งหมดจาก
--    0004_driver_status.sql เปลี่ยนแค่สองบรรทัด status / status_until)
-- -----------------------------------------------------------------------------
drop view if exists driver_directory;
create view driver_directory
with (security_invoker = on) as
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  driver_effective_status(d.status, d.status_until) as status,
  d.status_reason,
  -- พ้นกำหนดแล้ว (แม้แถวจริงยังไม่ถูกซ่อม) ไม่ต้องโชว์วันที่เก่าที่ไม่มีความหมายแล้ว
  case
    when driver_effective_status(d.status, d.status_until) = 'inactive' then d.status_until
    else null
  end as status_until,
  d.employment,
  d.note,
  s.total_jobs,
  s.customer_count,
  s.vehicle_count,
  s.last_job_date,
  s.days_since_last_job,
  s.total_cost,
  s.recent_problem_jobs,
  sc.rating_count,
  sc.raw_score,
  sc.adjusted_score
from drivers d
left join driver_stats s      on s.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id;

grant select on driver_directory to authenticated;

-- -----------------------------------------------------------------------------
-- 6) drivers_pending_review — เนื้อหาเดิมทั้งหมดจาก 0011_driver_level_review.sql
--    เปลี่ยนแค่บรรทัด status / where ให้ใช้สถานะที่แท้จริง คนที่พ้นกำหนดพักงานพอดีต้อง
--    กลับเข้าคิวรอประเมินทันที ไม่ใช่รอให้ทริกเกอร์/แอปมาซ่อมแถวก่อน
-- -----------------------------------------------------------------------------
create or replace view drivers_pending_review
with (security_invoker = on) as
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  driver_effective_status(d.status, d.status_until) as status,
  coalesce(s.total_jobs, 0)    as total_jobs,
  s.last_job_date,
  s.days_since_last_job,
  coalesce(sc.rating_count, 0) as rating_count,
  (coalesce(s.total_jobs, 0) >= 10
   or coalesce(s.days_since_last_job, 2147483647) <= 90) as is_priority
from drivers d
left join driver_stats s      on s.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id
where coalesce(sc.rating_count, 0) = 0
  and driver_effective_status(d.status, d.status_until) in ('active', 'probation');

grant select on drivers_pending_review to authenticated;

-- -----------------------------------------------------------------------------
-- 7) search_drivers() — เนื้อหาเดิมทั้งหมดจาก 0027_search_drivers_vehicle_types.sql
--    เปลี่ยนแค่บรรทัด where ชั้นที่ 1 ให้ใช้สถานะที่แท้จริง คนที่พ้นกำหนดพักงานพอดี
--    ต้องค้นเจอได้ทันทีในหน้าหา พขร. เพื่อเข้ารับงาน — นี่คือจุดที่สำคัญที่สุดของฟีเจอร์นี้
--    ไม่เปลี่ยนพารามิเตอร์/ชนิดผลลัพธ์ จึงใช้ create or replace ได้เลย ไม่ต้อง drop ก่อน
-- -----------------------------------------------------------------------------
create or replace function search_drivers(
  p_customer_code       text    default null,
  p_vehicle_type_code   text    default null,
  p_route_keyword       text    default null,
  p_route_strict        boolean default false,
  p_vehicle_type_strict boolean default true,
  p_customer_strict     boolean default true,
  p_limit               int     default 25
)
returns table (
  driver_id          uuid,
  driver_code        text,
  full_name          text,
  phone              text,
  total_jobs         bigint,
  customer_jobs      bigint,
  vehicle_type_jobs  bigint,
  route_jobs         bigint,
  vehicle_types      jsonb,
  adjusted_score     numeric,
  rating_count       bigint,
  last_job_date      date,
  total_count        bigint
)
language sql stable security invoker
as $$
with rel as (
  select
    a.driver_id,
    count(*) filter (
      where p_customer_code is not null and upper(c.code) = upper(p_customer_code)
    ) as customer_jobs,
    count(*) filter (
      where p_vehicle_type_code is not null and upper(v.code) = upper(p_vehicle_type_code)
    ) as vehicle_type_jobs,
    count(*) filter (
      where p_route_keyword is not null and j.route_raw ilike '%' || p_route_keyword || '%'
    ) as route_jobs
  from job_assignments a
  join jobs j                on j.id = a.job_id
  left join customers c      on c.id = j.customer_id
  left join vehicle_types v  on v.id = j.vehicle_type_id
  where p_customer_code is not null
     or p_vehicle_type_code is not null
     or p_route_keyword is not null
  group by a.driver_id
),
-- ประเภทรถต่อคน (ใช้แสดงผลอย่างเดียว ไม่ยุ่งกับการกรอง/เรียง)
vt_counts as (
  select a.driver_id, v.code as vt_code, count(*) as jobs
  from job_assignments a
  join jobs j                on j.id = a.job_id
  join vehicle_types v       on v.id = j.vehicle_type_id
  left join customers c      on c.id = j.customer_id
  where p_vehicle_type_code is null
    and case
          when p_customer_code is not null then upper(c.code) = upper(p_customer_code)
          when p_route_keyword is not null then j.route_raw ilike '%' || p_route_keyword || '%'
          else true
        end
  group by a.driver_id, v.code
),
vt as (
  select
    driver_id,
    jsonb_agg(jsonb_build_object('code', vt_code, 'jobs', jobs) order by jobs desc, vt_code) as types
  from vt_counts
  group by driver_id
)
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  coalesce(s.total_jobs, 0)          as total_jobs,
  coalesce(r.customer_jobs, 0)       as customer_jobs,
  coalesce(r.vehicle_type_jobs, 0)   as vehicle_type_jobs,
  coalesce(r.route_jobs, 0)          as route_jobs,
  coalesce(t.types, '[]'::jsonb)     as vehicle_types,
  sc.adjusted_score,
  coalesce(sc.rating_count, 0)       as rating_count,
  s.last_job_date,
  count(*) over ()                   as total_count
from drivers d
left join driver_stats s      on s.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id
left join rel r               on r.driver_id = d.id
left join vt t                on t.driver_id = d.id
-- ชั้นที่ 1: กรองแข็ง — ใช้สถานะที่แท้จริง (0031) แทน d.status ตรง ๆ คนที่พ้นกำหนด
-- พักงานพอดีต้องค้นเจอได้ทันที ไม่ต้องรอให้แถวจริงถูกซ่อมก่อน — ยังคงตรงกับ
-- StatusDialog.tsx (เลือกได้แค่ active/probation เป็นสถานะที่ "ค้นหาได้")
where driver_effective_status(d.status, d.status_until) in ('active', 'probation')
  and (
    p_customer_code is null
    or not coalesce(p_customer_strict, true)
    or coalesce(r.customer_jobs, 0) > 0
  )
  and (
    p_vehicle_type_code is null
    or not coalesce(p_vehicle_type_strict, true)
    or coalesce(r.vehicle_type_jobs, 0) > 0
  )
  and (
    not coalesce(p_route_strict, false)
    or p_route_keyword is null
    or coalesce(r.route_jobs, 0) > 0
  )
order by
  coalesce(s.recent_problem_jobs, 0) asc,
  (sc.adjusted_score is not null and sc.adjusted_score < 3.0) asc,
  coalesce(r.customer_jobs, 0) desc,
  coalesce(r.vehicle_type_jobs, 0) desc,
  coalesce(r.route_jobs, 0) desc,
  sc.adjusted_score desc nulls last,
  coalesce(s.total_jobs, 0) desc,
  s.last_job_date desc nulls last
limit greatest(p_limit, 1);
$$;

grant execute on function search_drivers to authenticated;

-- -----------------------------------------------------------------------------
-- 8) activity_log — เนื้อหาเดิมทั้งหมดจาก 0021_activity_log_allowlist.sql เปลี่ยนแค่
--    บรรทัด jsonb_build_object ของ driver_status ให้พ่วง status_until ไปด้วย เพื่อให้
--    หน้าบันทึกกิจกรรม (ฟีดรวมทั้งระบบ) โชว์กำหนดเวลาพักงานเหมือนหน้าประวัติของ พขร.
--    แต่ละคน — ไม่แตะ union อื่นเลยสักบรรทัด
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
    jsonb_build_object(
      'from', h.from_status, 'to', h.to_status, 'reason', h.reason,
      'status_until', h.status_until
    ) as detail
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
where can_see_activity_log();
