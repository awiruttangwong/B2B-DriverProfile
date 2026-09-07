import { createClient } from '@supabase/supabase-js'
import { demoClient } from './demoClient'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** โหมดทดลอง: อ่านข้อมูลจริงจากไฟล์ในเครื่อง ไม่ต้องมีฐานข้อมูล */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1'

if (!IS_DEMO && (!url || !anonKey)) {
  throw new Error(
    'ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY — ' +
      'คัดลอก .env.example เป็น .env.local แล้วใส่ค่าจาก Supabase Dashboard ' +
      'หรือรันโหมดทดลองด้วย npm run dev:demo',
  )
}

// ต้องเอาชนิดข้อมูลจากการเรียกใช้จริง ไม่ใช่ ReturnType<typeof createClient>
// เพราะ generic ของ createClient จะ resolve เป็น never ทำให้ชื่อตารางทุกตัวพัง
function createRealClient() {
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  })
}

export const supabase = IS_DEMO
  ? (demoClient as unknown as ReturnType<typeof createRealClient>)
  : createRealClient()
