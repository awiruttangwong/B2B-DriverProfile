-- 0037: เก็บประวัติ "เข้าใช้งานระบบ" ไว้แค่ 60 วัน ไม่ให้ตาราง user_activity_sessions โตไม่มีที่สิ้นสุด
--
-- ไม่ใช้ pg_cron (แนวทางเดียวกับ 0031 — ไม่พึ่ง job ตามเวลา) แต่ลบแถวเก่าทุกครั้งที่มี session ใหม่
-- เกิดขึ้น: มีคนเปิดแอปวันละหลายครั้งอยู่แล้ว ข้อมูลจึงไม่ค้างเกิน 60 วันนานนัก และถ้าไม่มีใครเข้า
-- ระบบเลย ก็ไม่มีแถวใหม่ให้รกอยู่ดี
--
-- security definer เพราะผู้ใช้ทั่วไปไม่มีสิทธิ์ delete บนตารางนี้ (ตั้งใจ — ห้ามลบประวัติตัวเอง)
-- ฟังก์ชันนี้ทำได้อย่างเดียวคือลบแถวที่เก่ากว่า 60 วัน ไม่รับพารามิเตอร์จากผู้ใช้

create index if not exists user_activity_sessions_login_idx on user_activity_sessions (login_at);

create or replace function user_activity_sessions_purge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_activity_sessions
  where login_at < now() - interval '60 days';
  return null;
end
$$;

-- ฟังก์ชัน trigger เรียกผ่าน RPC ไม่ได้อยู่แล้ว แต่ปิด execute ไว้ด้วยกัน Security Advisor เตือน
revoke execute on function user_activity_sessions_purge() from public, anon, authenticated;

drop trigger if exists user_activity_sessions_purge on user_activity_sessions;
create trigger user_activity_sessions_purge
  after insert on user_activity_sessions
  for each statement execute function user_activity_sessions_purge();

-- ล้างของที่เกินอยู่แล้วตอนนี้เลยหนึ่งรอบ
delete from user_activity_sessions where login_at < now() - interval '60 days';
