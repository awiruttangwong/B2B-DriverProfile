import { useCallback, useEffect, useRef } from 'react'
import { supabase } from './supabase'

/** ทุก 90 วินาที — ถี่พอให้เวลา "ออก" ที่ประมาณไว้ไม่ห่างจากความจริงมาก แต่ไม่ถี่จนยิง query
 *  รกเกินไปสำหรับทั้งวันที่เปิดแท็บทิ้งไว้ */
const HEARTBEAT_MS = 90_000

/**
 * ติดตามช่วงเวลาที่ผู้ใช้อยู่ในระบบ (login_at ถึง logout_at/last_seen_at) เก็บลง
 * user_activity_sessions (0035_user_activity_sessions.sql) เพื่อไปโผล่เป็นประเภทกิจกรรม
 * "เข้าใช้งานระบบ" ในหน้าบันทึกกิจกรรม
 *
 * จุดยาก: ระบบตั้ง persistSession ไว้ คนส่วนใหญ่ปิดแท็บ/เบราว์เซอร์ทิ้งเฉย ๆ ไม่กดปุ่ม
 * "ออกจากระบบ" ก่อน — ใช้ heartbeat (last_seen_at) เป็นตัวประมาณเวลาออกแทนเมื่อไม่มีการกด
 * ออกจากระบบจริง (logout_at เป็น null) หน้า ActivityLog.tsx จะติดป้าย "ประมาณ" ให้ชัดเจน
 *
 * สร้าง id ฝั่ง client เอง (ไม่ใช้ .select().single() อ่านกลับหลัง insert) — ทดสอบด้วย PGlite
 * แล้วพบว่า insert().select() ผ่าน PostgREST ต้องพึ่ง select policy ด้วย ไม่ใช่แค่ insert
 * policy เฉยๆ ถ้าไม่สร้าง id เองไว้ล่วงหน้า จังหวะแรกสุดก่อนรู้ว่าผ่าน select policy หรือไม่
 * จะเสี่ยงอ่านกลับไม่เจอแถวที่เพิ่งสร้าง ทั้งที่ insert สำเร็จจริง — สร้างเองตรงนี้ตัดปัญหาทิ้งไปเลย
 */
export function useSessionTracking(userId: string | undefined) {
  const rowIdRef = useRef<string | null>(null)
  // กัน StrictMode ยิง insert ซ้ำสองรอบตอน mount (เหตุผลเดียวกับ effect โหลด profile ใน
  // auth.tsx — ตั้งค่า ref ก่อน await เสมอ ไม่ใช่ "ทำแล้วหรือยัง" แบบ boolean เพราะ StrictMode
  // จะยิง effect ซ้ำก่อนที่ค่าจะถูกตั้งจากรอบแรกทัน)
  const createdForRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!userId || createdForRef.current === userId) return
    createdForRef.current = userId

    const id = crypto.randomUUID()
    rowIdRef.current = id
    void supabase
      .from('user_activity_sessions')
      .insert({ id, user_id: userId })
      .then(({ error }) => {
        // insert ล้มเหลว (เช่น เน็ตหลุดจังหวะเปิดแอป) — เคลียร์ ref ทิ้ง ไม่งั้น heartbeat/
        // logout จะพยายามอัปเดตแถวที่ไม่มีอยู่จริงไปเรื่อย ๆ โดยไม่มีผลอะไรเงียบ ๆ
        if (error) {
          console.error('[sessionTracking] บันทึกเวลาเข้าใช้งานไม่สำเร็จ', error)
          rowIdRef.current = null
        }
      })

    function heartbeat() {
      if (!rowIdRef.current || document.visibilityState !== 'visible') return
      void supabase
        .from('user_activity_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', rowIdRef.current)
    }

    const interval = setInterval(heartbeat, HEARTBEAT_MS)
    // กลับมาเห็นแท็บอีกครั้ง (สลับแท็บ/สลับแอปกลับมา) = ping ทันทีหนึ่งที ไม่ต้องรอรอบถัดไป
    document.addEventListener('visibilitychange', heartbeat)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', heartbeat)
    }
  }, [userId])

  // useCallback ให้ reference คงที่ — auth.tsx เอาไปใส่ dependency array ของ useMemo ตัว value
  // หลักด้วย ถ้าไม่ memo ฟังก์ชันนี้จะเป็นตัวใหม่ทุก render ทำให้ useMemo นั้นไม่ได้ผลอะไรเลย
  /** เรียกจาก signOut() ก่อนตัด session จริง — ได้ logout_at ที่แม่นยำสำหรับคนที่กดออกเองจริง ๆ
   *  (ต่างจากคนที่แค่ปิดแท็บทิ้ง ซึ่งจะไม่มี logout_at เลย ต้องอนุมานจาก last_seen_at แทน) */
  const markLoggedOut = useCallback(async () => {
    if (!rowIdRef.current) return
    const now = new Date().toISOString()
    await supabase
      .from('user_activity_sessions')
      .update({ logout_at: now, last_seen_at: now })
      .eq('id', rowIdRef.current)
  }, [])

  return { markLoggedOut }
}
