-- 0038: ลบประวัติ "เข้าใช้งานระบบ" ที่บันทึกผิดจากบั๊ก heartbeat
--
-- บั๊ก: heartbeat ใน sessionTracking.ts จบที่ .eq() โดยไม่มี .then() — query ของ supabase-js
-- เป็น lazy จึงไม่เคยถูกส่งเลย แถวที่ไม่ได้กดออกจากระบบทุกแถวจึงมี last_seen_at = login_at
-- ขึ้นในหน้าบันทึกกิจกรรมว่า "อยู่ในระบบ ไม่ถึงนาที" ซึ่งไม่จริง และกู้เวลาจริงคืนไม่ได้
--
-- เงื่อนไขเลือกเฉพาะแถวเสีย: ไม่มี logout_at และ last_seen_at ไม่เคยขยับจาก login_at
-- เว้นแถวที่เพิ่งเริ่มไม่ถึง 5 นาที (หลังแก้แล้ว heartbeat แรกมาภายใน 60 วิ แถวที่ยังเท่ากัน
-- หลัง 5 นาทีจึงเป็นแถวเสียเท่านั้น — รันซ้ำหรือรันหลัง deploy ก็ไม่ลบแถวดี)
-- แถวที่กดออกจากระบบ (มี logout_at) เก็บไว้ เพราะเวลาออกบันทึกถูกต้อง

delete from user_activity_sessions
where logout_at is null
  and last_seen_at = login_at
  and login_at < now() - interval '5 minutes';
