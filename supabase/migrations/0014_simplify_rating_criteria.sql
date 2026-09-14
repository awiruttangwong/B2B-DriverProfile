-- =============================================================================
-- 0014_simplify_rating_criteria.sql
--
-- ลดเกณฑ์ให้คะแนนจาก 5 ข้อ เหลือ 3 ข้อกว้าง ๆ ตามที่ผู้ใช้กำหนด
--
-- ปิดใช้งาน (is_active = false) เกณฑ์เดิมทั้ง 5 ข้อ ไม่ลบทิ้ง เพราะ rating_scores
-- อ้างอิง criteria_id ตรง ๆ ลบแล้วประวัติคะแนนเก่าจะพังทันที (foreign key)
-- ใช้ code ใหม่สำหรับ 3 เกณฑ์ที่เพิ่ม ไม่ใช้ code เดิมซ้ำ เพราะ DriverProfile.tsx
-- join rating_scores กับ rating_criteria แล้วโชว์ label_th ของประวัติเก่าด้วย
-- ถ้าเอา code เดิมมาเปลี่ยนชื่อ/น้ำหนัก จะกลายเป็นเปลี่ยนป้ายชื่อของคะแนนเก่าไป
-- ด้วยทั้งที่ผู้ประเมินตอนนั้นให้คะแนนตามคำอธิบายเกณฑ์เดิม
-- =============================================================================

update rating_criteria set is_active = false
where code in ('safety', 'punctuality', 'cargo_care', 'communication', 'compliance');

insert into rating_criteria (code, label_th, description, weight, display_order, is_active) values
  ('punctuality_v2', 'ตรงต่อเวลา',
   'ในการเข้ารับสินค้าต้นทางและปลายทางตามเวลาที่นัดหมาย', 0.340, 1, true),
  ('cargo_safety_v2', 'สภาพสินค้าและความปลอดภัย',
   'การเสียหาย และรวมถึงความสะอาดของพื้นที่จัดวางสินค้า', 0.330, 2, true),
  ('service_v2', 'การให้บริการ',
   'การสื่อสาร สุภาพ และการแต่งกาย', 0.330, 3, true)
on conflict (code) do update
  set label_th = excluded.label_th,
      description = excluded.description,
      weight = excluded.weight,
      display_order = excluded.display_order,
      is_active = true;
