import type { ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { IS_DEMO, supabase } from './lib/supabase'
import { ROLE_LABEL, fmtNum } from './lib/format'
import { IconStar, IconTarget, IconTruck, IconUpload, IconUsers } from './components/icons'
import ThemeToggle from './components/ThemeToggle'
import Login from './pages/Login'
import Drivers from './pages/Drivers'
import DriverProfile from './pages/DriverProfile'
import FindDriver from './pages/FindDriver'
import PendingRatings from './pages/PendingRatings'
import Upload from './pages/Upload'
import NewJob from './pages/NewJob'

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
            <span className="logo" aria-hidden="true">
              2K
            </span>
            <span className="txt">
              <b>พขร. Profile</b>
              <span>2K Logistics</span>
            </span>
          </div>

          <NavLinks />

          <div className="sidebar-foot">
            <div style={{ marginBottom: 12 }}>
              <ThemeToggle />
            </div>
            <b>{profile?.full_name ?? session.user.email}</b>
            {profile ? ROLE_LABEL[profile.role] ?? profile.role : ''}
            <button
              className="btn btn-sm"
              style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
              onClick={() => void signOut()}
            >
              ออกจากระบบ
            </button>
          </div>
        </aside>

        <div className="main-col">
          <header className="topbar">
            <div className="brand-mark" style={{ padding: 0 }}>
              <span className="logo" aria-hidden="true">
                2K
              </span>
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
