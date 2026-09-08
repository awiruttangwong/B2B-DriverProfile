/** ฟังก์ชันจัดรูปแบบสำหรับแสดงผล */

/**
 * วันที่แบบ YYYY-MM-DD ตามเวลาท้องถิ่น (ไม่ใช่ UTC)
 *
 * new Date().toISOString().slice(0,10) ผิดในเขตเวลาไทย (UTC+7) ช่วงเที่ยงคืนถึงตี 7
 * เพราะ toISOString() แปลงเป็น UTC ก่อนเสมอ ทำให้ได้วันที่ของ "เมื่อวาน" แทนที่จะเป็น
 * "วันนี้" — ใช้ตัวนี้แทนทุกจุดที่ต้องการวันที่ปัจจุบันของผู้ใช้เป็นสตริง
 */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * ทำความสะอาดคำค้นก่อนเอาไปต่อเป็นเงื่อนไข .or() ของ PostgREST
 *
 * PostgREST รับเงื่อนไข or() มาเป็นสตริงเดียวแล้วแยกเองด้วย , และ ( ) การเอา
 * คำที่ผู้ใช้พิมพ์ไปต่อสตริงตรง ๆ จึงพังสองแบบ (ทดสอบกับ production จริงแล้ว):
 *   - พิมพ์จุลภาค เช่น "ก,ข"  -> เซิร์ฟเวอร์ตอบ 400 หน้าเว็บขึ้น "โหลดข้อมูลไม่สำเร็จ"
 *   - พิมพ์วงเล็บ เช่น "ก)"   -> กลุ่มเงื่อนไขเพี้ยน คืนคนที่ไม่ตรงคำค้นแบบเงียบ ๆ
 * ส่วน % _ * เป็นไวลด์การ์ดของ ilike ถ้าปล่อยไว้ผู้ใช้จะได้ผลลัพธ์ที่อธิบายไม่ได้
 */
export function safeSearchTerm(raw: string): string {
  return raw
    .replace(/[,()\\%_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('th-TH', { maximumFractionDigits: 0 })
}

/**
 * ค่าจ้างสะสมของ พขร.
 *
 * ในข้อมูลจริงมี พขร. ที่วิ่งเป็นร้อยเที่ยวแต่ไม่มีการบันทึกค่าจ้างเลยสักเที่ยว
 * (ช่องว่าง 664 แถว และเป็นเลข 0 อีก 292 แถว) การแสดง "0" จะอ่านได้ว่า
 * "จ่ายศูนย์บาท" ซึ่งไม่จริง ต้องแยกให้ชัดว่าไม่มีข้อมูล ไม่ใช่ไม่ได้จ่าย
 */
export function fmtCostTotal(
  total: number | null | undefined,
  jobs: number | null | undefined,
): string {
  if (total === null || total === undefined) return '—'
  if (total === 0 && (jobs ?? 0) > 0) return 'ไม่ได้บันทึก'
  return fmtMoney(total)
}

export function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v.toLocaleString('th-TH')
}

export function fmtScore(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v.toFixed(2)
}

export function fmtPhone(p: string | null | undefined): string {
  if (!p) return '—'
  if (p.length === 10) return `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`
  return p
}

/** 'เมื่อ 3 วันที่แล้ว' — ใช้บอกว่าข้อมูลของคนนี้สดแค่ไหน */
export function fmtSince(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'ยังไม่เคยมีงาน'
  if (days <= 0) return 'วันนี้'
  if (days === 1) return 'เมื่อวาน'
  if (days < 30) return `${days} วันที่แล้ว`
  if (days < 365) return `${Math.floor(days / 30)} เดือนที่แล้ว`
  return `${Math.floor(days / 365)} ปีที่แล้ว`
}

export const STATUS_LABEL: Record<string, string> = {
  active: 'ใช้งาน',
  probation: 'ทดลองงาน',
  inactive: 'พักงาน',
  blacklisted: 'ห้ามใช้งาน',
}

export const OUTCOME_LABEL: Record<string, string> = {
  completed: 'สำเร็จ',
  no_show: 'ไม่มารับงาน',
  cancelled: 'ยกเลิก',
  incident: 'มีเหตุ',
}

export const ACTION_LABEL: Record<string, string> = {
  driver_status: 'เปลี่ยนสถานะ พขร.',
  rating_create: 'ให้คะแนน พขร.',
  rating_void: 'ยกเลิกใบให้คะแนน',
  job_import: 'บันทึก/อัปโหลดงาน',
  user_join: 'ผู้ใช้งานใหม่',
}

export const ACTION_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'brand'> = {
  driver_status: 'warn',
  rating_create: 'ok',
  rating_void: 'bad',
  job_import: 'brand',
  user_join: 'brand',
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'ผู้ใช้งาน',
  hr: 'ฝ่ายบุคคล',
  ops: 'ฝ่ายปฏิบัติการ',
  viewer: 'อ่านอย่างเดียว',
}
