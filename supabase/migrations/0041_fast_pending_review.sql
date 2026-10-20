-- 0041: หน้า "รอประเมิน" หมดเวลา (statement timeout) หลังนำเข้า EXPRESS 72,042 เที่ยว
--
-- สาเหตุ: drivers_pending_review (0031) join driver_stats + driver_scorecard ซึ่งคำนวณสถิติทุกอย่าง
-- ของ พขร. (ราคา/ลูกค้า/รถ/อัตราตรงเวลา) ทั้งที่หน้านี้ใช้แค่จำนวนเที่ยวและวันที่ล่าสุด และปล่อยให้
-- planner เลือกวิธี join เอง — พอใส่ order by total_jobs บน production มันเลือกแผนที่คำนวณซ้ำจนหมดเวลา
--
-- แก้: คำนวณเฉพาะสองค่าที่ใช้ ครั้งเดียว (materialized CTE = บังคับคำนวณรอบเดียวเสมอ ไม่ขึ้นกับ planner)
-- คอลัมน์ ชนิด และความหมายเหมือนเดิมทุกตัว — หน้าเว็บไม่ต้องแก้
-- ยังเป็น security_invoker → RLS แยกฝั่งของ 0039 ยังมีผลครบ (B2B เห็นแค่ B2B, EXPRESS เห็นแค่ EXPRESS)

create or replace view drivers_pending_review
with (security_invoker = on) as
with s as materialized (
  select a.driver_id,
         count(a.id)       as total_jobs,
         max(j.job_date)   as last_job_date
  from job_assignments a
  left join jobs j on j.id = a.job_id
  group by a.driver_id
),
rated as materialized (
  select distinct r.driver_id
  from driver_ratings r
  where r.voided_at is null
)
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  driver_effective_status(d.status, d.status_until) as status,
  coalesce(s.total_jobs, 0)          as total_jobs,
  s.last_job_date,
  (current_date - s.last_job_date)   as days_since_last_job,
  0::bigint                          as rating_count,
  (coalesce(s.total_jobs, 0) >= 10
   or coalesce(current_date - s.last_job_date, 2147483647) <= 90) as is_priority
from drivers d
left join s on s.driver_id = d.id
where not exists (select 1 from rated where rated.driver_id = d.id)
  and driver_effective_status(d.status, d.status_until) in ('active', 'probation');

grant select on drivers_pending_review to authenticated;
