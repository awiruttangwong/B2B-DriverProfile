-- =============================================================================
-- 0033_fix_anon_execute_grant.sql
--
-- 0032 ใช้ `revoke ... from public` เพื่อตัดสิทธิ์ anon แต่ไม่ได้ผลจริง — ยืนยันจาก
-- proacl ที่ดึงมาดูหลังรัน 0032: {postgres=X/postgres,anon=X/postgres,
-- authenticated=X/postgres,service_role=X/postgres} ไม่มี PUBLIC (`=X/...` แบบไม่มีชื่อ
-- role) อยู่ในนั้นเลยสักที่ — Supabase ตั้งค่า default privileges ระดับโปรเจกต์ไว้ว่า
-- ฟังก์ชันใหม่ทุกตัวใน schema public ได้รับ EXECUTE แบบ grant ตรงให้ทีละ role (anon,
-- authenticated, service_role) ตั้งแต่สร้างเสร็จ ไม่ได้ผ่าน PUBLIC pseudo-role แบบ
-- Postgres ปกติเลย — revoke จาก public จึงเหมือนไม่ได้ทำอะไรกับ anon ที่ถูก grant ตรง
-- แยกไว้ต่างหากอยู่แล้ว
--
-- เรื่องนี้ทดสอบไม่เจอตอนทำ 0032 เพราะการตั้งค่า default privileges แบบนี้เป็นการตั้งค่า
-- ระดับโปรเจกต์ตอน provision (ทำครั้งเดียวตอนสร้างโปรเจกต์ ไม่ได้อยู่ใน migration ไฟล์ไหน
-- เลย) PGlite ที่ใช้ทดสอบจึงจำลองส่วนนี้ไม่ได้ — คราวนี้ทดสอบซ้ำด้วยการจำลอง
-- `alter default privileges ... grant execute on functions to anon, authenticated,
-- service_role` ก่อนสร้างฟังก์ชันเอง (ให้ตรงกับ proacl จริงที่เห็น) แล้วยืนยันแล้วว่า
-- revoke จาก anon ตรง ๆ (ไม่ใช่ from public) ถึงจะเห็นผลจริง โดย authenticated ไม่กระทบ
--
-- ไม่แตะ postgres/service_role: postgres เป็นเจ้าของ/superuser ที่ ACL ไม่มีผลบังคับอยู่
-- แล้ว ส่วน service_role bypass RLS ทั้งหมดโดยธรรมชาติของ role นี้เอง ไม่ได้ต้องพึ่ง
-- ฟังก์ชันพวกนี้เพื่อเช็คสิทธิ์ — และ Security Advisor เองก็ไม่มีหมวดแจ้งเตือนสำหรับ
-- service_role เลย (เชื่อถือได้ในตัวโดยดีไซน์ของ Supabase)
-- =============================================================================

-- 3a) trigger functions — ไม่มีใครควรเรียกตรงเลย ตัดทั้ง anon และ authenticated
revoke execute on function fn_handle_new_user() from anon, authenticated;
revoke execute on function fn_log_driver_status_change() from anon, authenticated;
revoke execute on function fn_recalc_overall_score() from anon, authenticated;
revoke execute on function fn_sync_driver_job_dates() from anon, authenticated;

-- 3b) ฟังก์ชันช่วย RLS — ตัดเฉพาะ anon เก็บ authenticated ไว้ (policy RLS ต้องพึ่งพา)
revoke execute on function auth_role() from anon;
revoke execute on function has_role(app_role[]) from anon;
revoke execute on function can_see_pii() from anon;
revoke execute on function can_write_master() from anon;
revoke execute on function can_see_activity_log() from anon;

-- 3c) fn_expire_driver_suspensions — ตัดเฉพาะ anon เก็บ authenticated ไว้เหมือนเดิม
revoke execute on function fn_expire_driver_suspensions() from anon;
