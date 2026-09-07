import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { IconLock, IconMail } from '../components/icons'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setMsg({ kind: 'err', text: translateAuthError(error.message) })
    setBusy(false)
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <div style={{ marginBottom: 24 }}>
          <div className="brand-mark" style={{ padding: 0 }}>
            <img className="logo" src="/logo-sidebar.png" alt="" aria-hidden="true" />
            <span className="txt">
              <b style={{ fontSize: 19 }}>
                <span className="accent">2K</span> Driver Profile
              </b>
            </span>
          </div>
          <p className="muted" style={{ margin: '12px 0 0', fontSize: 14 }}>
            ระบบโปรไฟล์ ประวัติงาน และคะแนนพนักงานขับรถ
          </p>
        </div>

        <form className="card card-pad login-card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">อีเมลบริษัท</label>
            <div className="input-icon">
              <IconMail size={16} />
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@2klogistics.co.th"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="pw">รหัสผ่าน</label>
            <div className="input-icon">
              <IconLock size={16} />
              <input
                id="pw"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>

          {msg && (
            <div
              className={`note-box ${msg.kind === 'err' ? 'err' : 'ok'}`}
              style={{ marginBottom: 14 }}
            >
              {msg.text}
            </div>
          )}

          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'กำลังดำเนินการ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <p className="login-footer">เข้าถึงได้เฉพาะบัญชีที่ได้รับอนุมัติจากองค์กร · 2K Logistics</p>
      </div>
    </div>
  )
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  if (m.includes('email not confirmed')) return 'ยังไม่ได้ยืนยันอีเมล ตรวจกล่องจดหมายก่อน'
  return msg
}
