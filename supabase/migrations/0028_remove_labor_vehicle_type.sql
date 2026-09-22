-- =============================================================================
-- 0028_remove_labor_vehicle_type.sql
--
-- "แรงงาน" ไม่ใช่ประเภทรถ — เป็นค่าที่คนกรอกไฟล์ต้นทางเขียนไว้ในคอลัมน์ "ประเภทรถ" สำหรับ
-- งานที่จริง ๆ เป็นงานใช้แรงงานยกของ ไม่ใช่รถ ระบบสร้างเป็นประเภทรถขึ้นอัตโนมัติเพราะไม่ได้
-- กรองว่าค่าไหนสมเหตุสมผล (เหมือนที่มาของ SANDAN ใน 0026 — ข้อผิดพลาดของข้อมูลต้นทาง)
--
-- ล้าง vehicle_type_id ที่ชี้มาที่นี่ให้เป็นค่าว่างก่อน แล้วค่อยลบแถวประเภทรถทิ้ง มีสองตารางที่
-- อ้างถึง vehicle_types.id ไม่ใช่แค่ jobs — vehicles (รถหนึ่งคันมีประเภทรถของตัวเอง) ก็อ้างถึง
-- ด้วย ลืมจุดนี้ตอนร่างรอบแรกแล้วรันจริงเจอ "violates foreign key constraint
-- vehicles_vehicle_type_id_fkey" เพราะมีรถอย่างน้อยหนึ่งคันถูกสร้างขึ้นจากแถวที่สะกด "แรงงาน"
-- ไว้ในคอลัมน์ทะเบียนด้วย (ข้อมูลต้นทางผิดซ้อนกันสองจุด) — ไม่ลบแถวใน vehicles ทิ้ง แค่ล้าง
-- ประเภทรถของมันเหมือน jobs เผื่อรถคันนั้นมีทะเบียนจริงที่ยังใช้อ้างอิงเที่ยวอื่นอยู่
--
-- ต่างจากลูกค้า ประเภทรถไม่มีผลกับ row_hash (สูตร hash = date|customer|plate|phone|route|
-- revenue|cost ไม่มีประเภทรถ) จึงไม่กระทบการตรวจจับไฟล์ซ้ำตอนอัปโหลด
--
-- รันซ้ำได้: ถ้าไม่มี "แรงงาน" อยู่แล้วไม่ทำอะไร
-- =============================================================================

do $$
declare
  v_id          uuid;
  v_jobs        int;
  v_vehicles    int;
begin
  select id into v_id from vehicle_types where code = 'แรงงาน';

  if v_id is null then
    raise notice 'ไม่พบประเภทรถ "แรงงาน" (อาจลบไปแล้ว) — ไม่ต้องทำอะไร';
    return;
  end if;

  update jobs set vehicle_type_id = null where vehicle_type_id = v_id;
  get diagnostics v_jobs = row_count;

  update vehicles set vehicle_type_id = null where vehicle_type_id = v_id;
  get diagnostics v_vehicles = row_count;

  delete from vehicle_types where id = v_id;

  raise notice 'ล้างประเภทรถออกจาก % เที่ยว และ % คันรถ แล้วลบประเภทรถ "แรงงาน" แล้ว', v_jobs, v_vehicles;
end $$;
