import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { IS_DEMO, supabase } from './lib/supabase'
import { roleLabel, fmtNum } from './lib/format'
import {
  IconBan,
  IconClock,
  IconLogout,
  IconPause,
  IconStar,
  IconTarget,
  IconTruck,
  IconUpload,
  IconUsers,
} from './components/icons'
import ThemeToggle from './components/ThemeToggle'
import Login from './pages/Login'
import Drivers from './pages/Drivers'
import DriverProfile from './pages/DriverProfile'
import FindDriver from './pages/FindDriver'
import PendingRatings from './pages/PendingRatings'
import Suspended from './pages/Suspended'
import Blacklist from './pages/Blacklist'
import Upload from './pages/Upload'
import NewJob from './pages/NewJob'
import ActivityLog from './pages/ActivityLog'

/**
 * อักษรย่อสำหรับ avatar กลม — เอาตัวแรกของคำแรกกับคำที่สอง ถ้ามีคำเดียวก็ตัด 2 ตัวแรก
 * ยกเว้นคำเดียวที่สั้นอยู่แล้ว (ไม่เกิน 3 ตัว เช่น "CEO") แสดงเต็ม ไม่งั้นตัดเหลือ "CE"
 * ซึ่งไม่ใช่ตำแหน่งที่ตั้งใจ
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, parts[0]!.length <= 3 ? 3 : 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
}

/**
 * ป้ายอวตารที่ตั้งไว้เองรายบัญชี ใช้แทนผลจาก initials() ตรง ๆ — initials() ตัดแค่ 2 ตัวอักษร
 * แรกของคำเดียว ซึ่งพอเจอชื่อที่ขึ้นต้นเหมือนกัน (พี่โบ๊ท/พี่ชา/พี่ซ้ง) จะได้ "พี" เหมือนกัน
 * หมดจนแยกคนไม่ออก หรือคำขาดกลางดูแปลก (จี๊ด -> จี) รายชื่อนี้เจ้าของบัญชีเลือกเองทีละคน
 * ทาง Claude/แชท ไม่ใช่กติกาอัตโนมัติ
 *
 * คีย์เป็นอีเมล ไม่ใช่ full_name เพราะ full_name แก้ไขเองได้ทีหลัง อีเมลผูกกับบัญชีตายตัวกว่า
 */
const AVATAR_OVERRIDES: Record<string, string> = {
  'admin@2klogistics.co.th': 'Admin',
  'awirut.tan@2klogistics.co.th': 'DATA',
  'transport@2klogistics.co.th': 'โบ๊ท',
  'pracha2kl@gmail.com': 'ชา',
  'ptrwd25644@gmail.com': 'แก้ว',
  '2kl.transport0013@gmail.com': 'ซ้ง',
  'admtsp2kl@gmail.com': 'จี๊ด',
  'datacenter@2klogistics.co.th': 'DATA',
}

function avatarLabel(name: string, email: string | null | undefined): string {
  if (email && AVATAR_OVERRIDES[email]) return AVATAR_OVERRIDES[email]!
  return initials(name)
}

/**
 * initials() เองไม่เคยยาวเกิน 3 ตัวอักษร จึงพอดีวงกลม 28px ที่ font-size ปกติ (10.5px) เสมอ
 * แต่ AVATAR_OVERRIDES ตั้งเองได้ยาวกว่านั้น (เช่น "Admin" 5 ตัวอักษรละติน) ซึ่งล้นวงกลมถ้าใช้
 * ขนาดเดิม — ตัวอักษรไทยที่ยาวเท่ากัน (จี๊ด, แก้ว, โบ๊ท ฯลฯ) ไม่มีปัญหานี้เพราะสระ/วรรณยุกต์
 * ซ้อนไม่กินความกว้างเพิ่ม มีแค่ละตินล้วนยาว ๆ เท่านั้นที่ต้องลดขนาดลง (วัดจริงกับตัวอักษร
 * ที่ตั้งไว้ทุกตัวแล้วด้วยหน้าจอทดสอบแยก — "Admin" ล้นที่ 10.5px พอดีที่ 9px ตัวอื่นพอดีอยู่แล้ว)
 */
