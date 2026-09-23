-- =============================================================================
-- 0032_security_advisor_fixes.sql
--
-- แก้ตาม Supabase Security Advisor (Database → Advisors → Security Advisor)
-- ทั้งหมดเป็น WARN ระดับ external-facing ไม่มี error — สรุปที่มาและการแก้แต่ละกลุ่ม
-- ทุกจุดทดสอบผ่าน PGlite แล้วก่อนเขียนไฟล์นี้ (จำลอง role anon/authenticated จริง
-- ผ่าน SET ROLE + ทดสอบทั้งเรียกฟังก์ชันตรง ๆ และผ่าน RLS policy)
--
-- 1) function_search_path_mutable (6 ฟังก์ชัน)
--    ฟังก์ชันที่ไม่ได้ตั้ง search_path ตายตัว เสี่ยงถูกคนร้ายที่มีสิทธิ์สร้าง object ในสคีมา
--    อื่นมาแอบอ้างชื่อ object ที่ฟังก์ชันเรียกแบบไม่ระบุสคีมา (search_path hijacking) —
--    ฟังก์ชันอื่นในระบบที่ตั้ง `set search_path = public` ไว้ตั้งแต่แรกแล้วไม่ติดปัญหานี้
--    (เช่น auth_role, fn_recalc_overall_score) ใช้ ALTER FUNCTION เติมให้ครบแบบเดียวกัน
--    ไม่ต้องเขียนตัวฟังก์ชันใหม่เลย
--
-- 2) extension_in_public (pg_trgm)
--    ส่วนขยาย pg_trgm ถูกติดตั้งไว้ใน schema public ตั้งแต่ 0001 — แนะนำให้ย้ายไปสคีมา
--    แยกต่างหาก ทดสอบด้วย PGlite แล้วว่าย้ายแล้วดัชนี trigram เดิม (drivers_name_trgm_idx,
--    jobs_route_trgm_idx) ยังคง valid และยังถูก query planner เลือกใช้ได้ปกติ เพราะดัชนี
--    ผูกกับ operator class ด้วย OID ภายใน ไม่ได้ผูกด้วยชื่อ/search_path ตอน query จริง —
--    ไม่ต้องแก้โค้ดแอปหรือ query ใด ๆ เลย
--
-- 3) anon/authenticated_security_definer_function_executable (10 ฟังก์ชัน)
--    ฟังก์ชันกลุ่มนี้เป็น security definer แต่ไม่เคย revoke สิทธิ์เรียกจาก PUBLIC เลย
--    (Postgres ให้สิทธิ์ EXECUTE กับ PUBLIC อัตโนมัติตอนสร้างฟังก์ชัน ถ้าไม่ revoke ออก)
--    ทำให้ใครก็ได้ แม้ไม่ล็อกอิน (anon) เรียกผ่าน /rest/v1/rpc/<ชื่อฟังก์ชัน> ได้ตรง ๆ
--    แบ่งเป็นสามกลุ่มตามว่าควรเปิดให้ใครเรียกได้บ้าง:
--
--    3a) ฟังก์ชัน trigger ล้วน ๆ (fn_handle_new_user, fn_log_driver_status_change,
--        fn_recalc_overall_score, fn_sync_driver_job_dates) — ไม่มีใครควรเรียกตรงเลย
--        ทริกเกอร์เองไม่ต้องมีสิทธิ์ EXECUTE ถึงจะทำงานได้ (กลไกคนละเส้นทางกับการเรียก SQL
--        ตรง ๆ) ทดสอบด้วย PGlite แล้วว่า revoke ออกจาก PUBLIC ทั้งหมดแล้วทริกเกอร์ยังยิง
--        ทำงานปกติ 100% — จึงตัดสิทธิ์เรียกตรงออกทั้งหมด ไม่ grant คืนให้ใครเลย
--
--    3b) ฟังก์ชันช่วยตรวจสิทธิ์ที่ policy RLS พึ่งพา (auth_role, has_role, can_see_pii,
--        can_write_master, can_see_activity_log) — authenticated ต้องเรียกได้ เพราะตอน
--        Postgres ประเมิน policy RLS จะเรียกฟังก์ชันเหล่านี้ด้วยสิทธิ์ของ role ที่กำลังคิวรี
--        อยู่ (authenticated) ถ้าตัด EXECUTE ของ authenticated ออกไปด้วย ทุก insert/update/
--        select ที่มี policy อ้างฟังก์ชันพวกนี้จะพังทันที (ทดสอบยืนยันแล้วด้วย PGlite:
--        revoke จาก PUBLIC แล้ว grant คืนเฉพาะ authenticated ยัง insert ผ่าน policy ได้ปกติ
--        ทั้งเคสผ่านและเคสถูกบล็อกโดย RLS) — anon ไม่มีเหตุผลต้องเรียกได้เลย ตัดออก
--
--    3c) fn_expire_driver_suspensions — แอปเรียกเองตอน mount (App.tsx) ด้วยสิทธิ์ของ
--        ผู้ใช้ที่ล็อกอินอยู่ (authenticated) ต้องเปิดให้ authenticated เรียกได้เหมือนเดิม
--        (มีอยู่แล้วตั้งแต่ 0031) แค่ตัด anon ที่ไม่เคยตั้งใจเปิดออก — ฟังก์ชันนี้ทำได้แค่
--        เลื่อนแถวที่พ้นกำหนดพักงานไปแล้วให้เป็น active เท่านั้น (ดูคอมเมนต์ 0031) จึงไม่มี
--        ความเสี่ยงด้านสิทธิ์แม้ anon เรียกได้มาก่อนหน้านี้ก็ตาม แค่ไม่ควรเปิดทิ้งไว้เฉย ๆ
--
--    submit_rating / search_routes / search_drivers ไม่อยู่ในกลุ่มนี้ เพราะประกาศเป็น
--    security invoker อยู่แล้ว (สิทธิ์จริงยังคงบังคับด้วย RLS/policy ของผู้เรียกตามปกติ)
--
-- 4) auth_leaked_password_protection — เป็นค่าตั้งค่าระดับ Auth service ไม่ใช่ object ใน
--    ฐานข้อมูล แก้ผ่าน SQL ไม่ได้ ต้องเข้า Dashboard → Authentication → Policies (หรือ
--    Auth settings) แล้วเปิดสวิตช์ "Leaked password protection" เอง
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) เติม search_path ให้ฟังก์ชันที่ยังไม่มี — แค่เติม config ไม่แตะเนื้อหาฟังก์ชันเลย
-- -----------------------------------------------------------------------------
alter function fn_touch_updated_at() set search_path = public;
alter function fn_driver_contacts_guard() set search_path = public;
alter function driver_effective_status(driver_status, date) set search_path = public;
alter function submit_rating(uuid, uuid, text, text[], boolean, jsonb) set search_path = public;
alter function search_routes(int) set search_path = public;
alter function search_drivers(text, text, text, boolean, boolean, boolean, int) set search_path = public;

