-- =============================================================================
-- 0034_driver_favorites.sql
--
-- หน้าใหม่ "พขร. ประจำของฉัน" — ผู้ใช้แต่ละคนปักหมุด พขร. ที่เรียกใช้บ่อย ๆ ไว้เอง
-- ยืนยันกับผู้ใช้แล้วว่าเป็นแบบส่วนตัวต่อ user (แต่ละคนเห็นคนละชุด ไม่แชร์กันทั้งทีม)
--
-- โครงสร้างและ RLS ยึดรูปแบบ "แถวเป็นของฉันเท่านั้น" ที่มีอยู่แล้วใน 0002_rls.sql
-- (profiles_self_update ใช้ id = auth.uid(), driver_ratings/rating_scores_write ใช้
-- rater_id = auth.uid()) — ไม่ผ่าน can_write_master() เหมือนตารางลูกอื่น ๆ ของ พขร.
-- (driver_phones, driver_contacts) เพราะการปักหมุดเป็นความชอบส่วนตัว ไม่ใช่ master data
-- ที่ต้องคุมด้วย role ทุก role (รวม viewer) ปักหมุดของตัวเองได้หมด
-- =============================================================================

create table driver_favorites (
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  driver_id   uuid not null references drivers(id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- primary key คู่กันแทนการมี id แยก — ป้องกันปักหมุดซ้ำที่ระดับฐานข้อมูลเลย
  -- ไม่ต้องเช็คซ้ำฝั่งแอป (ต่างจาก driver_phones/driver_contacts ที่มี id ของตัวเอง
  -- เพราะที่นี่ไม่มีเหตุผลให้มีมากกว่า 1 แถวต่อคู่ user/driver)
  primary key (user_id, driver_id)
);

create index driver_favorites_user_idx on driver_favorites (user_id, created_at desc);

alter table driver_favorites enable row level security;

create policy driver_favorites_read on driver_favorites for select to authenticated
  using (user_id = auth.uid());

create policy driver_favorites_insert on driver_favorites for insert to authenticated
  with check (user_id = auth.uid());

create policy driver_favorites_delete on driver_favorites for delete to authenticated
  using (user_id = auth.uid());

-- ไม่มี update policy — toggle ปักหมุด/เอาออก ทำด้วย insert/delete เหมือน driver_phones
-- ไม่ต้องมีโหมดแก้ไข

grant select, insert, delete on driver_favorites to authenticated;
