/**
 * ชั้นแปลงหัวตาราง — ทำให้ระบบอ่านไฟล์ Excel ได้หลายรูปแบบโดยไม่ต้องแก้โค้ดทุกครั้ง
 *
 * ที่มาของปัญหา: ไฟล์งานจริงของบริษัทมีหัวตารางอย่างน้อยสามแบบที่หมายถึงสิ่งเดียวกัน
 *
 *   ALLMANUAL   ชื่อพขร     · ราคารับ     · ราคาจ่าย       · เส้นทาง (Route)
 *   EXPRESS     ชื่อ พขร.   · ราคาวางบิล  · ค่าเที่ยว พขร. · เส้นทาง / ดรอป / จำนวนลัง
 *   MASTER      ชื่อพขร     · ราคารับ     · ราคาจ่าย       · เบอร์โทร (ไม่ใช่ เบอร์โทรพขร.)
 *
 * ถ้าผูกโค้ดไว้กับชื่อคอลัมน์ชุดเดียว ไฟล์อีกสองแบบจะอัปโหลดไม่ได้เลย และทุกครั้ง
 * ที่ฝ่ายบัญชีเปลี่ยนหัวตารางเล็กน้อย (เว้นวรรค จุดท้ายคำ) ระบบก็จะพังตาม
 *
 * วิธีแก้: เก็บ "ชื่อที่ยอมรับได้" ของแต่ละฟิลด์ไว้เป็นรายการ แล้วจับคู่ด้วยหัวตาราง
 * ที่ normalize แล้ว ลำดับในรายการคือลำดับความสำคัญ — ใช้ตัวแรกที่เจอ
 */

// ---------------------------------------------------------------- ฟิลด์กลาง

export type Field =
  | 'segment'
  | 'date'
  | 'seq'
  | 'customer'
  | 'vehicleType'
  | 'plate'
  | 'driverName'
  | 'driverPhone'
  | 'route'
  | 'accountName'
  | 'accountNo'
  | 'bank'
  | 'note'
  | 'dispatcherName'
  | 'dispatcherPhone'
  | 'revenue'
  | 'cost'
  | 'margin'
  | 'marginPct'
  | 'withholding'

/** ขาดฟิลด์ใดฟิลด์หนึ่งในนี้ = สร้างประวัติงานของ พขร. ไม่ได้ */
export const REQUIRED_FIELDS: Field[] = ['date', 'driverName', 'driverPhone']

export const FIELD_LABEL: Record<Field, string> = {
  segment: 'ประเภทธุรกิจ',
  date: 'วันที่',
  seq: 'ลำดับงาน',
  customer: 'ลูกค้า / ประเภทงาน',
  vehicleType: 'ประเภทรถ',
  plate: 'ทะเบียน',
  driverName: 'ชื่อ พขร.',
  driverPhone: 'เบอร์โทร พขร.',
  route: 'เส้นทาง',
  accountName: 'ชื่อผู้รับโอน',
  accountNo: 'เลขบัญชี',
  bank: 'ธนาคาร',
  note: 'หมายเหตุ',
  dispatcherName: 'ชื่อหัวจ่าย',
  dispatcherPhone: 'เบอร์โทรหัวจ่าย',
  revenue: 'ราคารับ / ราคาวางบิล',
  cost: 'ราคาจ่าย / ค่าเที่ยว พขร.',
  margin: 'ส่วนต่าง',
  marginPct: 'กำไร %',
  withholding: 'ยอดหัก 1%',
}

/**
 * ตัดความต่างที่ไม่มีความหมายออกจากหัวตาราง
 *
 * "ชื่อ พขร." กับ "ชื่อพขร" ต่างกันแค่เว้นวรรคและจุดท้ายคำ ต้องถือเป็นอันเดียวกัน
 * แต่ "ค่าเที่ยว พขร." กับ "รวมจ่าย พขร." ต้องแยกกันให้ได้ จึงตัดเฉพาะช่องว่าง
 * จุดท้ายคำ และตัวพิมพ์ใหญ่-เล็ก ไม่ตัดอย่างอื่น
 */
export function normHeader(h: unknown): string {
  if (h === null || h === undefined) return ''
  return String(h)
    .normalize('NFC')
    .replace(/\s+/g, '')
    .replace(/[.:]+$/, '')
    .toLowerCase()
}

/**
 * ชื่อคอลัมน์ที่ยอมรับสำหรับแต่ละฟิลด์ (normalize แล้ว) เรียงตามลำดับความสำคัญ
 *
 * ระวังคู่ที่ชนกันง่าย:
 *   driverPhone "เบอร์โทร" ต้องไม่ไปคว้า "เบอร์โทรหัวจ่าย" — จึงเทียบแบบตรงตัวเท่านั้น
 *   cost "ค่าเที่ยวพขร" ต้องมาก่อน "รวมจ่ายพขร" เพราะยอดรวมบวกค่าน้ำมัน/ค่าแรงเข้าไปแล้ว
 *   customer "ลูกค้า" มาก่อน "ประเภทงาน" เพราะในไฟล์แบบ MASTER ลูกค้าคือ FLASH/J&T
 *     ส่วน "ประเภทงาน" เป็นรหัสงาน (DD1) ไม่ใช่ชื่อลูกค้า
 */
