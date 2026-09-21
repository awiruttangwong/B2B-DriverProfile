-- =============================================================================
-- 0026_merge_customer_sandan_into_sanden.sql
--
-- ลูกค้า "SANDAN" เกิดจากข้อมูลต้นทางสะกดผิด ที่ถูกคือ "SANDEN" — ย้ายเที่ยวทั้งหมดของ
-- SANDAN ไปรวมกับ SANDEN แล้วลบ SANDAN ทิ้ง
--
-- ตารางเดียวที่อ้างอิง customers คือ jobs.customer_id จึงย้ายแค่คอลัมน์นั้น ส่วน view
-- (driver_customer_perf, job_customer_vehicle_pairs ฯลฯ) คำนวณจาก jobs อยู่แล้ว เปลี่ยนตามเอง
--
-- ไม่แตะ jobs.row_hash โดยตั้งใจ: hash คิดจากรหัสที่เขียนอยู่ในไฟล์ต้นทาง (สะกดผิด) ถ้าแก้
-- hash ตามไปด้วย การอัปโหลดไฟล์เดิมซ้ำจะไม่ถูกจับว่าซ้ำ ฝั่งนำเข้าจึงแปลงรหัสตอนหา
-- customer_id เท่านั้น (canonCustomer ใน apps/web/src/lib/normalize.ts) — hash ยังตรงเหมือนเดิม
--
-- รันซ้ำได้: ถ้าไม่มี SANDAN แล้วไม่ทำอะไร  ถ้าไม่พบ SANDEN หยุดพร้อมข้อความ ไม่ลบอะไรเลย
-- =============================================================================

do $$
declare
  v_from  uuid;
  v_to    uuid;
  v_moved int;
begin
  select id into v_from from customers where code = 'SANDAN';
  select id into v_to   from customers where code = 'SANDEN';

  if v_from is null then
    raise notice 'ไม่พบลูกค้า SANDAN (อาจรวมไปแล้ว) — ไม่ต้องทำอะไร';
    return;
  end if;
  if v_to is null then
    raise exception 'ไม่พบลูกค้า SANDEN ปลายทาง — หยุด ไม่ได้แก้อะไร (ถ้ายังไม่มี ให้เปลี่ยนรหัส SANDAN เป็น SANDEN แทนการรวม)';
  end if;

  update jobs set customer_id = v_to where customer_id = v_from;
  get diagnostics v_moved = row_count;

  delete from customers where id = v_from;

  raise notice 'ย้าย % เที่ยว จาก SANDAN ไป SANDEN และลบลูกค้า SANDAN แล้ว', v_moved;
end $$;
