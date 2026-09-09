-- =============================================================================
-- 0013_status_reason_no_min_length.sql
--
-- เอาความยาวขั้นต่ำของเหตุผลเปลี่ยนสถานะ (พักงาน/ห้ามใช้งาน) ออก ตามที่ผู้ใช้แจ้ง
-- ว่า "ไม่ควรจำกัดการเขียน" — เดิมบังคับอย่างน้อย 10 ตัวอักษร (0004_driver_status.sql)
-- ตอนนี้บังคับแค่ "ห้ามว่าง" เขียนสั้นแค่ไหนก็บันทึกได้ ยาวแค่ไหนก็ไม่มีเพดาน
--
-- หน้าจอ (StatusDialog.tsx) แก้ให้ตรงกันแล้ว — เอาตัวนับ/ข้อความ "อีก N ตัวอักษร"
-- ออกไปด้วย ไม่ต้องมีคำอธิบายเรื่องความยาวอีกต่อไป
-- =============================================================================

alter table drivers drop constraint if exists drivers_status_reason_required;
alter table drivers add constraint drivers_status_reason_required check (
  status in ('active', 'probation')
  or char_length(btrim(coalesce(status_reason, ''))) >= 1
);
