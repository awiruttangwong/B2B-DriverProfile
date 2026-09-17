-- =============================================================================
-- 0020_driver_documents.sql
--
-- อัปโหลดรูปบัตรประชาชน / ใบขับขี่ ของ พขร. — เก็บแค่ path ไว้ใน driver_private
-- (ตารางข้อมูลอ่อนไหวที่มีอยู่แล้ว เปิดสิทธิ์เฉพาะ admin/hr ผ่าน can_see_pii())
-- ตัวรูปจริงอยู่ใน Storage bucket ใหม่ 'driver-documents' (private, ไม่มี public URL)
--
-- ไม่ใช้ตาราง driver_licenses ที่มีอยู่เดิม เพราะตารางนั้นออกแบบไว้สำหรับประวัติ
-- ใบขับขี่แบบเป็นทางการ (ประเภท ท.1-ท.4, เลขที่, วันหมดอายุ, หลายใบต่อคน) และ
-- RLS เปิดอ่านให้ authenticated ทุก role (using (true)) หลวมเกินไปสำหรับรูป
-- เอกสารส่วนตัว — ปล่อย driver_licenses ไว้เผื่ออนาคตมีฟีเจอร์นั้นจริง ๆ
--
-- Path ตายตัวต่อคนต่อประเภท ({driver_id}/id_card.jpg, {driver_id}/license.jpg)
-- อัปโหลดซ้ำ = upsert ทับของเดิม ไม่สะสมเวอร์ชันเก่า (เหมือนฟีเจอร์ "หมายเหตุ"
-- ที่ตัดสินใจไว้ก่อนหน้านี้ — ของใหม่แทนที่ของเก่าเสมอ)
-- =============================================================================

alter table driver_private
  add column id_card_path        text,
  add column driver_license_path text;

-- -----------------------------------------------------------------------------
-- Storage bucket — private เสมอ ห้ามเป็น public เด็ดขาด (รูปบัตร ปชช./ใบขับขี่)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('driver-documents', 'driver-documents', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- สิทธิ์บน storage.objects ของ bucket นี้ — ชั้นเดียวกับ driver_private ทุกประการ
-- ใช้ can_see_pii() ตัวเดิม (admin/hr เท่านั้น) บังคับที่ฐานข้อมูล ไม่ใช่แค่ซ่อนปุ่ม
-- -----------------------------------------------------------------------------
create policy driver_documents_read on storage.objects
  for select to authenticated
  using (bucket_id = 'driver-documents' and can_see_pii());

create policy driver_documents_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'driver-documents' and can_see_pii());

create policy driver_documents_update on storage.objects
  for update to authenticated
  using      (bucket_id = 'driver-documents' and can_see_pii())
  with check (bucket_id = 'driver-documents' and can_see_pii());

create policy driver_documents_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'driver-documents' and can_see_pii());
