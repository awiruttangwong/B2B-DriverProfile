import { useCallback, useEffect, useRef } from 'react'
import { supabase } from './supabase'

/** ทุก 60 วินาที — เวลา "ออก" ที่ประมาณไว้คลาดจากความจริงไม่เกินหนึ่งนาที */
const HEARTBEAT_MS = 60_000
/** ห่างจาก ping ล่าสุดเกินนี้ (แท็บซ่อนทิ้งไว้/เครื่อง sleep) = ถือว่าเป็น session ใหม่ ไม่ขยายของเดิม
 *  ไม่งั้นเปิดแท็บค้างข้ามคืนแล้วกลับมาดู จะได้ "อยู่ในระบบ 14 ชม." ทั้งที่ไม่ได้ใช้จริง */
const IDLE_GAP_MS = 30 * 60_000
/** sessionStorage อยู่ต่อข้ามการรีเฟรชแต่หายเมื่อปิดแท็บ — รีเฟรชจึงใช้แถวเดิมต่อ ไม่สร้างแถวใหม่ */
const STORAGE_KEY = 'b2b.activitySession'

interface StoredSession {
  userId: string
  id: string
  lastPing: number
}

function readStored(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function writeStored(s: StoredSession | null) {
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // โหมดส่วนตัว/บล็อก storage — แค่รีเฟรชแล้วได้แถวใหม่ ไม่กระทบอย่างอื่น
  }
}

/**
 * ติดตามช่วงเวลาที่ผู้ใช้อยู่ในระบบ เก็บลง user_activity_sessions (0035) เพื่อไปโผล่เป็นประเภท
 * กิจกรรม "เข้าใช้งานระบบ" ในหน้าบันทึกกิจกรรม
 *
 * - เวลาทุกช่องประทับด้วยนาฬิกาเซิร์ฟเวอร์ (trigger ใน 0036) ค่าเวลาที่ส่งจากที่นี่เป็นแค่สัญญาณ
 * - คนส่วนใหญ่ปิดแท็บเฉย ๆ ไม่กดออกจากระบบ — ใช้ last_seen_at (heartbeat) เป็นเวลาออกโดยประมาณ
 *   และ ping ทันทีตอนแท็บถูกซ่อน/ปิด เพื่อให้ last_seen_at ใกล้จังหวะที่ออกจริงที่สุด
 * - สร้าง id ฝั่ง client เอง ไม่อ่านกลับหลัง insert (ต้องพึ่ง select policy — ดูคอมเมนต์ใน 0035)
 */
export function useSessionTracking(userId: string | undefined) {
  const rowIdRef = useRef<string | null>(null)
  // แถวปัจจุบันเป็นของ user คนไหน — StrictMode รัน effect ซ้ำจะเจอว่าตรงกันแล้วจึงไม่ insert ซ้ำ
  // แต่ยังผูก interval/listener ใหม่ตามปกติ (ต่างจากเดิมที่ return ออกไปก่อนผูก)
  const ownerRef = useRef<string | null>(null)
  const lastPingRef = useRef(0)

  useEffect(() => {
    if (!userId) {
      // ออกจากระบบแล้ว — ล้างทิ้ง เพื่อให้ login ใหม่ในแท็บเดิมได้แถวใหม่
      rowIdRef.current = null
      ownerRef.current = null
      return
    }
    const uid = userId

    function remember(id: string) {
      lastPingRef.current = Date.now()
      writeStored({ userId: uid, id, lastPing: lastPingRef.current })
    }

    function startNew() {
      const id = crypto.randomUUID()
      rowIdRef.current = id
      ownerRef.current = uid
      remember(id)
      void supabase
        .from('user_activity_sessions')
        .insert({ id, user_id: uid })
        .then(({ error }) => {
          if (!error) return
          console.error('[sessionTracking] บันทึกเวลาเข้าใช้งานไม่สำเร็จ', error)
          if (rowIdRef.current === id) {
            rowIdRef.current = null
            ownerRef.current = null
            writeStored(null)
          }
        })
    }

    function ping() {
      const id = rowIdRef.current
      if (!id) return
      remember(id)
      void supabase
        .from('user_activity_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', id)
    }

    const idleTooLong = () => Date.now() - lastPingRef.current > IDLE_GAP_MS

    if (ownerRef.current !== uid) {
      const stored = readStored()
      if (stored && stored.userId === uid && Date.now() - stored.lastPing <= IDLE_GAP_MS) {
        // รีเฟรชหน้า — ใช้แถวเดิมต่อ
        rowIdRef.current = stored.id
        ownerRef.current = uid
        ping()
      } else {
        startNew()
      }
    }

    function tick() {
      if (document.visibilityState !== 'visible' || !ownerRef.current) return
      if (idleTooLong()) startNew()
      else ping()
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        // บันทึกจังหวะที่ออกจากแท็บ — ถ้าไม่ได้กลับมาอีก นี่คือเวลาออกที่ใกล้ความจริงที่สุด
        if (!idleTooLong()) ping()
        return
      }
      tick()
    }

    const interval = setInterval(tick, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId])

  /** เรียกจาก signOut() ก่อนตัด session จริง — ได้ logout_at ที่แม่นยำสำหรับคนที่กดออกเอง */
  const markLoggedOut = useCallback(async () => {
    const id = rowIdRef.current
    if (!id) return
    rowIdRef.current = null
    ownerRef.current = null
    writeStored(null)
    const now = new Date().toISOString()
    await supabase
      .from('user_activity_sessions')
      .update({ logout_at: now, last_seen_at: now })
      .eq('id', id)
  }, [])

  return { markLoggedOut }
}
