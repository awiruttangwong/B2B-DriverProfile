-- 0043: หน้า "หา พขร. เพื่อเข้ารับงาน" ฝั่ง EXPRESS ใช้ 4.1 วิ (production) และหน้ารายชื่อ พขร. ~1 วิ
--
-- สาเหตุเดียวกับ 0042: search_drivers อ่านเที่ยวทั้งหมดของฝั่งนั้น 3 รอบต่อการค้นหาหนึ่งครั้ง
-- (driver_stats + rel + vt_counts) และ driver_directory คำนวณ driver_stats ทั้งก้อนทุกครั้งที่เปิดหน้า
--
-- แก้: ตารางสรุป driver_job_combos — 1 แถวต่อ (พขร., ลูกค้า, ประเภทรถ, ทะเบียน, เส้นทาง)
-- ไฟล์ EXPRESS จริง 72,042 เที่ยว → 8,545 แถว ค้นหาอ่านตารางนี้แทน jobs ทั้งหมด
-- trigger ดูแลให้ตรงกับของจริงเสมอ (เพิ่ม = บวกเข้า, ลบ/แก้ = นับใหม่เฉพาะ พขร. ที่เกี่ยว)
--
-- ผลลัพธ์ของ search_drivers และ driver_directory เหมือนเดิมทุกคอลัมน์ ทุกแถว — หน้าเว็บไม่ต้องแก้
-- ต้องรันหลัง 0042 (ใช้ drivers.job_count / job_last_date)
-- ทั้งไฟล์อยู่ใน transaction เดียว: ถ้าบรรทัดไหนล้ม ทุกอย่างยกเลิก ไม่มีอะไรค้างครึ่งทาง

begin;

-- 1) ตารางสรุป ---------------------------------------------------------------
create table if not exists driver_job_combos (
  driver_id        uuid not null references drivers(id) on delete cascade,
  business_line    text not null,
  customer_id      uuid,
  vehicle_type_id  uuid,
  vehicle_id       uuid,
  route_raw        text,
  jobs             integer not null,
  cost_sum         numeric,          -- null = ทุกเที่ยวในกลุ่มไม่มีราคาจ่าย (ให้ sum() รวมแล้วได้ null เหมือนเดิม)
  constraint driver_job_combos_key unique nulls not distinct
    (driver_id, customer_id, vehicle_type_id, vehicle_id, route_raw)
);

create index if not exists driver_job_combos_line_idx on driver_job_combos (business_line);

-- อ่านได้เฉพาะฝั่งตัวเอง (เหมือนทุกตารางใน 0039) เขียนได้เฉพาะ trigger
alter table driver_job_combos enable row level security;
revoke all on driver_job_combos from anon, authenticated;
grant select on driver_job_combos to authenticated;
drop policy if exists driver_job_combos_read on driver_job_combos;
create policy driver_job_combos_read on driver_job_combos for select to authenticated using (true);
drop policy if exists driver_job_combos_line on driver_job_combos;
create policy driver_job_combos_line on driver_job_combos as restrictive for all to authenticated
  using (business_line = (select current_line()))
  with check (business_line = (select current_line()));

-- เที่ยวที่มีปัญหา (ขาดงาน/เกิดเหตุ) มีน้อยมาก — index บางส่วนให้นับสดได้ทันที
create index if not exists job_assignments_problem_idx on job_assignments (driver_id)
  where outcome in ('no_show', 'incident');

-- 2) นับใหม่จากของจริงสำหรับ พขร. ชุดหนึ่ง -------------------------------------
create or replace function fn_refresh_driver_job_combos(p_driver_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from driver_job_combos where driver_id = any(p_driver_ids);
  insert into driver_job_combos
    (driver_id, business_line, customer_id, vehicle_type_id, vehicle_id, route_raw, jobs, cost_sum)
  select a.driver_id, d.business_line, j.customer_id, j.vehicle_type_id, j.vehicle_id, j.route_raw,
         count(*), sum(j.cost)
    from job_assignments a
    join jobs j    on j.id = a.job_id
    join drivers d on d.id = a.driver_id
   where a.driver_id = any(p_driver_ids)
   group by a.driver_id, d.business_line, j.customer_id, j.vehicle_type_id, j.vehicle_id, j.route_raw;
end $$;

-- 3) เพิ่มเที่ยว: บวกเข้า (ไม่ต้องนับใหม่ทั้งหมด — นำเข้าทีละ 1,000 แถวยังเร็ว) -----------
create or replace function fn_combos_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into driver_job_combos as k
    (driver_id, business_line, customer_id, vehicle_type_id, vehicle_id, route_raw, jobs, cost_sum)
  select n.driver_id, d.business_line, j.customer_id, j.vehicle_type_id, j.vehicle_id, j.route_raw,
         count(*), sum(j.cost)
    from new_rows n
    join jobs j    on j.id = n.job_id
    join drivers d on d.id = n.driver_id
   group by n.driver_id, d.business_line, j.customer_id, j.vehicle_type_id, j.vehicle_id, j.route_raw
  on conflict on constraint driver_job_combos_key do update
     set jobs     = k.jobs + excluded.jobs,
         cost_sum = case when k.cost_sum is null and excluded.cost_sum is null then null
                         else coalesce(k.cost_sum, 0) + coalesce(excluded.cost_sum, 0) end;
  return null;