const ALIASES: Record<Field, string[]> = {
  segment: ['ประเภท', 'express', 'segment'],
  date: ['วันที่', 'date'],
  seq: ['ลำดับงาน', 'ลำดับ'],
  customer: ['ลูกค้า', 'ประเภทงาน', 'customer'],
  vehicleType: ['ประเภทรถ'],
  plate: ['ทะเบียน', 'ทะเบียนรถ'],
  driverName: ['ชื่อพขร', 'ชื่อคนขับ', 'ชื่อพนักงานขับรถ'],
  driverPhone: ['เบอร์โทรพขร', 'เบอร์โทรคนขับ', 'เบอร์โทร', 'เบอร์โทรศัพท์'],
  route: ['เส้นทาง(route)', 'เส้นทาง/ดรอป/จำนวนลัง', 'เส้นทาง', 'route'],
  accountName: ['ชื่อผู้รับโอน', 'ชื่อผุ้รับโอน'],
  accountNo: ['เลขบัญชี'],
  bank: ['ธนาคาร'],
  note: ['หมายเหตุ'],
  dispatcherName: ['ชื่อหัวจ่าย'],
  dispatcherPhone: ['เบอร์โทรหัวจ่าย'],
  revenue: ['ราคารับ', 'ราคาวางบิล'],
  cost: ['ราคาจ่าย', 'ค่าเที่ยวพขร', 'รวมจ่ายพขร'],
  margin: ['ส่วนต่าง'],
  marginPct: ['กำไร%'],
  withholding: ['ยอดหัก1%', '1%'],
}

const FIELDS = Object.keys(ALIASES) as Field[]

// ---------------------------------------------------------------- รูปแบบไฟล์

export type ProfileId = 'allmanual' | 'express' | 'master' | 'generic'

interface Profile {
  id: ProfileId
  markers: string[]
}

/** หัวตารางเฉพาะตัวที่ใช้บอกว่าไฟล์เป็นรูปแบบไหน — ใช้แค่แสดงผล ไม่ได้ใช้ตัดสินใจอ่าน */
const PROFILES: Profile[] = [
  {
    id: 'express',
    markers: ['express', 'ราคาวางบิล', 'ค่าเที่ยวพขร', 'เส้นทาง/ดรอป/จำนวนลัง'],
  },
  { id: 'allmanual', markers: ['ประเภท', 'ราคารับ', 'ราคาจ่าย', 'เส้นทาง(route)'] },
  {
    id: 'master',
    markers: ['ลูกค้า', 'เลขบาร์โค้ด(jobcode)', 'ชื่อเส้นทาง(jobid)', 'สถานะงาน'],
  },
]

export const PROFILE_LABEL: Record<ProfileId, string> = {
  allmanual: 'ALLMANUAL',
  express: 'EXPRESS',
  master: 'MASTER',
  generic: 'ทั่วไป',
}

// ---------------------------------------------------------------- การจับคู่

export type ColumnMap = Partial<Record<Field, number>>

export interface HeaderMatch {
  columns: ColumnMap
  profile: ProfileId
  /** ฟิลด์ที่จับคู่ได้ทั้งหมด ใช้ให้คะแนนว่าแถวไหนน่าจะเป็นหัวตาราง */
  matched: Field[]
  missingRequired: Field[]
}

/** จับคู่หัวตารางหนึ่งแถวเข้ากับฟิลด์กลาง */
export function matchHeaderRow(cells: unknown[]): HeaderMatch {
  const norm = cells.map(normHeader)
  const columns: ColumnMap = {}
  const taken = new Set<number>()

  for (const field of FIELDS) {
    for (const alias of ALIASES[field]) {
      const idx = norm.findIndex((h, i) => h === alias && !taken.has(i))
      if (idx >= 0) {
        columns[field] = idx
        taken.add(idx)
        break
      }
    }
  }

  const present = new Set(norm.filter(Boolean))
  let profile: ProfileId = 'generic'
  let best = 0
  for (const p of PROFILES) {
    const hits = p.markers.filter((m) => present.has(m)).length
    if (hits > best) {
      best = hits
      profile = p.id
    }
  }
  // ต้องเจอเครื่องหมายอย่างน้อยสองตัวถึงจะกล้าบอกว่าเป็นรูปแบบนั้น
  if (best < 2) profile = 'generic'

  const matched = FIELDS.filter((f) => columns[f] !== undefined)
  const missingRequired = REQUIRED_FIELDS.filter((f) => columns[f] === undefined)

  return { columns, profile, matched, missingRequired }
}

