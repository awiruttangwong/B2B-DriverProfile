import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'
const KEY = 'pb2b-theme'

/** อ่านค่าที่เลือกไว้ ถ้าอ่านไม่ได้ (โหมดส่วนตัว/ปิดคุกกี้) ให้ถือว่าตามระบบ */
function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(t: Theme) {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read)

  useEffect(() => {
    apply(theme)
    try {
      if (theme === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, theme)
    } catch {
      /* เก็บค่าไม่ได้ก็ยังใช้งานได้ปกติ แค่ไม่จำข้ามการรีเฟรช */
    }
  }, [theme])

  const opts: { v: Theme; label: string }[] = [
    { v: 'light', label: 'สว่าง' },
    { v: 'dark', label: 'มืด' },
    { v: 'system', label: 'ระบบ' },
  ]

  return (
    <div
      role="radiogroup"
      aria-label="ธีมสี"
      style={{
        display: 'flex',
        gap: 2,
        background: 'var(--surface-2)',
        borderRadius: 'var(--r-pill)',
        padding: 3,
      }}
    >
      {opts.map((o) => {
        const on = theme === o.v
        return (
          <button
            key={o.v}
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(o.v)}
            style={{
              flex: 1,
              border: 0,
              cursor: 'pointer',
              borderRadius: 'var(--r-pill)',
              padding: '4px 6px',
              fontSize: 11.5,
              whiteSpace: 'nowrap',
              fontWeight: on ? 500 : 400,
              background: on ? 'var(--surface)' : 'transparent',
              color: on ? 'var(--brand-strong)' : 'var(--muted)',
              boxShadow: on ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** ตั้งธีมก่อนหน้าจอวาดครั้งแรก กันไม่ให้กระพริบเป็นสีผิดชั่วขณะ */
export function initTheme() {
  apply(read())
}
