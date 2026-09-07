import type { ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { IS_DEMO, supabase } from './lib/supabase'
import { ROLE_LABEL, fmtNum } from './lib/format'
import { IconLogout, IconStar, IconTarget, IconTruck, IconUpload, IconUsers } from './components/icons'
import ThemeToggle from './components/ThemeToggle'
import Login from './pages/Login'
import Drivers from './pages/Drivers'
import DriverProfile from './pages/DriverProfile'
import FindDriver from './pages/FindDriver'
import PendingRatings from './pages/PendingRatings'
import Upload from './pages/Upload'
import NewJob from './pages/NewJob'

/** อักษรย่อสำหรับ avatar กลม — เอาตัวแรกของคำแรกกับคำที่สอง ถ้ามีคำเดียวก็ตัด 2 ตัวแรก */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
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

/** จำนวนงานที่ยังไม่มีใครให้คะแนน — โชว์เป็นตัวเลขบนเมนูให้เห็นว่ามีงานค้าง */
function usePendingCount() {
  const { data } = useQuery({
    queryKey: ['pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('pending_ratings')
        .select('assignment_id', { count: 'exact' })
        .limit(1)
      if (error) throw error
      return count ?? 0
    },
    staleTime: 2 * 60_000,
  })
  return data
}

function NavLinks() {
  const pending = usePendingCount()
  return (
    <nav className="nav" aria-label="เมนูหลัก">
      <Tab to="/drivers" icon={<IconUsers />}>
        รายชื่อ พขร.
      </Tab>
      <Tab to="/find" icon={<IconTarget />}>
        หาคนสำหรับงาน
      </Tab>
      <Tab to="/pending" icon={<IconStar />} count={pending}>
        รอให้คะแนน
      </Tab>
      <Tab to="/jobs/new" icon={<IconTruck />}>
        บันทึกงาน
      </Tab>
      <Tab to="/upload" icon={<IconUpload />}>
        อัปโหลดไฟล์
      </Tab>
    </nav>
  )
}

function Shell() {
  const { session, profile, loading, signOut } = useAuth()

  if (loading && !session) {
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <span className="spinner" /> กำลังโหลด…
      </div>
    )
  }

  if (!session) return <Login />

  const displayName = profile?.full_name ?? session.user.email ?? '?'

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
                <span className="user-avatar" aria-hidden="true">
                  {initials(displayName)}
                </span>
                <span className="user-info">
                  <b style={{ fontSize: fitFontSize(displayName) }}>{displayName}</b>
                  {profile && <span className="badge brand">{ROLE_LABEL[profile.role] ?? profile.role}</span>}
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
            <Route path="/jobs/new" element={<NewJob />} />
            <Route path="/upload" element={<Upload />} />
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
