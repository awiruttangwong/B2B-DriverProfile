-- =============================================================================
-- 0019_search_drivers_route_soft_order.sql
--
-- 0018 ตัดคนไม่ตรงเงื่อนไข (hard filter) ทั้ง 3 ช่อง (ลูกค้า/ประเภทรถ/เส้นทาง)
-- แต่ลูกค้า/ประเภทรถมาจาก dropdown ที่ผูกกับรหัสมาตรฐานในระบบ (customers.code,
-- vehicle_types.code) เลือกจากลิสต์เท่านั้น จึงไม่มีทางพิมพ์ผิด — hard filter
-- สองช่องนี้ปลอดภัย ตรงตามที่ต้องการจริง
--
-- ส่วน "เส้นทาง" เป็นช่องพิมพ์อิสระที่จับคู่แบบ ILIKE กับข้อความ route_raw ที่
-- คนบันทึกมือแต่ละครั้งสะกด/เว้นวรรคไม่ตรงกันเป๊ะ (เช่น "ระยอง" vs "ระยอง-แหลมฉบัง")
-- ถ้า hard filter ด้วย คนขับที่วิ่งเส้นทางนั้นจริงมีความเสี่ยงหายไปจากผลลัพธ์เงียบ ๆ
-- แค่เพราะข้อความไม่ตรงเป๊ะ ทั้งที่มีประสบการณ์จริง — จึงเปลี่ยนกลับให้เส้นทางเป็น
-- soft-order เหมือนก่อน 0018 (จัดลำดับให้คนตรงเส้นทางขึ้นก่อน แต่ไม่ตัดคนไม่ตรงออก)
-- ส่วนลูกค้า/ประเภทรถยังคง hard filter ตาม 0018 ทุกประการ
-- =============================================================================

drop function if exists search_drivers(text, text, text, int);

create function search_drivers(
  p_customer_code     text default null,
  p_vehicle_type_code text default null,
  p_route_keyword     text default null,
  p_limit             int  default 25
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
  -- ชั้นที่ 1.5: hard filter เฉพาะลูกค้า/ประเภทรถ (รหัสมาตรฐาน เลือกจาก dropdown
  -- เท่านั้น จึงปลอดภัย) — ไม่ระบุช่องไหนก็ผ่านช่องนั้นเสมอ เส้นทางไม่ตัดออกที่นี่
  and (p_customer_code is null or coalesce(r.customer_jobs, 0) > 0)
  and (p_vehicle_type_code is null or coalesce(r.vehicle_type_jobs, 0) > 0)
order by
  -- ชั้นที่ 2: คัดคนที่ไม่ควรส่งลงไปท้ายก่อน (เหมือนเดิมทุกประการ)
  coalesce(s.recent_problem_jobs, 0) asc,
  (sc.adjusted_score is not null and sc.adjusted_score < 3.0) asc,
  -- ชั้นที่ 3: ในกลุ่มที่ผ่านตัวกรองแข็งแล้ว เรียงตามน้ำหนักความเกี่ยวข้อง — เส้นทาง
  -- เป็นสัญญาณจัดลำดับเท่านั้น (soft) ไม่เคยตัดใครออกไม่ว่าตรงหรือไม่ตรง
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
