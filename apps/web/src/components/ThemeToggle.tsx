import { useEffect, useState } from 'react'
import { IconMoon, IconSun } from './icons'

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

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
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

  // ตัวเลือกเหลือแค่สว่าง/มืด แต่ยังไม่บังคับผู้ใช้ที่ไม่เคยกดเลือก — ครั้งแรกยึดตาม
  // ธีมของระบบปฏิบัติการไปก่อน (ผ่าน 'system' เดิม) แค่ไม่มีปุ่มแยกให้กดเลือกอีก
  const resolved: 'light' | 'dark' = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme

  const opts: { v: 'light' | 'dark'; label: string; icon: typeof IconSun }[] = [
    { v: 'light', label: 'สว่าง', icon: IconSun },
    { v: 'dark', label: 'มืด', icon: IconMoon },
  ]

  return (
    <div role="radiogroup" aria-label="ธีมสี" className="theme-toggle">
      {opts.map((o) => {
        const on = resolved === o.v
        const Icon = o.icon
        return (
          <button
            key={o.v}
            role="radio"
            aria-checked={on}
            className={on ? 'on' : ''}
            onClick={() => setTheme(o.v)}
          >
            <Icon size={13} />
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
