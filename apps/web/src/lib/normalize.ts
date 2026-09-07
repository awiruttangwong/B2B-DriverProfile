/**
 * กฎการทำความสะอาดข้อมูล — ต้องตรงกับ scripts/etl_excel.py ทุกข้อ
 *
 * เหตุผลที่ต้องตรงกัน: การโหลดชุดแรกทำด้วย Python ส่วนการอัปโหลดรายเดือน
 * ทำผ่านหน้าเว็บ ถ้ากฎต่างกันแม้แต่นิดเดียว จะเกิด พขร. ซ้ำหรือเที่ยวซ้ำทันที
 * ทั้งสองฝั่งจึงใช้ uuid5 จาก namespace เดียวกันและ hash สูตรเดียวกัน
 */

/** ห้ามเปลี่ยนค่านี้ — ถ้าเปลี่ยน id ทุกแถวในระบบจะเปลี่ยนตาม */
const NS = '6f1c2a54-7b3e-5d18-9f42-0c8a1b6e3d70'

/** ชื่อบนเบอร์เดียวกันที่คล้ายกันเกินเกณฑ์นี้ ถือว่าเป็นคนเดียวกันสะกดต่างกัน */
export const NAME_MERGE_RATIO = 0.72

// ---------------------------------------------------------------- ข้อความ

export function normText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s || null
}

/** เหลือแต่ตัวเลข เติม 0 นำหน้าให้เบอร์ 9 หลักที่ Excel กินศูนย์ไป */
export function normPhone(v: unknown): string | null {
  if (v === null || v === undefined) return null
  let s = String(v).trim()
  if (s.endsWith('.0')) s = s.slice(0, -2)
  let d = s.replace(/\D/g, '')
  if (d.length === 9 && !d.startsWith('0')) d = '0' + d
  return d.length >= 9 && d.length <= 10 ? d : null
}

/** รหัสลูกค้า — ตัวพิมพ์ใหญ่ทั้งหมด รวม GO Hair / GO hair / Go hair เป็นตัวเดียว */
export function normCode(v: unknown): string | null {
  const s = normText(v)
  return s ? s.toUpperCase() : null
}

export function normPlate(v: unknown): string | null {
  const s = normText(v)
  if (!s) return null
  return s.replace(/^[\s\-/]+|[\s\-/]+$/g, '') || null
}

/** 'KBANK - กสิกรไทย' -> 'KBANK' ; 'Prompt Pay' -> 'PROMPTPAY' */
export function normBank(v: unknown): string | null {
  const s = normText(v)
  if (!s) return null
  const code = (s.split('-')[0] ?? '').trim().toUpperCase().replace(/\s/g, '')
  return code || null
}

export function normMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/**
 * วันที่จาก Excel มาได้ทั้งเลข serial, Date และข้อความ
 *
 * ระวังเรื่องเขตเวลา — เคยเป็นบั๊กจริงมาแล้ว: SheetJS คืนวันที่เป็นสตริง
 * "2025-01-10 00:00:00" ซึ่ง new Date() ตีความเป็น "เวลาท้องถิ่น" พอเอา
 * component แบบ UTC กลับออกมาในเขตเวลา UTC+7 จะได้ 2025-01-09 คือเลื่อนไป 1 วัน
 * ทำให้ row_hash ไม่ตรงกับฝั่ง Python ทุกแถว และการอัปโหลดซ้ำสร้างข้อมูลซ้ำทั้งไฟล์
 *
 * ทางแก้: หลีกเลี่ยงการแปลงผ่านเขตเวลาให้หมด
 *   - สตริงที่ขึ้นต้นด้วย YYYY-MM-DD  -> ตัดเอา 10 ตัวแรกตรง ๆ
 *   - เลข serial ของ Excel            -> คำนวณด้วยเลขล้วน อ่านกลับเป็น UTC
 *   - Date                            -> ปัดเป็นวันที่ใกล้ที่สุดตามเวลาท้องถิ่น
 *     (SheetJS สร้าง Date ที่คลาดไปไม่กี่วินาที ถ้าไม่ปัดจะร่วงไปวันก่อนหน้า)
 */
export function normDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    // serial ของ Excel: 25569 คือ 1970-01-01 คิดเป็นมิลลิวินาทีแบบ UTC ล้วน
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return Number.isNaN(d.getTime()) ? null : toISODate(d)
  }

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    return roundToLocalDay(v)
  }

  const s = String(v).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : roundToLocalDay(d)
}

/** อ่าน component แบบ UTC — ใช้กับ Date ที่สร้างจากเลขล้วนเท่านั้น */
function toISODate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** เลื่อนให้ component แบบ UTC เท่ากับเวลาท้องถิ่น แล้วปัดเป็นวันที่ใกล้ที่สุด */
function roundToLocalDay(d: Date): string {
  const shifted = d.getTime() - d.getTimezoneOffset() * 60_000
  return toISODate(new Date(Math.round(shifted / 86_400_000) * 86_400_000))
}

/**
 * 'คลังสุวินทวงศ์ - นครปฐม (6 จุด)' -> ต้นทาง / ปลายทาง
 * แยกที่ ' - ' ตัวแรกเท่านั้น ถ้าไม่มีก็คืน null ทั้งคู่ แต่ route_raw ยังเก็บไว้เสมอ
 */
