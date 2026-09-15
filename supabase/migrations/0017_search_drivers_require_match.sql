-- =============================================================================
-- 0017_search_drivers_require_match.sql
--
-- แก้ปัญหาที่พบจริง: ระบุลูกค้า "ฝาจีบ" + ประเภทรถ "4W" แล้วอันดับ 1 กลับเป็นคนขับ
-- ที่มีเที่ยวกับฝาจีบ 9 เที่ยว แต่ไม่เคยขับ 4W เลยสักครั้ง (จำนวนเที่ยวประเภทรถ = 0)
--
-- สาเหตุ: 0012 นับ customer_jobs / vehicle_type_jobs / route_jobs แยกอิสระจากกัน
-- แล้วเรียงแบบ "ลูกค้าก่อน ประเภทรถรองลงมา เส้นทางรองลงไปอีก" (lexicographic) ทำให้
-- คนที่มีเที่ยวลูกค้าเยอะมากชนะทุกคนได้ทันที ไม่ว่าประเภทรถ/เส้นทางที่ระบุจะตรงหรือไม่
--
-- เปลี่ยนเป็น: ถ้าระบุเงื่อนไขไหน (ลูกค้า/ประเภทรถ/เส้นทาง) คนขับต้องมีประสบการณ์จริง
-- ในเงื่อนไขนั้นอย่างน้อย 1 เที่ยว ถึงจะอยู่กลุ่มบนสุด — เป็นชั้นกรองใหม่ที่แทรกก่อน
-- ลำดับความเกี่ยวข้องเดิม ไม่ใช่ตัด customer_jobs/vehicle_type_jobs/route_jobs desc
-- ออก (ยังใช้จัดลำดับภายในกลุ่มเดียวกันเหมือนเดิม) และไม่กระทบชั้นกรองคุณภาพ (คนมี
-- ปัญหา/คะแนนต่ำ) ที่ยังคัดออกก่อนเป็นอันดับแรกเหมือนเดิมทุกประการ
--
-- เงื่อนไขที่ไม่ได้ระบุ (เป็น null) ถือว่า "ผ่าน" เสมอ เช่น ระบุแค่ลูกค้าอย่างเดียว
-- ไม่ระบุประเภทรถ/เส้นทาง คนขับก็ไม่ต้องมีประสบการณ์ประเภทรถ/เส้นทางมาก่อนก็ได้
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
  -- ชั้นที่ 2: คัดคนที่ไม่ควรส่งลงไปท้ายก่อน (เหมือน 0012 ทุกประการ)
  coalesce(s.recent_problem_jobs, 0) asc,
  (sc.adjusted_score is not null and sc.adjusted_score < 3.0) asc,
  -- ชั้นที่ 3 (ใหม่): ต้องมีประสบการณ์จริงตรงกับทุกเงื่อนไขที่ระบุมา ก่อนถึงจะขึ้นกลุ่มบน
  -- ตัวอย่าง: ระบุลูกค้า+ประเภทรถ คนที่ไม่เคยขับประเภทรถนั้นเลยจะตกไปกลุ่มล่างเสมอ
  -- ไม่ว่าจะมีเที่ยวกับลูกค้ารายนั้นมากแค่ไหนก็ตาม
  (
    (p_customer_code is null or coalesce(r.customer_jobs, 0) > 0)
    and (p_vehicle_type_code is null or coalesce(r.vehicle_type_jobs, 0) > 0)
    and (p_route_keyword is null or coalesce(r.route_jobs, 0) > 0)
  ) desc,
  -- ชั้นที่ 4: ในกลุ่มเดียวกัน (ผ่านครบ หรือไม่ผ่านครบ) เรียงตามน้ำหนักความเกี่ยวข้องเดิม
  coalesce(r.customer_jobs, 0) desc,
  coalesce(r.vehicle_type_jobs, 0) desc,
  coalesce(r.route_jobs, 0) desc,
  -- ชั้นที่ 5: เสมอกันค่อยดูคุณภาพ แล้วจึงประสบการณ์รวมและความสด
  sc.adjusted_score desc nulls last,
  coalesce(s.total_jobs, 0) desc,
  s.last_job_date desc nulls last
limit greatest(p_limit, 1);
$$;

grant execute on function search_drivers to authenticated;