/**
 * หาแถวที่เป็นหัวตาราง
 *
 * ไฟล์จริงไม่ได้เริ่มที่แถวแรกเสมอ — ชีต Pivot มีแถวว่างคั่นก่อน และบางไฟล์
 * มีบรรทัดชื่อรายงานอยู่ข้างบน จึงต้องไล่หาแถวที่จับคู่ฟิลด์ได้มากที่สุด
 * ภายในไม่กี่แถวแรก แทนที่จะเดาว่าเป็นแถว 0 เสมอ
 */
export function findHeaderRow(
  aoa: unknown[][],
  lookahead = 8,
): { row: number; match: HeaderMatch } | null {
  let bestRow = -1
  let bestMatch: HeaderMatch | null = null

  for (let i = 0; i < Math.min(lookahead, aoa.length); i++) {
    const m = matchHeaderRow(aoa[i] ?? [])
    if (m.missingRequired.length > 0) continue
    if (!bestMatch || m.matched.length > bestMatch.matched.length) {
      bestRow = i
      bestMatch = m
    }
  }

  return bestMatch ? { row: bestRow, match: bestMatch } : null
}

// ---------------------------------------------------------------- สแกนไฟล์

export type SheetStatus =
  /** อ่านได้และมีแถวที่นำเข้าได้จริง */
  | 'ok'
  /** รู้จักหัวตาราง แต่ไม่มีแถวไหนที่ข้อมูลครบพอจะนำเข้า */
  | 'empty'
  /** ไม่พบหัวตารางที่ใช้ได้ เช่นชีต Pivot หรือชีตสรุป */
  | 'unreadable'

export interface SheetScan {
  name: string
  status: SheetStatus
  profile: ProfileId
  headerRow: number
  columns: ColumnMap
  matched: Field[]
  missingRequired: Field[]
  /** แถวข้อมูลดิบ ไม่รวมหัวตาราง พร้อมเลขแถวจริงใน Excel */
  rows: { rowNo: number; cells: unknown[] }[]
  /** จำนวนแถวที่มีทั้งวันที่ ชื่อ และเบอร์โทร */
  usableRows: number
  totalRows: number
  reason?: string
}

/** ค่าที่ถือว่า "มีข้อมูล" — ใช้ตัดแถวว่างของเทมเพลตที่ใส่แต่วันที่ไว้ล่วงหน้า */
function hasContent(cells: unknown[]): boolean {
  return cells.some((c) => c !== null && c !== undefined && String(c).trim() !== '')
}

/**
 * สแกนทุกชีตในไฟล์เดียว บอกว่าชีตไหนนำเข้าได้ ชีตไหนไม่ได้ และเพราะอะไร
 *
 * รับ readAoa เข้ามาแทนที่จะเรียก SheetJS ตรง ๆ เพื่อให้เขียนเทสต์ได้โดยไม่ต้องมีไฟล์จริง
 */
export function scanSheets(
  sheetNames: string[],
  readAoa: (name: string) => unknown[][],
  isUsable: (cells: unknown[], columns: ColumnMap) => boolean,
): SheetScan[] {
  return sheetNames.map((name) => {
    const aoa = readAoa(name)
    const found = findHeaderRow(aoa)

    if (!found) {
      // บอกให้ชัดว่าขาดอะไร โดยดูจากแถวที่จับคู่ได้ดีที่สุด
      let bestSoFar: HeaderMatch | null = null
      for (let i = 0; i < Math.min(8, aoa.length); i++) {
        const m = matchHeaderRow(aoa[i] ?? [])
        if (!bestSoFar || m.matched.length > bestSoFar.matched.length) bestSoFar = m
      }
      const missing = bestSoFar?.missingRequired ?? REQUIRED_FIELDS
      return {
        name,
        status: 'unreadable' as const,
        profile: 'generic' as const,
        headerRow: -1,
        columns: {},
        matched: bestSoFar?.matched ?? [],
        missingRequired: missing,
        rows: [],
        usableRows: 0,
        totalRows: Math.max(0, aoa.length - 1),
        reason: `ไม่พบคอลัมน์ ${missing.map((f) => FIELD_LABEL[f]).join(' · ')}`,
      }
    }

    const { row: headerRow, match } = found
    const rows: { rowNo: number; cells: unknown[] }[] = []
    for (let i = headerRow + 1; i < aoa.length; i++) {
      const cells = aoa[i] ?? []
      if (!hasContent(cells)) continue
      rows.push({ rowNo: i + 1, cells }) // Excel นับแถวจาก 1
    }

    const usableRows = rows.filter((r) => isUsable(r.cells, match.columns)).length

    return {
      name,
      status: (usableRows > 0 ? 'ok' : 'empty') as SheetStatus,
      profile: match.profile,
      headerRow,
      columns: match.columns,
      matched: match.matched,
      missingRequired: match.missingRequired,
      rows,
      usableRows,
      totalRows: rows.length,
      reason:
        usableRows > 0
          ? undefined
          : 'หัวตารางถูกต้อง แต่ไม่มีแถวไหนที่มีครบทั้งวันที่ ชื่อ และเบอร์โทร พขร.',
    }
  })
}
