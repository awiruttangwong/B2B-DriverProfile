-- =============================================================================
-- 0012_ranking_quality_gate.sql
--
-- แก้ลำดับใน search_drivers() ให้ "คะแนน" ทำหน้าที่คัดคนออก ไม่ใช่ดันคนขึ้น
--
-- ปัญหาที่พบตอนทดสอบ 0011 ด้วยข้อมูลจริง:
--   กติกาเดิมมีคีย์ (rating_count > 0) desc = "ใครมีคะแนนแล้วขึ้นก่อนคนไม่มีข้อมูล"
--   ตอนที่คะแนนยังถูกบีบเข้าหาค่ากลาง (ก่อน 0011) กติกานี้ไม่เห็นปัญหา เพราะทุกคน
--   กองอยู่แถว 3.5-4.0 เหมือนกันหมด แต่พอคะแนนกางเต็มสเกล 1-5 แล้วมันกลายเป็น:
--
--     อันดับ 1  DRV-00302  ประเมิน 5.00   (2 เที่ยว)
--     อันดับ 2  DRV-00220  ประเมิน 2.00   (4 เที่ยว)   ← คนที่เรารู้ว่าแย่
--     อันดับ 3  DRV-00305  ยังไม่ประเมิน  (385 เที่ยว) ← คนที่ยังไม่รู้ฝีมือ
--
--   คือระบบแนะนำคนที่ผู้จัดการให้ 2 คะแนน ขึ้นก่อนคนที่วิ่งมา 385 เที่ยว
--   เพียงเพราะ "มีข้อมูล" ซึ่งเป็นคำแนะนำที่ผิดในทางปฏิบัติ
--
-- หลักที่ใช้แทน:
--   คะแนน = ตัวคัดคนที่ไม่ควรส่งออกไป   (คนที่รู้ว่าแย่ ต้องจมกว่าคนที่ยังไม่รู้)
--   ประสบการณ์ตรงงาน = ตัวเลือกคนที่ควรส่ง
--
--   เพราะหน้านี้คือ "หาคนสำหรับงาน" ไม่ใช่ "จัดอันดับคนเก่ง" — คนที่วิ่งให้ลูกค้า
--   รายนี้มา 300 เที่ยวคือหลักฐานว่าลูกค้ารับได้จริงและคุ้นเส้นทาง ซึ่งหนักแน่นกว่า
--   คะแนน 4.5 ที่มาจากการประเมินครั้งเดียวของคนคนเดียว
--
-- เส้นแบ่ง "คะแนนต่ำ" = ต่ำกว่า 3.00 เพราะสเกล 1-5 มีกลางอยู่ที่ 3
-- ยังไม่เคยประเมิน (null) ไม่ถือว่าต่ำ — ไม่รู้ ไม่เท่ากับ แย่
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
  last_job_date      date
)
language sql stable security invoker
as $$
with rel as (
  -- นับประสบการณ์ที่ตรงกับงานนี้ทั้งสามแบบในการสแกนรอบเดียว
  -- ข้ามทั้งบล็อกถ้าไม่ได้ระบุเงื่อนไขใดเลย จะได้ไม่จ่ายค่าสแกนฟรี ๆ
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
  s.last_job_date
from drivers d
left join driver_stats s      on s.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id
left join rel r               on r.driver_id = d.id
where d.status in ('active', 'probation')   -- ชั้นที่ 1: กรองแข็ง — ตรงกับ StatusDialog.tsx
order by
  -- ชั้นที่ 2: คัดคนที่ไม่ควรส่งลงไปท้ายก่อน
  coalesce(s.recent_problem_jobs, 0) asc,
  (sc.adjusted_score is not null and sc.adjusted_score < 3.0) asc,
  -- ชั้นที่ 3: เลือกคนจากประสบการณ์ที่ตรงกับงานนี้
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
