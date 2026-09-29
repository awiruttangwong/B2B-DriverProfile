-- 0036: ให้เวลาใน user_activity_sessions มาจากนาฬิกาเซิร์ฟเวอร์ทั้งหมด
--
-- ปัญหาเดิม (0035): login_at มาจาก now() ของเซิร์ฟเวอร์ แต่ last_seen_at/logout_at มาจาก
-- new Date() ของเครื่องผู้ใช้ ถ้านาฬิกาเครื่องเพี้ยน (ช้า/เร็วไปหลายนาที หรือตั้งผิดโซน) ระยะเวลา
-- "อยู่ในระบบ" จะคลาดเคลื่อน หรือติดลบได้ — trigger นี้ประทับเวลาเซิร์ฟเวอร์ทับค่าที่ client ส่งมาเสมอ
-- client ยังส่ง last_seen_at/logout_at มาเหมือนเดิม (ใช้เป็นแค่สัญญาณว่า "อัปเดต"/"ออกแล้ว")
--
-- และกันแถวที่ออกจากระบบไปแล้วไม่ให้ถูกขยับเวลาอีก (heartbeat ที่มาช้ากว่าการกดออก)

create or replace function user_activity_sessions_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.login_at := now();
    new.last_seen_at := now();
    new.logout_at := null;
    return new;
  end if;

  -- ปิด session ไปแล้ว — ไม่ขยับอะไรอีก
  if old.logout_at is not null then
    return old;
  end if;

  new.user_id := old.user_id;
  new.login_at := old.login_at;
  new.last_seen_at := now();
  if new.logout_at is not null then
    new.logout_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists user_activity_sessions_stamp on user_activity_sessions;
create trigger user_activity_sessions_stamp
  before insert or update on user_activity_sessions
  for each row execute function user_activity_sessions_stamp();
