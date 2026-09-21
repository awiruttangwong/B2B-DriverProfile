-- =============================================================================
-- 0023_search_drivers_route_strict.sql
--
-- หน้า "หา พขร. เพื่อเข้ารับงาน" ให้ยืดหยุ่นขึ้น 2 อย่าง
--
-- 1) สวิตช์ "เฉพาะคนที่เคยวิ่งเส้นทางนี้" (p_route_strict)
--    0019 ตั้งใจให้เส้นทางเป็นแค่ตัวจัดลำดับ ไม่ตัดใครออก เพราะเป็นช่องพิมพ์อิสระ
--    สะกดไม่ตรงกับที่บันทึกไว้แล้วคนที่เคยวิ่งจริงจะหายไปเงียบ ๆ — ยังคงเป็นค่าเริ่มต้น
--    (false) เหมือนเดิมทุกประการ แต่ผู้ใช้เปิดสวิตช์เองได้เมื่ออยากกรองเข้ม เช่น ค้นด้วย
--    เส้นทางอย่างเดียวแล้วต้องการเห็นเฉพาะคนที่เคยวิ่งจริง
--
-- 2) view job_customer_vehicle_pairs — คู่ (ลูกค้า, ประเภทรถ) ที่เคยมีงานจริง
--    ให้หน้าเว็บใช้แคบตัวเลือกของสองช่องนี้หากันได้ทั้งสองทาง (เลือกช่องไหนก่อนก็ได้)
--    ก่อนหน้านี้แคบได้ทางเดียว (ลูกค้า → ประเภทรถ) และต้องดึงแถว jobs ทีละสูงสุด
--    10,000 แถวมาสรุปในเบราว์เซอร์ทุกครั้งที่เปลี่ยนลูกค้า
--
-- ต้อง drop ลายเซ็นเดิมก่อน ไม่งั้นจะเหลือฟังก์ชันสองตัวชื่อเดียวกัน (ตัวใหม่มี default
-- ครบทุกตัวที่เพิ่ม) แล้ว PostgREST เรียกแบบระบุชื่อพารามิเตอร์ชุดเดิมจะกำกวมว่าเป็นตัวไหน
-- =============================================================================

create view job_customer_vehicle_pairs
with (security_invoker = on) as
select distinct
  c.code as customer_code,
  v.code as vehicle_type_code,
  v.name as vehicle_type_name
from jobs j
join customers c     on c.id = j.customer_id
join vehicle_types v on v.id = j.vehicle_type_id;

grant select on job_customer_vehicle_pairs to authenticated;

drop function if exists search_drivers(text, text, text, int);

create function search_drivers(
  p_customer_code     text    default null,
  p_vehicle_type_code text    default null,
  p_route_keyword     text    default null,
  p_route_strict      boolean default false,
  p_limit             int     default 25
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
  sc.adjusted_score,
  coalesce(sc.rating_count, 0)       as rating_count,
  s.last_job_date,
  count(*) over ()                   as total_count
from drivers d
left join driver_stats s      on s.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id
left join rel r               on r.driver_id = d.id
where d.status in ('active', 'probation')   -- ชั้นที่ 1: กรองแข็ง — ตรงกับ StatusDialog.tsx
  -- ชั้นที่ 1.5: hard filter ลูกค้า/ประเภทรถ (รหัสมาตรฐาน) — ไม่ระบุช่องไหนก็ผ่านช่องนั้นเสมอ
  and (p_customer_code is null or coalesce(r.customer_jobs, 0) > 0)
  and (p_vehicle_type_code is null or coalesce(r.vehicle_type_jobs, 0) > 0)
  -- เส้นทางกรองแข็งเฉพาะเมื่อผู้ใช้เปิดสวิตช์เอง — coalesce กัน null หลุดเข้ามา ไม่งั้น
  -- "not null" เป็น null แล้วเงื่อนไขนี้จะกรองเข้มโดยที่สวิตช์ไม่ได้เปิด (ทดสอบแล้ว)
  and (
    not coalesce(p_route_strict, false)
    or p_route_keyword is null
    or coalesce(r.route_jobs, 0) > 0
  )
order by
  -- ชั้นที่ 2: คัดคนที่ไม่ควรส่งลงไปท้ายก่อน (เหมือนเดิมทุกประการ)
  coalesce(s.recent_problem_jobs, 0) asc,
  (sc.adjusted_score is not null and sc.adjusted_score < 3.0) asc,
  -- ชั้นที่ 3: ในกลุ่มที่ผ่านตัวกรองแล้ว เรียงตามน้ำหนักความเกี่ยวข้อง
  coalesce(r.customer_jobs, 0) desc,
  coalesce(r.vehicle_type_jobs, 0) desc,
  coalesce(r.route_jobs, 0) desc,
  -- ชั้นที่ 4: เสมอกันค่อยดูคุณภาพ แล้วจึงประสบการณ์รวมและความสด
  sc.adjusted_score desc nulls last,
  coalesce(s.total_jobs, 0) desc,
  s.last_job_date desc nulls last
limit greatest(p_limit, 1);
$$;

grant execute on function search_drivers to authenticated;