end $$;

-- 4) ลบ/แก้: นับใหม่เฉพาะ พขร. ที่เกี่ยว --------------------------------------
create or replace function fn_combos_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform fn_refresh_driver_job_combos(array(select distinct driver_id from old_rows));
  return null;
end $$;

create or replace function fn_combos_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform fn_refresh_driver_job_combos(array(
    select driver_id from old_rows union select driver_id from new_rows));
  return null;
end $$;

-- แก้ข้อมูลเที่ยว (ลูกค้า/ประเภทรถ/ทะเบียน/เส้นทาง/ราคาจ่าย) → นับใหม่ให้คนขับเที่ยวนั้น
create or replace function fn_combos_after_job_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform fn_refresh_driver_job_combos(array(
    select distinct a.driver_id
      from new_rows n
      join old_rows o on o.id = n.id
      join job_assignments a on a.job_id = n.id
     where (n.customer_id, n.vehicle_type_id, n.vehicle_id, n.route_raw, n.cost)
           is distinct from (o.customer_id, o.vehicle_type_id, o.vehicle_id, o.route_raw, o.cost)));
  return null;
end $$;

revoke execute on function fn_refresh_driver_job_combos(uuid[]) from public, anon, authenticated;
revoke execute on function fn_combos_after_insert()     from public, anon, authenticated;
revoke execute on function fn_combos_after_delete()     from public, anon, authenticated;
revoke execute on function fn_combos_after_update()     from public, anon, authenticated;
revoke execute on function fn_combos_after_job_update() from public, anon, authenticated;

drop trigger if exists job_assignments_combos_ins on job_assignments;
create trigger job_assignments_combos_ins after insert on job_assignments
  referencing new table as new_rows
  for each statement execute function fn_combos_after_insert();

drop trigger if exists job_assignments_combos_del on job_assignments;
create trigger job_assignments_combos_del after delete on job_assignments
  referencing old table as old_rows
  for each statement execute function fn_combos_after_delete();

drop trigger if exists job_assignments_combos_upd on job_assignments;
create trigger job_assignments_combos_upd after update on job_assignments
  referencing old table as old_rows new table as new_rows
  for each statement execute function fn_combos_after_update();

drop trigger if exists jobs_combos_upd on jobs;
create trigger jobs_combos_upd after update on jobs
  referencing old table as old_rows new table as new_rows
  for each statement execute function fn_combos_after_job_update();

-- 5) ตั้งค่าครั้งแรกจากข้อมูลจริงทั้งหมด (ทุกฝั่ง) -----------------------------------
truncate driver_job_combos;
insert into driver_job_combos
  (driver_id, business_line, customer_id, vehicle_type_id, vehicle_id, route_raw, jobs, cost_sum)
select a.driver_id, d.business_line, j.customer_id, j.vehicle_type_id, j.vehicle_id, j.route_raw,
       count(*), sum(j.cost)
  from job_assignments a
  join jobs j    on j.id = a.job_id
  join drivers d on d.id = a.driver_id
 group by a.driver_id, d.business_line, j.customer_id, j.vehicle_type_id, j.vehicle_id, j.route_raw;

-- 6) driver_directory — คอลัมน์/ชนิด/ลำดับเดิมทุกตัว อ่านจากสรุปแทน driver_stats -------------
create or replace view driver_directory
with (security_invoker = on) as
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  driver_effective_status(d.status, d.status_until) as status,
  d.status_reason,
  case
    when driver_effective_status(d.status, d.status_until) = 'inactive' then d.status_until
    else null
  end as status_until,
  d.employment,
  d.note,
  d.job_count::bigint                        as total_jobs,
  coalesce(k.customer_count, 0)              as customer_count,
  coalesce(k.vehicle_count, 0)               as vehicle_count,
  d.job_last_date                            as last_job_date,
  (current_date - d.job_last_date)           as days_since_last_job,
  k.total_cost,
  coalesce(p.recent_problem_jobs, 0)         as recent_problem_jobs,
  sc.rating_count,
  sc.raw_score,
  sc.adjusted_score
