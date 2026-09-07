-- =============================================================================
-- 0006_search_includes_probation.sql — แก้ search_drivers() ให้ตรงกับที่ UI บอกไว้
--
-- StatusDialog.tsx อธิบายสถานะ "ทดลองงาน" (probation) ไว้ชัดเจนว่า
-- "ยังรับงานได้และยังขึ้นในการจัดอันดับ แต่ทำเครื่องหมายไว้ว่าต้องจับตา"
-- แต่ search_drivers() เดิมกรองด้วย `where d.status = 'active'` เพียงอย่างเดียว
-- พขร. ที่อยู่สถานะทดลองงานจึงหายไปจากหน้า "หาคนสำหรับงาน" ทั้งหมด — ตรงข้ามกับ
-- สิ่งที่ระบบบอกผู้ใช้ไว้ ทำให้การตัดสินใจมอบงานผิดพลาดได้จริง
--
-- แก้ให้ตรงกับสถานะทั้งสี่ตามที่ StatusDialog.tsx นิยามไว้:
--   active      -> ขึ้นจัดอันดับ
--   probation   -> ขึ้นจัดอันดับ (แค่ทำเครื่องหมายไว้ให้จับตา ไม่ได้ตัดสิทธิ์)
--   inactive    -> ไม่ขึ้น
--   blacklisted -> ไม่ขึ้น
-- =============================================================================

create or replace function search_drivers(
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
  fit_score          numeric
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
    s.days_since_last_job,
    coalesce(s.recent_problem_jobs, 0) as problems,
    s.on_time_rate,
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
  b.last_job_date,
  -- หมายเหตุเรื่องชนิดข้อมูล: ต้อง cast เป็น numeric ให้ชัดเจน
  -- เพราะ ln() ที่รับ bigint จะถูกแปลงเป็น ln(double precision) ตามกฎการเลือก
  -- ฟังก์ชันของ Postgres ทำให้ทั้งนิพจน์กลายเป็น double precision
  -- แล้ว round(double precision, int) ไม่มีอยู่จริง จะพังตอนเรียกใช้
  round((
      -- 40 คะแนน: คุณภาพงาน (ใช้ค่ากลาง 3.5 เมื่อยังไม่มีรีวิว)
      40 * (coalesce(b.adjusted_score, 3.5) / 5.0)
      -- 20 คะแนน: อัตราตรงเวลา (ใช้ 0.8 เป็นค่าเริ่มต้นเมื่อยังไม่มีข้อมูล)
    + 20 * coalesce(b.on_time_rate, 0.8)
      -- 15 คะแนน: ประสบการณ์กับลูกค้ารายนี้ เพดาน 20 เที่ยว
    + 15 * least(ln((b.customer_jobs + 1)::numeric) / ln(21::numeric), 1.0)
      -- 10 คะแนน: ประสบการณ์ประเภทรถนี้
    + 10 * least(ln((b.vehicle_type_jobs + 1)::numeric) / ln(21::numeric), 1.0)
      -- 10 คะแนน: ประสบการณ์เส้นทางนี้
    + 10 * least(ln((b.route_jobs + 1)::numeric) / ln(11::numeric), 1.0)
      --  5 คะแนน: ความสดของข้อมูล วิ่งภายใน 30 วัน = เต็ม
    +  5 * case
             when b.days_since_last_job is null then 0.0
             when b.days_since_last_job <= 30   then 1.0
             when b.days_since_last_job <= 90   then 0.6
             when b.days_since_last_job <= 180  then 0.3
             else 0.0
           end
      -- หัก 10 ต่อปัญหาใน 12 เดือน หักได้มากสุด 30
    - least(b.problems * 10, 30)::numeric
  )::numeric, 1) as fit_score
from base b
order by fit_score desc, b.total_jobs desc
limit greatest(p_limit, 1);
$$;

grant execute on function search_drivers to authenticated;
