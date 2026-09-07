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

export const ROLE_LABEL: Record<string, string> = {
  admin: 'ผู้ใช้งาน',
  hr: 'ฝ่ายบุคคล',
  ops: 'ฝ่ายปฏิบัติการ',
  viewer: 'อ่านอย่างเดียว',
}
