export type Theme = 'system' | 'light' | 'dark'

const KEY = 'pb2b-theme'

/** อ่านค่าที่เลือกไว้ ถ้าอ่านไม่ได้ (โหมดส่วนตัว/ปิดคุกกี้) ให้ถือว่าตามระบบ */
export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, t)
  } catch {
    /* เก็บค่าไม่ได้ก็ยังใช้งานได้ปกติ แค่ไม่จำข้ามการรีเฟรช */
  }
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** ใส่ data-theme ลง <html> ตรง ๆ — ไม่ยุ่งกับค่าที่บันทึกไว้ */
export function applyTheme(t: Theme) {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

/** ตั้งธีมก่อนหน้าจอวาดครั้งแรก กันไม่ให้กระพริบเป็นสีผิดชั่วขณะ */
export function initTheme() {
  applyTheme(readTheme())
}
