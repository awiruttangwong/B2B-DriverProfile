import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)

    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (error) {
      setMsg({ kind: 'err', text: translateAuthError(error.message) })
    } else if (mode === 'signup') {
      setMsg({
        kind: 'ok',
        text: 'สมัครเรียบร้อย ถ้าระบบตั้งให้ยืนยันอีเมล ให้ตรวจกล่องจดหมายก่อนเข้าใช้งาน',
      })
    }
    setBusy(false)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ marginBottom: 24 }}>
          <div className="brand-mark" style={{ padding: 0 }}>
            <span className="logo" style={{ width: 38, height: 38, fontSize: 15 }} aria-hidden="true">
              2K
            </span>
            <span className="txt">
              <b style={{ fontSize: 16 }}>พขร. Profile</b>
              <span>2K Logistics</span>
            </span>
          </div>
          <p className="muted" style={{ margin: '12px 0 0', fontSize: 14 }}>
            ระบบโปรไฟล์ ประวัติงาน และคะแนนพนักงานขับรถ
          </p>
        </div>

        <form className="card card-pad" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">อีเมลบริษัท</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="pw">รหัสผ่าน</label>
            <input
              id="pw"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
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
            {busy ? 'กำลังดำเนินการ…' : mode === 'signin' ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน'}
          </button>

          <p className="hint" style={{ textAlign: 'center', marginTop: 14 }}>
            {mode === 'signin' ? 'ยังไม่มีบัญชี? ' : 'มีบัญชีแล้ว? '}
            <button
              type="button"
              className="btn-ghost"
              style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin')
                setMsg(null)
              }}
            >
              {mode === 'signin' ? 'สมัครใช้งาน' : 'เข้าสู่ระบบ'}
            </button>
          </p>
        </form>

        <p className="hint" style={{ marginTop: 14 }}>
          ผู้ใช้คนแรกของระบบจะได้สิทธิ์ผู้ดูแลอัตโนมัติ คนถัดไปจะเริ่มที่สิทธิ์อ่านอย่างเดียว
          รอผู้ดูแลเลื่อนสิทธิ์ให้
        </p>
      </div>
    </div>
  )
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  if (m.includes('email not confirmed')) return 'ยังไม่ได้ยืนยันอีเมล ตรวจกล่องจดหมายก่อน'
  if (m.includes('already registered')) return 'อีเมลนี้สมัครไว้แล้ว ให้เข้าสู่ระบบแทน'
  if (m.includes('password should be')) return 'รหัสผ่านสั้นเกินไป ต้องอย่างน้อย 6 ตัวอักษร'
  return msg
}