function avatarFontSize(label: string): number {
  return label.length > 4 ? 9 : 10.5
}

/**
 * ย่อขนาดตัวอักษรชื่อ/อีเมลอัตโนมัติตามความยาว แทนการตัดด้วย ... เพราะบางบัญชี
 * ใช้อีเมลยาว (เช่น 2kl.transport0013@gmail.com) ต้องเห็นอีเมลเต็มเพื่อยืนยันว่า
 * เข้าระบบด้วยบัญชีที่ถูกต้อง
 *
 * ตัวเลขช่วงตัดวัดจากความกว้างจริงของคอลัมน์ในไซด์บาร์ (ไม่ใช่กะเอง — เคยกะแล้วพลาด
 * เพราะ .user-info มี flex-grow: 0 บีบพื้นที่จริงเหลือ ~137px ไม่ใช่ ~164px ที่คำนวณผิดตอนแรก)
 * แล้วทดสอบย้อนกลับกับอีเมลจริงทั้ง 7 บัญชี เผื่อระยะขอบไว้อย่างน้อย ~0.8px ทุกกรณี
 */
function fitFontSize(text: string): number {
  const len = text.length
  if (len <= 17) return 13
  if (len <= 20) return 11
  return 9
}

function Tab({ to, icon, children, count }: { to: string; icon: ReactNode; children: ReactNode; count?: number }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
      {icon}
      <span>{children}</span>
      {count !== undefined && count > 0 && <span className="count">{fmtNum(count)}</span>}
    </NavLink>
  )
}

/**
 * จำนวนคนขับสถานะ active/probation ที่ยังไม่เคยถูกประเมิน — นับตามสถานะ
 * ในระบบล้วน ๆ ไม่กรองด้วยความเคลื่อนไหวล่าสุดอีกต่อไป เพราะสถานะคือสิ่งที่
 * คนตัดสินใจเองอยู่แล้ว (พักงาน/ห้ามใช้งานเมื่อไม่ได้ใช้งานจริง) ถ้ายังนับซ้อน
 * ด้วยเงื่อนไขวันที่อีกชั้น ตัวเลขจะไม่ตรงกับความหมายของคำว่า "active" ที่ระบบ
 * ยึดถือ ต้องใช้เงื่อนไขเดียวกับค่าเริ่มต้นของหน้า /pending เสมอ ไม่งั้นตัวเลข
 * จะไม่ตรงกันข้ามหน้า
 */
function usePendingCount() {
  const { data } = useQuery({
    queryKey: ['pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('drivers_pending_review')
        .select('id', { count: 'exact' })
        .limit(1)
      if (error) throw error
      return count ?? 0
    },
    staleTime: 2 * 60_000,
  })
  return data
}

function useBlacklistCount() {
  const { data } = useQuery({
    queryKey: ['blacklist-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('driver_directory')
        .select('id', { count: 'exact' })
        .eq('status', 'blacklisted')
        .limit(1)
      if (error) throw error
      return count ?? 0
    },
    staleTime: 2 * 60_000,
  })
  return data
}

function useSuspendedCount() {
  const { data } = useQuery({
    queryKey: ['suspended-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('driver_directory')
        .select('id', { count: 'exact' })
        .eq('status', 'inactive')
        .limit(1)
      if (error) throw error
      return count ?? 0
    },
    staleTime: 2 * 60_000,
  })
  return data
}

function NavLinks() {
  const { canSeeActivityLog } = useAuth()
  const pending = usePendingCount()
  const suspended = useSuspendedCount()
  const blacklisted = useBlacklistCount()
  return (
    <nav className="nav" aria-label="เมนูหลัก">
      <Tab to="/drivers" icon={<IconUsers />}>
        รายชื่อ พขร.
      </Tab>
      <Tab to="/find" icon={<IconTarget />}>
        หา พขร. เพื่อเข้ารับงาน
      </Tab>
      <Tab to="/pending" icon={<IconStar />} count={pending}>
        รอประเมิน
      </Tab>
      <Tab to="/suspended" icon={<IconPause />} count={suspended}>
        พักงาน
      </Tab>
      <Tab to="/blacklist" icon={<IconBan />} count={blacklisted}>
        แบล็คลิสต์
      </Tab>
      <Tab to="/jobs/new" icon={<IconTruck />}>
        บันทึกงาน
      </Tab>
      <Tab to="/upload" icon={<IconUpload />}>
        อัปโหลดไฟล์
      </Tab>
      {canSeeActivityLog && (
        <Tab to="/activity-log" icon={<IconClock />}>
          บันทึกกิจกรรม
        </Tab>
      )}
    </nav>
  )
}

