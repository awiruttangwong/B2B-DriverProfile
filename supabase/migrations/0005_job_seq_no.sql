-- =============================================================================
-- 0005_job_seq_no.sql — เก็บ "ลำดับงาน" ของเที่ยว
--
-- ทำไมต้องมี: ในไฟล์ต้นทางมีแถวที่เหมือนกันทุกช่อง (วันที่ ลูกค้า ทะเบียน เบอร์โทร
-- เส้นทาง ราคารับ ราคาจ่าย) แต่เป็นคนละเที่ยวจริง ๆ เช่น
--
--     20/07/2026  นพพล เสนาบูรณ์  JTC - ท่าเรือ KERRY แหลมฉบัง  3,000  ลำดับงาน 13
--     20/07/2026  นพพล เสนาบูรณ์  JTC - ท่าเรือ KERRY แหลมฉบัง  3,000  ลำดับงาน 14
--     20/07/2026  นพพล เสนาบูรณ์  JTC - ท่าเรือ KERRY แหลมฉบัง  3,000  ลำดับงาน 15
--
-- ลำดับงานคือสิ่งเดียวที่แยกสามแถวนี้ออกจากกัน ถ้าไม่เก็บไว้ ระบบจะพิสูจน์ย้อนหลัง
-- ไม่ได้เลยว่าทำไมถึงนับเป็นสามเที่ยว และเวลาผู้ใช้เปิดดูโปรไฟล์ก็จะเห็นสามบรรทัด
-- ที่เหมือนกันเป๊ะโดยไม่มีอะไรอธิบาย
--
-- ลำดับงานยังเป็นตัวชี้ขาดตอนนำเข้าด้วย — แถวที่ลำดับงานตรงกันคือแถวเดียวกัน
-- ที่ถูกคัดลอกข้ามชีต ส่วนแถวที่ลำดับงานต่างกันคือคนละเที่ยว รายละเอียดอยู่ใน
-- cleanSheets() ที่ apps/web/src/lib/ingest.ts
--
-- เก็บเป็น text ไม่ใช่ int เพราะไฟล์จริงมีทั้ง 13 / 13.0 / "13-1"
-- =============================================================================

alter table jobs add column if not exists seq_no text;

comment on column jobs.seq_no is
  'ลำดับงานจากไฟล์ต้นทาง — ใช้แยกเที่ยวที่ข้อมูลอื่นเหมือนกันหมดออกจากกัน';

-- ค้นงานตามวันและลำดับ ใช้ตอนกระทบยอดกับไฟล์ต้นทาง
create index if not exists jobs_date_seq_idx on jobs (job_date, seq_no)
  where seq_no is not null;

-- -----------------------------------------------------------------------------
-- ต่อ seq_no ท้ายมุมมองประวัติงาน
--
-- ใช้ create or replace แทน drop + create เพราะการ drop จะทำให้ grant และ
-- policy ที่ผูกกับมุมมองหายไปด้วย Postgres ยอมให้เพิ่มคอลัมน์ต่อท้ายได้อยู่แล้ว
-- ตราบใดที่คอลัมน์เดิมยังเรียงเหมือนเดิมทุกตัว
-- -----------------------------------------------------------------------------
create or replace view driver_job_history
with (security_invoker = on) as
select
  a.id            as assignment_id,
  a.driver_id,
  j.id            as job_id,
  j.job_date,
  c.code          as customer_code,
  vt.code         as vehicle_type_code,
  v.plate,
  j.route_raw,
  j.origin,
  j.destination,
  j.revenue,
  j.cost,
  j.margin,
  j.note,
  a.outcome,
  a.on_time,
  r.id            as rating_id,
  r.overall_score,
  r.reason        as rating_reason,
  r.tags          as rating_tags,
  j.seq_no
from job_assignments a
join jobs j                on j.id = a.job_id
left join customers c      on c.id = j.customer_id
left join vehicle_types vt on vt.id = j.vehicle_type_id
left join vehicles v       on v.id = j.vehicle_id
left join driver_ratings r on r.assignment_id = a.id and r.voided_at is null;