-- -----------------------------------------------------------------------------
-- 2) ย้าย pg_trgm ออกจาก schema public
-- -----------------------------------------------------------------------------
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- -----------------------------------------------------------------------------
-- 3a) ฟังก์ชัน trigger ล้วน ๆ — ตัดสิทธิ์เรียกตรงออกทั้งหมด ไม่ grant คืนให้ใครเลย
-- -----------------------------------------------------------------------------
revoke execute on function fn_handle_new_user() from public;
revoke execute on function fn_log_driver_status_change() from public;
revoke execute on function fn_recalc_overall_score() from public;
revoke execute on function fn_sync_driver_job_dates() from public;

-- -----------------------------------------------------------------------------
-- 3b) ฟังก์ชันช่วย RLS — ตัด anon ออก คงไว้ให้ authenticated เรียกได้เหมือนเดิม
-- -----------------------------------------------------------------------------
revoke execute on function auth_role() from public;
revoke execute on function has_role(app_role[]) from public;
revoke execute on function can_see_pii() from public;
revoke execute on function can_write_master() from public;
revoke execute on function can_see_activity_log() from public;

grant execute on function auth_role() to authenticated;
grant execute on function has_role(app_role[]) to authenticated;
grant execute on function can_see_pii() to authenticated;
grant execute on function can_write_master() to authenticated;
grant execute on function can_see_activity_log() to authenticated;

-- -----------------------------------------------------------------------------
-- 3c) fn_expire_driver_suspensions — ตัด anon ออก คง authenticated ไว้เหมือนเดิม
-- -----------------------------------------------------------------------------
revoke execute on function fn_expire_driver_suspensions() from public;
grant execute on function fn_expire_driver_suspensions() to authenticated;