/**
 * หน้าจอตอนเปิดแอป — ช่วงที่ยังไม่รู้ว่ามี session อยู่หรือไม่ จึงยังตัดสินใจไม่ได้
 * ว่าจะวาดโครงหน้าหลักหรือหน้าเข้าสู่ระบบ
 *
 * เป็นหน้าจอแรกที่ผู้ใช้เห็นทุกครั้งที่เปิดระบบ เดิมเป็น spinner ขนาด 15px ลอยอยู่
 * กลางพื้นที่ว่างทั้งจอซึ่งดูเหมือนหน้าค้างมากกว่าหน้ากำลังโหลด จึงใส่โลโก้กับชื่อ
 * ระบบกำกับให้รู้ว่ากำลังเข้าระบบอะไรอยู่ และใช้แถบความคืบหน้าแทนวงกลมหมุน
 */
function BootScreen() {
  return (
    <div className="boot">
      <div className="boot-inner">
        <img className="boot-logo" src="/logo-sidebar.png" alt="" aria-hidden="true" />
        <span className="boot-brand">
          <span className="accent">2K</span> Driver Profile
        </span>
        <span className="boot-bar" role="progressbar" aria-label="กำลังโหลดระบบ" />
        <span className="boot-note">กำลังเตรียมระบบ…</span>
      </div>
    </div>
  )
}

