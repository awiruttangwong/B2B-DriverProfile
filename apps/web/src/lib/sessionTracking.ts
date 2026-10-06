import { useCallback, useEffect, useRef } from 'react'
import { IS_DEMO, SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase'

/**
 * กติกา: session หนึ่งเริ่มเมื่อเปิดแอป และสิ้นสุดเมื่อ "ปิดแท็บ" หรือ "กดออกจากระบบ" เท่านั้น
 * สลับไปแท็บอื่น/ย่อหน้าต่าง/รีเฟรช ไม่นับเป็นการออก
 *
 * - heartbeat ทุก 60 วินาทีตลอดเวลาที่แท็บเปิดอยู่ (รวมตอนแท็บถูกซ่อน) last_seen_at จึงตามทัน
 * - ตอนปิดแท็บ ยิง keepalive บันทึกเวลาสุดท้ายทันที — last_seen_at ของแถวที่ไม่มี logout_at คือ
 *   เวลาปิดแท็บ (ไม่ใส่ logout_at ตอนปิดแท็บ เพราะรีเฟรชก็ยิง pagehide เหมือนกัน แยกไม่ออก)
 * - เวลาทุกช่องประทับด้วยนาฬิกาเซิร์ฟเวอร์ (trigger ใน 0036)
 * - สร้าง id ฝั่ง client เอง ไม่อ่านกลับหลัง insert (ต้องพึ่ง select policy — ดูคอมเมนต์ใน 0035)
 *
 * ทุกคำสั่ง supabase ต้องมี .then()/await ต่อท้าย — query ของ supabase-js เป็น lazy ยิงจริงตอนถูก
 * then เท่านั้น (เคยพลาดมาแล้ว: heartbeat จบที่ .eq() เฉย ๆ เลยไม่เคยถูกส่ง)
 */

const HEARTBEAT_MS = 60_000
/** ไม่มี ping นานเกินนี้ = แท็บไม่ได้ทำงานอยู่จริง (ปิดแท็บแล้วกดกู้คืนแท็บ ซึ่ง sessionStorage
 *  ติดกลับมาด้วย / เครื่องหลับหรือปิดฝา) — session เดิมจบที่ ping ล่าสุด แล้วเริ่มแถวใหม่ ไม่งั้น
 *  ช่วงที่เครื่องปิดอยู่หลายชั่วโมงจะถูกนับเป็นเวลาอยู่ในระบบ
 *  เบราว์เซอร์หน่วง timer ของแท็บที่ซ่อนอยู่ได้ถึงราวนาทีละครั้ง จึงตั้งเผื่อไว้ 5 นาที */
const DEAD_GAP_MS = 5 * 60_000
/** sessionStorage อยู่ต่อข้ามการรีเฟรชแต่หายเมื่อปิดแท็บ — รีเฟรชจึงใช้แถวเดิมต่อ */
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

export function useSessionTracking(userId: string | undefined) {
  const rowIdRef = useRef<string | null>(null)
  // แถวปัจจุบันเป็นของ user คนไหน — StrictMode รัน effect ซ้ำจะเจอว่าตรงกันแล้วจึงไม่ insert ซ้ำ
  // แต่ยังผูก interval/listener ใหม่ตามปกติ
  const ownerRef = useRef<string | null>(null)
  const lastPingRef = useRef(0)
  // token ล่าสุด สำหรับ keepalive ตอนปิดแท็บ — ตอนนั้น await getSession() ไม่ทันแล้ว
  const tokenRef = useRef<string | null>(null)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      tokenRef.current = data.session?.access_token ?? null
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      tokenRef.current = s?.access_token ?? null
    })
    return () => sub.subscription.unsubscribe()
  }, [])

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
        .then(({ error }) => {
          if (error) console.error('[sessionTracking] heartbeat ไม่สำเร็จ', error)
        })
    }

    /** ping ที่ยังส่งถึงแม้หน้ากำลังถูกปิด — fetch แบบ keepalive เบราว์เซอร์ส่งต่อให้หลังแท็บปิดแล้ว */
    function finalPing() {
      const id = rowIdRef.current
      const token = tokenRef.current
      if (!id) return
      if (IS_DEMO || !token) {
        ping()
        return
      }
      remember(id)
      try {
        void fetch(`${SUPABASE_URL}/rest/v1/user_activity_sessions?id=eq.${id}`, {
          method: 'PATCH',
          keepalive: true,
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          // ค่าเวลาจริงประทับโดย trigger ฝั่งเซิร์ฟเวอร์
          body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
        }).catch(() => {})
      } catch {
        // ปิดแท็บไปแล้ว — heartbeat รอบล่าสุดคือเวลาที่ใกล้ที่สุดที่มี
      }
    }

    const deadGap = () => Date.now() - lastPingRef.current > DEAD_GAP_MS

    if (ownerRef.current !== uid) {
      const stored = readStored()
      if (stored && stored.userId === uid && Date.now() - stored.lastPing <= DEAD_GAP_MS) {
        // รีเฟรชหน้า — ใช้แถวเดิมต่อ
        rowIdRef.current = stored.id
        ownerRef.current = uid
        ping()
      } else {
        startNew()
      }
    }

    function tick() {
      if (!ownerRef.current) return
      // เครื่องเพิ่งตื่นจากการหลับ — ช่วงที่หลับไม่นับเป็นเวลาอยู่ในระบบ
      if (deadGap()) startNew()
      else ping()
    }

    function onVisibility() {
      // ซ่อนแท็บไม่ใช่การออก — แค่บันทึกเวลาไว้ก่อน เผื่อเป็นจังหวะก่อนปิดแท็บ (มือถือมักไม่ยิง
      // pagehide แต่ยิง visibilitychange แทน)
      if (document.visibilityState === 'hidden') finalPing()
      else tick()
    }

    const interval = setInterval(tick, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', finalPing)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', finalPing)
    }
  }, [userId])

  /** เรียกจาก signOut() ก่อนตัด session จริง — ได้ logout_at ที่แม่นยำ */
  const markLoggedOut = useCallback(async () => {
    const id = rowIdRef.current
    if (!id) return
    rowIdRef.current = null
    ownerRef.current = null
    writeStored(null)
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('user_activity_sessions')
      .update({ logout_at: now, last_seen_at: now })
      .eq('id', id)
    if (error) console.error('[sessionTracking] บันทึกเวลาออกจากระบบไม่สำเร็จ', error)
  }, [])

  return { markLoggedOut }
}
