-- =============================================================================
-- 0025_search_drivers_customer_strict.sql
--
-- ช่องติ๊ก "เฉพาะคนที่เคยวิ่งให้ลูกค้ารายนี้" (p_customer_strict) ให้ลูกค้าสลับได้เหมือน
-- ประเภทรถใน 0024 และใช้ค่าเริ่มต้นแบบเดียวกัน: default = true (กรองเข้มเหมือน 0019/0023/
-- 0024 ทุกประการ) เพราะเป็นพฤติกรรมที่ใช้งานอยู่แล้ว ถ้าตั้งเริ่มต้นเป็น false การค้นด้วย
-- ลูกค้าอย่างเดียวจะกลายเป็นได้ทุกคนทันที
--
-- ปิดติ๊ก (false) = ลูกค้าเป็นแค่ตัวจัดลำดับ คนที่เคยวิ่งให้ลูกค้ารายนั้นขึ้นก่อน ไม่ตัดใครออก
-- (ลำดับความเกี่ยวข้องชั้นที่ 3 ใช้ customer_jobs อยู่แล้ว)
--
-- ต้อง drop ลายเซ็นของ 0024 ก่อน ด้วยเหตุผลเดียวกับที่ 0024 drop ของ 0023
-- =============================================================================

drop function if exists search_drivers(text, text, text, boolean, boolean, int);

create function search_drivers(
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
  -- ลูกค้า: กรองแข็งเมื่อ strict (ค่าเริ่มต้น) — coalesce(…, true) กัน null หลุดเข้ามาแล้ว
  -- กลายเป็นเปิดกว้างโดยไม่ตั้งใจ ให้ถอยกลับไปเป็นพฤติกรรมเดิมแทน
  and (
    p_customer_code is null
    or not coalesce(p_customer_strict, true)
    or coalesce(r.customer_jobs, 0) > 0
  )
  -- ประเภทรถ: เหมือนลูกค้า — ดู 0024
  and (
    p_vehicle_type_code is null
    or not coalesce(p_vehicle_type_strict, true)
    or coalesce(r.vehicle_type_jobs, 0) > 0
  )
  -- เส้นทาง: กรองแข็งเฉพาะเมื่อผู้ใช้เปิดสวิตช์เอง (ค่าเริ่มต้นปิด) — ดู 0023
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
