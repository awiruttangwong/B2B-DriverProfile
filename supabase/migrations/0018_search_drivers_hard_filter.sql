-- =============================================================================
-- 0018_search_drivers_hard_filter.sql
--
-- เปลี่ยนจาก "จัดกลุ่มคนไม่ตรงเงื่อนไขไว้ท้ายแถวแต่ยังโชว์" (0017) เป็น
-- "ตัดคนไม่ตรงเงื่อนไขออกจากผลลัพธ์ไปเลย" — ผู้ใช้เห็นว่าตอนหา พขร. ให้ลูกค้า
-- รายหนึ่งโดยเฉพาะ คนที่ไม่เคยมีประสบการณ์ตรงกับเงื่อนไขที่ระบุมา (ลูกค้า/ประเภทรถ/
-- เส้นทาง) แม้แต่ข้อเดียว ไม่ควรถูกนับเป็นตัวเลือกเลย ต่อให้มีประสบการณ์รวมทั้งระบบ
-- เยอะแค่ไหนก็ตาม เพราะนั่นไม่ใช่สิ่งที่ถูกถาม การเห็นคนไม่ตรงเงื่อนไขปนอยู่ท้ายตาราง
-- (แม้จะรู้ว่าไม่ตรง) ก็ยังสร้างความสับสนเปล่าประโยชน์
--
-- ไม่กระทบกรณีไม่ระบุเงื่อนไขเลย (ดูอันดับรวมทั้งระบบ) ยังแสดงทุกคนที่ผ่านสถานะ
-- เหมือนเดิมทุกประการ — ตัดออกเฉพาะตอนระบุเงื่อนไขมาแล้วไม่ผ่านเงื่อนไขนั้นจริง ๆ
--
-- เพิ่มคอลัมน์ total_count (count(*) over ()) คือจำนวนคนที่ผ่านตัวกรองทั้งหมด
-- ไม่ใช่แค่ที่ส่งกลับมาในหน้านี้ (หลัง limit) — frontend ใช้เลขนี้แทนการนับจำนวน
-- คนขับที่ผ่านสถานะทั้งระบบเหมือนเดิม เพราะตอนนี้ "ผ่านตัวกรอง" ไม่เท่ากับ
-- "ผ่านสถานะ" อีกต่อไปหลัง hard filter
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
  and (
    -- ชั้นที่ 1.5 (ใหม่): ไม่ระบุเงื่อนไขเลย -> ผ่านหมด (ดูอันดับรวม)
    -- ระบุเงื่อนไขมา -> ต้องมีประสบการณ์จริงตรงทุกเงื่อนไขที่ระบุอย่างน้อย 1 เที่ยว
    -- ไม่งั้นตัดออกจากผลลัพธ์ไปเลย ไม่ใช่แค่ดันไปท้ายแถวเหมือน 0017
    (p_customer_code is null and p_vehicle_type_code is null and p_route_keyword is null)
    or (
      (p_customer_code is null or coalesce(r.customer_jobs, 0) > 0)
      and (p_vehicle_type_code is null or coalesce(r.vehicle_type_jobs, 0) > 0)
      and (p_route_keyword is null or coalesce(r.route_jobs, 0) > 0)
    )
  )
order by
  -- ชั้นที่ 2: คัดคนที่ไม่ควรส่งลงไปท้ายก่อน (เหมือนเดิมทุกประการ)
  coalesce(s.recent_problem_jobs, 0) asc,
  (sc.adjusted_score is not null and sc.adjusted_score < 3.0) asc,
  -- ชั้นที่ 3: ในกลุ่มที่เหลือ (ผ่านตัวกรองแล้วทั้งหมด) เรียงตามน้ำหนักความเกี่ยวข้อง
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
