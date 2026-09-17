-- =============================================================================
-- 0022_driver_extra_phones.sql
--
-- เบอร์โทรสำรอง (เบอร์ที่ 2/3) ของ พขร. — แยกตารางต่างหาก ไม่แตะ drivers.phone
-- เด็ดขาด เพราะคอลัมน์นั้นเป็นส่วนหนึ่งของ natural key (phone, full_name) ที่ใช้
-- จับคู่งานตอนนำเข้าไฟล์ Excel อยู่แล้ว (0001_core_schema.sql)
--
-- position 2/3 เท่านั้น (เบอร์หลักคือตำแหน่ง 1 อยู่ที่ drivers.phone) unique
-- (driver_id, position) บังคับสูงสุด 2 แถวต่อคนที่ฐานข้อมูลเลย = เพดาน 3 เบอร์รวม
-- เบอร์หลัก ไม่มี update policy — แก้เบอร์ทำโดยลบแล้วเพิ่มใหม่ ไม่ต้องมี edit-mode
-- =============================================================================

create table driver_phones (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references drivers(id) on delete cascade,
  phone       text not null,
  position    smallint not null,
  created_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid() references profiles(id),

  constraint driver_phones_digits check (phone ~ '^[0-9]{9,10}$'),
  constraint driver_phones_position check (position in (2, 3)),
  unique (driver_id, position)
);

create index driver_phones_driver_idx on driver_phones (driver_id);

alter table driver_phones enable row level security;

-- อ่านได้ทุกคนเหมือนเบอร์หลักที่ไม่ถูกจำกัดสิทธิ์อยู่แล้ว
create policy driver_phones_read on driver_phones
  for select to authenticated
  using (true);

-- เพิ่ม/ลบได้เฉพาะ admin/hr/ops เหมือนสิทธิ์แก้ข้อมูลหลักอื่น ๆ ของ พขร.
create policy driver_phones_insert on driver_phones
  for insert to authenticated
  with check (can_write_master());

create policy driver_phones_delete on driver_phones
  for delete to authenticated
  using (can_write_master());

grant select, insert, delete on driver_phones to authenticated;
