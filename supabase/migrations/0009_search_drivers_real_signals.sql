-- =============================================================================
-- 0009_search_drivers_real_signals.sql
-- ตัดคะแนน "ความเหมาะสม" แบบผสมสูตรออก เพราะสองในหกส่วนของสูตรเดิมเป็นค่าที่ไม่มีจริง
--
-- ที่มาของปัญหา: search_drivers() เดิมให้คะแนนคุณภาพงาน 40 คะแนน โดย
-- coalesce(adjusted_score, 3.5) — พขร. ส่วนใหญ่ยังไม่มีรีวิวจริงเลย จึงได้ 3.5 ปลอม ๆ
-- ทุกคนเท่ากันหมด และให้คะแนนตรงเวลาอีก 20 คะแนน โดย coalesce(on_time_rate, 0.8)
-- แต่ on_time_rate เป็น null เสมอเพราะไฟล์นำเข้าไม่เคยมีข้อมูลนี้จริง (ดูคอมเมนต์ใน
-- driver_stats) รวมแล้ว 60 จาก 100 คะแนนของ "ความเหมาะสม" ที่โชว์ผู้ใช้เป็นตัวเลขนิ่ง
-- ที่มโนขึ้นมาเอง ไม่ใช่ข้อมูลจริง — ผิดหลักที่ควรรอให้ผู้ใช้ให้คะแนนจริงก่อน
--
-- แก้โดยตัดคะแนนผสมทิ้งทั้งหมด เปลี่ยนเป็นเรียงลำดับหลายชั้นด้วยข้อมูลจริงล้วน ๆ:
--   1) ไม่เคยมีปัญหา (no_show/incident) ใน 12 เดือนที่ผ่านมา
--   2) มีรีวิวจริงจากผู้ใช้แล้วหรือยัง แล้วค่อยเรียงตามคะแนนจริงถ้ามี
--   3) ประสบการณ์ตรงกับงานที่ระบุ (ลูกค้า / ประเภทรถ / เส้นทาง)
--   4) ประสบการณ์รวม
--   5) ความสด (งานล่าสุด)
-- ไม่มีขั้นไหนใช้ค่า default แทนข้อมูลที่ไม่มีจริงอีกต่อไป
-- =============================================================================

-- ต้อง drop ก่อน เพราะเปลี่ยนจำนวน/ชนิดคอลัมน์ผลลัพธ์ (ตัด fit_score ออก)
-- create or replace function จะ error ถ้า return type ต่างจากของเดิม
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
with base as (
  select
    d.id,
    d.driver_code,
    d.full_name,
    d.phone,
    coalesce(s.total_jobs, 0)          as total_jobs,
    s.last_job_date,
    coalesce(s.recent_problem_jobs, 0) as problems,
    sc.adjusted_score,
    coalesce(sc.rating_count, 0)       as rating_count,
    -- ประสบการณ์ตรงลูกค้ารายนี้
    coalesce((
      select count(*) from job_assignments a2
      join jobs j2 on j2.id = a2.job_id
      join customers c2 on c2.id = j2.customer_id
      where a2.driver_id = d.id
        and (p_customer_code is null or upper(c2.code) = upper(p_customer_code))
        and p_customer_code is not null
    ), 0) as customer_jobs,
    -- ประสบการณ์ตรงประเภทรถ
    coalesce((
      select count(*) from job_assignments a3
      join jobs j3 on j3.id = a3.job_id
      join vehicle_types v3 on v3.id = j3.vehicle_type_id
      where a3.driver_id = d.id
        and (p_vehicle_type_code is null or upper(v3.code) = upper(p_vehicle_type_code))
        and p_vehicle_type_code is not null
    ), 0) as vehicle_type_jobs,
    -- ประสบการณ์ตรงเส้นทาง
    coalesce((
      select count(*) from job_assignments a4
      join jobs j4 on j4.id = a4.job_id
      where a4.driver_id = d.id
        and p_route_keyword is not null
        and j4.route_raw ilike '%' || p_route_keyword || '%'
    ), 0) as route_jobs
  from drivers d
  left join driver_stats s      on s.driver_id = d.id
  left join driver_scorecard sc on sc.driver_id = d.id
  where d.status in ('active', 'probation')   -- ชั้นที่ 1: กรองแข็ง — ตรงกับ StatusDialog.tsx
)
select
  b.id,
  b.driver_code,
  b.full_name,
  b.phone,
  b.total_jobs,
  b.customer_jobs,
  b.vehicle_type_jobs,
  b.route_jobs,
  b.adjusted_score,
  b.rating_count,
  b.last_job_date
from base b
order by
  b.problems asc,
  (b.rating_count > 0) desc,
  b.adjusted_score desc nulls last,
  b.customer_jobs desc,
  b.vehicle_type_jobs desc,
  b.route_jobs desc,
  b.total_jobs desc,
  b.last_job_date desc nulls last
limit greatest(p_limit, 1);
$$;

grant execute on function search_drivers to authenticated;
