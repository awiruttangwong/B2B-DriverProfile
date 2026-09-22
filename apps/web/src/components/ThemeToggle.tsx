import { useEffect, useState } from 'react'
import { IconMoon, IconSun } from './icons'
import {
  applyTheme,
  applyThemeAnimated,
  readTheme,
  saveTheme,
  systemPrefersDark,
  type Theme,
} from '../lib/theme'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
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
            onClick={() => {
              // เปลี่ยน data-theme เองตรงนี้เพื่อให้ครอบด้วยการจางเปลี่ยนได้
              // effect ด้านบนจะเรียก applyTheme ซ้ำด้วยค่าเดิม ซึ่งไม่เปลี่ยนอะไรอีก
              applyThemeAnimated(o.v)
              setTheme(o.v)
            }}
          >
            <Icon size={13} />
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
