-- 0040: ทีม EXPRESS — 11 บัญชี (รายชื่อจากผู้ใช้ 2026-10-19) เป็นฝั่ง EXPRESS สิทธิ์ admin
--
-- ต้องรันหลัง 0039 เสมอ
--
-- ครอบคลุมทั้งสองกรณี:
--   1) คนที่สมัครเข้าระบบแล้ว — ย้ายฝั่ง/ตั้งสิทธิ์ทันทีด้านล่าง
--   2) คนที่ยังไม่สมัคร — trigger บน profiles ตั้งให้ตอนสร้างบัญชี ถ้าไม่มีตัวนี้ คนที่สมัครทีหลัง
--      จะได้ฝั่ง B2B (ค่าตั้งต้น) และเห็นข้อมูล B2B ทันทีที่ล็อกอินครั้งแรก
--
-- เพิ่ม/ลดสมาชิกทีมภายหลัง: insert/delete ในตาราง express_team แล้ว update profiles ของคนนั้น

create table if not exists express_team (
  email  text primary key check (email = lower(email)),
  role   app_role not null default 'admin',
  note   text
);

-- ไม่มี policy = ผู้ใช้หน้าเว็บอ่าน/แก้ไม่ได้เลย แก้ได้จาก SQL Editor เท่านั้น
alter table express_team enable row level security;
revoke all on express_team from anon, authenticated;

insert into express_team (email, note) values
  ('express@2klogistics.co.th',  'MAX — Manager'),
  ('ogotokung35@gmail.com',      'ก็อต — Planning J&T/CPU'),
  ('warawutdetchim@gmail.com',   'โจ้ — Support planning'),
  ('sindyople1411@gmail.com',    'ซินดี้ — Admin'),
  ('nattapong0015@gmail.com',    'เด้นท์ — Support planning'),
  ('nuttika.juh@gmail.com',      'โดนัท — Admin'),
  ('2klexpress3@gmail.com',      'ติ๊บ — Planning NE'),
  ('paweenaplemaree@gmail.com',  'ผึ้ง — Supervisor Admin'),
  ('thepeepittaya@gmail.com',    'พี — Support planning'),
  ('mimtmimt2255@gmail.com',     'มิ้ม — Planning FLASH B/C, S'),
  ('amypiyanyt@gmail.com',       'เอมมี่ — Admin')
on conflict (email) do update set role = excluded.role, note = excluded.note;

-- ตั้งฝั่ง/สิทธิ์ให้ตอนสร้าง profile (fn_handle_new_user สร้างแถวนี้หลังสมัคร)
create or replace function fn_profiles_assign_line() returns trigger
language plpgsql security definer set search_path = public
as $$
declare t express_team%rowtype;
begin
  select * into t from express_team where email = lower(new.email);
  if found then
    new.business_line := 'EXPRESS';
    new.role := t.role;
  end if;
  return new;
end
$$;

revoke execute on function fn_profiles_assign_line() from public, anon, authenticated;

drop trigger if exists profiles_assign_line on profiles;
create trigger profiles_assign_line before insert on profiles
  for each row execute function fn_profiles_assign_line();

-- คนที่สมัครไว้แล้ว — ย้ายฝั่งและตั้งสิทธิ์ (รันจาก SQL Editor = role postgres จึงผ่าน
-- trigger profiles_lock_line ของ 0039)
update profiles p
set business_line = 'EXPRESS', role = t.role
from express_team t
where lower(p.email) = t.email;
