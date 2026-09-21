-- =============================================================================
-- 0027_search_drivers_vehicle_types.sql
--
-- ค้นหาโดยไม่เลือกประเภทรถ ผลลัพธ์รวมทุกประเภทรถไว้ด้วยกัน จึงไม่รู้ว่าแต่ละคนเคยวิ่งงาน
-- แบบนี้ด้วยรถอะไร (ผู้บริหารขอให้เห็นประเภทรถต่อท้ายแถว) — เพิ่มคอลัมน์ผลลัพธ์
-- vehicle_types = [{"code":"4W","jobs":12}, ...] เรียงเที่ยวมาก→น้อย
--
-- นับตามสิ่งเดียวที่หัวคอลัมน์บนหน้าจอระบุ (จะได้ไม่กำกวม):
--   • ระบุลูกค้า → นับเที่ยวของลูกค้านั้น (ผลรวมป้ายจึงเท่ากับคอลัมน์ "จำนวนเที่ยวที่วิ่งให้ลูกค้า"
--     ยกเว้นเที่ยวที่ไม่มีประเภทรถ) ถ้าระบุเส้นทางด้วย เส้นทางเป็นแค่จัดลำดับ ไม่ร่วมนับ
--   • ไม่ระบุลูกค้า แต่ระบุเส้นทาง → นับเที่ยวที่ตรงเส้นทาง
--   • ไม่ระบุอะไรเลย (ดูอันดับรวม) → นับทุกเที่ยว
--   • ระบุประเภทรถแล้ว → ไม่คำนวณ ส่ง [] (มีคอลัมน์ "จำนวนเที่ยวที่วิ่งประเภทรถ" อยู่แล้ว)
-- เที่ยวที่ไม่มีประเภทรถ (vehicle_type_id เป็น null) ไม่นับ
--
-- ไม่แตะเงื่อนไขกรอง/ลำดับใด ๆ ทั้งสิ้น — ส่วน where/order by ตรงกับ 0025 ทุกบรรทัด
-- เปลี่ยนแค่ชนิดของผลลัพธ์ (เพิ่มคอลัมน์) จึงต้อง drop ลายเซ็นเดิมก่อน (create or replace
-- เปลี่ยนชนิดผลลัพธ์ไม่ได้) พารามิเตอร์เหมือนเดิมทุกตัว จึงไม่เกิด overload ซ้อนกัน
-- =============================================================================

drop function if exists search_drivers(text, text, text, boolean, boolean, boolean, int);

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