from drivers d
left join (
  select driver_id,
         count(distinct customer_id) as customer_count,
         count(distinct vehicle_id)  as vehicle_count,
         sum(cost_sum)               as total_cost
    from driver_job_combos
   group by driver_id
) k on k.driver_id = d.id
left join (
  -- เริ่มจาก index บางส่วนของเที่ยวที่มีปัญหา (มีน้อย) — ไม่งั้น planner ไล่ทุกเที่ยวในปีนั้นก่อน
  with pa as materialized (
    select a.driver_id, a.job_id from job_assignments a where a.outcome in ('no_show', 'incident')
  )
  select pa.driver_id, count(*) as recent_problem_jobs
    from pa
    join jobs j on j.id = pa.job_id
   where j.job_date > current_date - interval '12 months'
   group by pa.driver_id
) p on p.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id;

-- 7) search_drivers — พารามิเตอร์/ผลลัพธ์/ตรรกะกรองและเรียงเดิมทุกข้อ (จาก 0031) ----------
--    เปลี่ยนแค่แหล่งข้อมูล: rel/vt_counts อ่าน driver_job_combos (นับ jobs แทน count(*))
--    driver_stats → drivers.job_count / job_last_date + นับเที่ยวมีปัญหาสด
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
set search_path = public
as $$
with rel as (
  select
    k.driver_id,
    coalesce(sum(k.jobs) filter (
      where p_customer_code is not null and upper(c.code) = upper(p_customer_code)
    ), 0)::bigint as customer_jobs,
    coalesce(sum(k.jobs) filter (
      where p_vehicle_type_code is not null and upper(v.code) = upper(p_vehicle_type_code)
    ), 0)::bigint as vehicle_type_jobs,
    coalesce(sum(k.jobs) filter (
      where p_route_keyword is not null and k.route_raw ilike '%' || p_route_keyword || '%'
    ), 0)::bigint as route_jobs
  from driver_job_combos k
  left join customers c      on c.id = k.customer_id
  left join vehicle_types v  on v.id = k.vehicle_type_id
  where p_customer_code is not null
     or p_vehicle_type_code is not null
     or p_route_keyword is not null
  group by k.driver_id
),
vt_counts as (
  select k.driver_id, v.code as vt_code, sum(k.jobs)::bigint as jobs
  from driver_job_combos k
  join vehicle_types v       on v.id = k.vehicle_type_id
  left join customers c      on c.id = k.customer_id
  where p_vehicle_type_code is null
    and case
          when p_customer_code is not null then upper(c.code) = upper(p_customer_code)
          when p_route_keyword is not null then k.route_raw ilike '%' || p_route_keyword || '%'
          else true
        end
  group by k.driver_id, v.code
),
vt as (
  select
    driver_id,
    jsonb_agg(jsonb_build_object('code', vt_code, 'jobs', jobs) order by jobs desc, vt_code) as types
  from vt_counts
  group by driver_id
),
prob_a as materialized (
  -- เริ่มจาก index บางส่วนของเที่ยวที่มีปัญหา (มีน้อย) — ไม่งั้น planner ไล่ทุกเที่ยวในปีนั้นก่อน
  select a.driver_id, a.job_id from job_assignments a where a.outcome in ('no_show', 'incident')
),
prob as (
  select pa.driver_id, count(*) as recent_problem_jobs
    from prob_a pa
    join jobs j on j.id = pa.job_id
   where j.job_date > current_date - interval '12 months'
   group by pa.driver_id
)
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  d.job_count::bigint                as total_jobs,
  coalesce(r.customer_jobs, 0)       as customer_jobs,
  coalesce(r.vehicle_type_jobs, 0)   as vehicle_type_jobs,
  coalesce(r.route_jobs, 0)          as route_jobs,
  coalesce(t.types, '[]'::jsonb)     as vehicle_types,
  sc.adjusted_score,
  coalesce(sc.rating_count, 0)       as rating_count,
  d.job_last_date                    as last_job_date,
  count(*) over ()                   as total_count
from drivers d
left join prob p              on p.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id
left join rel r               on r.driver_id = d.id
left join vt t                on t.driver_id = d.id
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
  coalesce(p.recent_problem_jobs, 0) asc,
  (sc.adjusted_score is not null and sc.adjusted_score < 3.0) asc,
  coalesce(r.customer_jobs, 0) desc,
  coalesce(r.vehicle_type_jobs, 0) desc,
  coalesce(r.route_jobs, 0) desc,
  sc.adjusted_score desc nulls last,
  d.job_count desc,
  d.job_last_date desc nulls last
limit greatest(p_limit, 1);
$$;

commit;