export function splitRoute(route: string | null): {
  origin: string | null
  destination: string | null
} {
  if (!route) return { origin: null, destination: null }
  const m = route.match(/^(.*?)\s+-\s+(.*)$/s)
  if (!m) return { origin: null, destination: null }
  const origin = normText(m[1])
  const destination = normText(m[2])
  return origin && destination ? { origin, destination } : { origin: null, destination: null }
}

// ---------------------------------------------------------------- ตัวตน

/**
 * ความคล้ายของข้อความแบบ Ratcliff/Obershelp
 * ให้ผลตรงกับ difflib.SequenceMatcher(...).ratio() ของ Python ที่ ETL ใช้
 */
export function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1
  const total = a.length + b.length
  if (total === 0) return 0
  return (2 * matchingChars(a, b)) / total
}

function matchingChars(a: string, b: string): number {
  if (!a.length || !b.length) return 0
  // หาบล็อกที่ตรงกันยาวที่สุด แล้วทำซ้ำกับส่วนซ้ายและขวาของบล็อกนั้น
  let bestA = 0
  let bestB = 0
  let bestLen = 0
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    const curr = new Array<number>(b.length + 1).fill(0)
    for (let j = 0; j < b.length; j++) {
      if (a[i] === b[j]) {
        const len = (prev[j] ?? 0) + 1
        curr[j + 1] = len
        if (len > bestLen) {
          bestLen = len
          bestA = i - len + 1
          bestB = j - len + 1
        }
      }
    }
    prev = curr
  }
  if (bestLen === 0) return 0
  return (
    bestLen +
    matchingChars(a.slice(0, bestA), b.slice(0, bestB)) +
    matchingChars(a.slice(bestA + bestLen), b.slice(bestB + bestLen))
  )
}

/** ตัดวงเล็บออกก่อนเทียบ เช่น 'วชิราวุฒิ สุโยธา(ท4)' เทียบกับ 'วชิราวุฒิ สุโยธา' */
export function bareName(name: string): string {
  return name.replace(/\(.*?\)/g, '').trim()
}

export function isSamePerson(nameA: string, nameB: string): boolean {
  return similarity(bareName(nameA), bareName(nameB)) >= NAME_MERGE_RATIO
}

// ---------------------------------------------------------------- id / hash

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToUuid(b: Uint8Array): string {
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * UUID v5 (SHA-1) — ให้ค่าตรงกับ uuid.uuid5(NS, name) ของ Python
 * ทำให้อัปโหลดไฟล์เดิมซ้ำได้ id เดิม ไม่เกิดข้อมูลซ้ำ
 */
export async function detUuid(kind: string, key: string): Promise<string> {
  const ns = hexToBytes(NS)
  const name = new TextEncoder().encode(`${kind}:${key}`)
  const buf = new Uint8Array(ns.length + name.length)
  buf.set(ns, 0)
  buf.set(name, ns.length)

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buf))
  const out = digest.slice(0, 16)
  out[6] = ((out[6] ?? 0) & 0x0f) | 0x50 // version 5
  out[8] = ((out[8] ?? 0) & 0x3f) | 0x80 // variant RFC 4122
  return bytesToUuid(out)
}

/**
 * ลายนิ้วมือของหนึ่งเที่ยว — ใช้กันการนำเข้าซ้ำ ต้องตรงกับสูตรใน etl_excel.py
 *
 * occurrence คือลำดับที่ของเที่ยวที่มีคีย์ธรรมชาติซ้ำกันทุกช่อง
 *
 * ทำไมต้องมี: พขร. คนเดียวกันวิ่งเส้นทางเดิม ราคาเดิม หลายเที่ยวในวันเดียวได้จริง
 * เช่น นพพล เสนาบูรณ์ วิ่ง JTC - ท่าเรือ KERRY แหลมฉบัง สามเที่ยวในวันที่ 20 ก.ค.
 * (ลำดับงาน 13, 14, 15) ถ้า hash คิดจากเจ็ดช่องนี้อย่างเดียว สองเที่ยวหลังจะถูก
 * มองว่าซ้ำแล้วถูกทิ้ง ทำให้จำนวนเที่ยวของ พขร. ต่ำกว่าความจริง
 *
 * occurrence = 1 ให้ค่าเท่าสูตรเดิมทุกประการ ข้อมูลที่นำเข้าไปแล้วจึงยังตรงเหมือนเดิม
 * ส่วนเที่ยวที่ 2 ขึ้นไปได้ hash ใหม่ที่ไม่มีทางชนกับเที่ยวแรกของแถวอื่น
 */
export async function rowHash(
  parts: {
    date: string | null
    customer: string | null
    plate: string | null
    phone: string | null
    route: string | null
    revenue: number | null
    cost: number | null
  },
  occurrence = 1,
): Promise<string> {
  let raw = [
    parts.date ?? '',
    parts.customer ?? '',
    parts.plate ?? '',
    parts.phone ?? '',
    parts.route ?? '',
    parts.revenue === null ? '' : String(parts.revenue),
    parts.cost === null ? '' : String(parts.cost),
  ].join('|')
  if (occurrence > 1) raw += `|#${occurrence}`

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