function Shell() {
  const { session, profile, loading, canSeeActivityLog, signOut } = useAuth()

  // ซ่อมแถว พขร. ที่พ้นกำหนดพักงานแล้วให้กลับเป็น "ใช้งาน" จริง ๆ ในตาราง (ไม่ใช่แค่
  // คำนวณสดตอน query) ครั้งเดียวตอนเข้าแอป — fire-and-forget ไม่บล็อกหน้าจอ ไม่ต้อง
  // สนใจผลลัพธ์หรือ error เพราะความถูกต้องที่ผู้ใช้เห็นมาจาก driver_effective_status()
  // ในตัว view/ฟังก์ชันค้นหาอยู่แล้วเสมอ ไม่ว่าฟังก์ชันนี้จะถูกเรียกสำเร็จหรือไม่ก็ตาม
  // ฟังก์ชันนี้แค่ทำให้แถวจริงกับประวัติไม่ค้างเป็นสถานะเก่าเรื่อย ๆ เฉย ๆ
  // โหมดทดลองไม่มีฐานข้อมูลจริงให้ซ่อม จึงข้ามไปเลย ไม่ต้องยิง rpc ที่รู้อยู่แล้วว่าไม่รองรับ
  useEffect(() => {
    if (IS_DEMO || !session) return
    void supabase.rpc('fn_expire_driver_suspensions').then(({ error }) => {
      if (error) console.warn('ซ่อมสถานะพักงานที่พ้นกำหนดไม่สำเร็จ (ไม่กระทบการใช้งาน):', error.message)
    })
  }, [session])

  if (loading && !session) return <BootScreen />

  if (!session) return <Login />

  // บัญชีที่ถูกปิดใช้งานยังล็อกอินผ่าน (Supabase Auth ไม่รู้จักคอลัมน์ is_active ของเรา)
  // และยังอ่านข้อมูลได้ตาม policy ที่เปิดให้ authenticated ทุกคน — ต้องกันที่นี่
  // ส่วนสิทธิ์ "เขียน" ฐานข้อมูลกันให้อยู่แล้วผ่าน has_role() ที่เช็ค is_active
  if (profile && !profile.is_active) {
    return (
      <main className="page" style={{ maxWidth: 520, paddingTop: 80 }}>
        <div className="card card-pad">
          <h1 style={{ fontSize: 19, marginTop: 0 }}>บัญชีนี้ถูกปิดใช้งาน</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            บัญชี {session.user.email} ถูกระงับการใช้งานโดยผู้ดูแลระบบ
            ติดต่อผู้ดูแลระบบหากคิดว่าเป็นความผิดพลาด
          </p>
          <button className="btn btn-primary" onClick={() => void signOut()}>
            ออกจากระบบ
          </button>
        </div>
      </main>
    )
  }

  // โชว์อีเมลเป็นหลัก ไม่ใช่ full_name — full_name เป็นแค่ชื่อเล่นสั้น ๆ (เช่น "พี่ซ้ง")
  // ผู้ใช้ต้องเห็นอีเมลเต็มเพื่อยืนยันว่ากำลังใช้บัญชีไหนอยู่ ชื่อเล่นไปโชว์เป็น title
  // (hover เห็น) แทน ไม่ได้หายไปไหน
  const displayName = session.user.email ?? profile?.full_name ?? '?'
  const avatar = avatarLabel(profile?.full_name ?? displayName, session.user.email)

  return (
    <div className="app">
      {IS_DEMO && (
        <div className="demo-bar">
          โหมดทดลอง — ข้อมูลจริง 7,556 เที่ยวอ่านจากไฟล์ในเครื่อง ยังไม่ได้ต่อฐานข้อมูล
          สิ่งที่บันทึกจะหายเมื่อรีเฟรช
        </div>
      )}

      <div className="shell">
        <aside className="sidebar">
          <div className="brand-mark">
            <img className="logo" src="/logo-sidebar.png" alt="" aria-hidden="true" />
            <span className="txt">
              <b>
                <span className="accent">2K</span> Driver Profile
              </b>
            </span>
          </div>

          <NavLinks />

          <div className="sidebar-foot">
            <div style={{ marginBottom: 14 }}>
              <ThemeToggle />
            </div>
            <div className="account-card">
              <div className="user-card">
                <span className="user-avatar" aria-hidden="true" style={{ fontSize: avatarFontSize(avatar) }}>
                  {avatar}
                </span>
                <span className="user-info">
                  <b
                    style={{ fontSize: fitFontSize(displayName) }}
                    title={profile?.full_name ?? undefined}
                  >
                    {displayName}
                  </b>
                  {profile && (
                    <span className="badge brand">{roleLabel(profile.role, profile.email)}</span>
                  )}
                </span>
              </div>
              <button className="signout" onClick={() => void signOut()}>
                <IconLogout size={14} />
                ออกจากระบบ
              </button>
            </div>
          </div>
        </aside>

        <div className="main-col">
          <header className="topbar">
            <div className="brand-mark" style={{ padding: 0 }}>
              <img className="logo" src="/logo-sidebar.png" alt="" aria-hidden="true" />
            </div>
            <NavLinks />
          </header>

          <Routes>
            <Route path="/" element={<Navigate to="/drivers" replace />} />
            <Route path="/drivers" element={<Drivers />} />
            <Route path="/drivers/:id" element={<DriverProfile />} />
            <Route path="/find" element={<FindDriver />} />
            <Route path="/pending" element={<PendingRatings />} />
            <Route path="/suspended" element={<Suspended />} />
            <Route path="/blacklist" element={<Blacklist />} />
            <Route path="/jobs/new" element={<NewJob />} />
            <Route path="/upload" element={<Upload />} />
            <Route
              path="/activity-log"
              element={
                // ต้องรอ profile โหลดก่อนตัดสินสิทธิ์ — ถ้า redirect ทันทีตอน loading
                // ยังเป็น true (เช่น รีเฟรชหน้าตรง /activity-log) แอดมินจะโดนเด้งออก
                // ไปหน้า /drivers ก่อนที่ role จะโหลดเสร็จด้วยซ้ำ
                loading ? (
                  <div className="empty" style={{ paddingTop: 120 }}>
                    <span className="spinner" /> กำลังโหลด…
                  </div>
                ) : canSeeActivityLog ? (
                  <ActivityLog />
                ) : (
                  <Navigate to="/drivers" replace />
                )
              }
            />
            <Route path="*" element={<Navigate to="/drivers" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}
