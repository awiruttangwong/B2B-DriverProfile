/**
 * ทำความสะอาดข้อมูลเที่ยววิ่ง — ตรรกะล้วน ไม่แตะฐานข้อมูล
 *
 * แยกออกมาจาก ingest.ts เพื่อให้ scripts/verify_parity.mjs เรียกโค้ดตัวจริงมาเทียบกับ
 * ผลของ scripts/etl_excel.py ได้โดยไม่ต้องมี Supabase client ถ้าปล่อยให้สคริปต์ตรวจ
 * ถือ "สำเนาตรรกะ" ไว้เอง สองฝั่งจะค่อย ๆ เพี้ยนกันโดยไม่มีใครรู้ ซึ่งเคยเกิดมาแล้ว
 */

import {
  normBank,
  normCode,
  normDate,
  normMoney,
  normPhone,
  normPlate,
  normText,
  rowHash,
  splitRoute,
} from './normalize'
import type { ColumnMap, Field } from './sourceProfiles'

export type RawRow = Partial<Record<Field, unknown>>

/** ชีตหนึ่งชีตที่แปลงหัวตารางแล้ว พร้อมส่งเข้ากระบวนการทำความสะอาด */
export interface SourceSheet {
  name: string
  columns: ColumnMap
  rows: { rowNo: number; cells: unknown[] }[]
}

export interface CleanRow {
  sheet: string
  rowNo: number
  date: string
  seq: string | null
  /** ลำดับที่ของเที่ยวที่คีย์ธรรมชาติซ้ำกันทุกช่อง — ปกติเป็น 1 */
  occurrence: number
  segment: string
  customer: string | null
  vehicleType: string | null
  plate: string | null
  driverName: string
  driverPhone: string
  route: string | null
  origin: string | null
  destination: string | null
  accountName: string | null
  accountNo: string | null
  bank: string | null
  note: string | null
  dispatcherName: string | null
  dispatcherPhone: string | null
  revenue: number | null
  cost: number | null
  margin: number | null
  marginPct: number | null
  withholding: number | null
  hash: string
}

export interface InvalidRow {
  sheet: string
  rowNo: number
  reason: string
}

export interface CleanResult {
  rows: CleanRow[]
  invalid: InvalidRow[]
  /** แถวที่เป็นเที่ยวเดียวกันแต่ถูกบันทึกซ้ำ (ในชีตเดียวกันหรือข้ามชีต) — นับเป็นเที่ยวเดียว */
  collapsedAcrossSheets: number
  /** ส่วนที่ยุบเพราะอยู่ในชีตเดียวกันและลำดับงานตรงกัน */
  collapsedSameSheet: number
  /** เที่ยวที่ 2 ขึ้นไปของคีย์เดียวกัน ที่แยกออกมาได้เพราะลำดับงานต่างกัน */
  repeatTrips: number
  /**
   * แถวที่ใช้ลำดับงานเดียวกันในวันเดียวกันของ พขร. คนเดียวกัน แต่ราคาต่างกัน
   *
   * ส่วนใหญ่คือค่าใช้จ่ายเพิ่มของงานเดียวกันที่ถูกแยกเป็นอีกบรรทัด เช่น
   * "ค่าเสียเวลา 08.15 - 15.07" หรือ "ค่าค้างคืน 14/5 (1วัน)" ไม่ใช่อีกเที่ยว
   * ระบบยังนับเป็นคนละเที่ยวอยู่ เพราะไม่มีทางแยกออกจาก "ราคาถูกแก้" ได้แน่นอน
   * จึงรายงานไว้ให้ตรวจแทนที่จะเดาแทนผู้ใช้ — ในไฟล์จริงมี 45 กลุ่ม คิดเป็น 0.6%
   */
  surchargeLines: { date: string; driverName: string; seq: string; rows: number }[]
}

// ------------------------------------------------------- อ่านค่าตาม ColumnMap

function cell(cells: unknown[], columns: ColumnMap, field: Field): unknown {
  const idx = columns[field]
  if (idx === undefined) return null
  const v = cells[idx]
  return v === undefined ? null : v
}

/**
 * แถวนี้มีข้อมูลครบพอจะสร้างประวัติงานหรือไม่
 *
 * หน้าอัปโหลดใช้ตัวเดียวกันนี้ตอนสแกนไฟล์ เพื่อบอกล่วงหน้าว่าชีตไหนมีของจริง
 * ตัวเลขที่แสดงก่อนนำเข้าจึงตรงกับที่นำเข้าได้จริงเสมอ
 */
export function isUsableRow(cells: unknown[], columns: ColumnMap): boolean {
  return (
    normDate(cell(cells, columns, 'date')) !== null &&
    normText(cell(cells, columns, 'driverName')) !== null &&
    normPhone(cell(cells, columns, 'driverPhone')) !== null
  )
}

/** ค่าที่ normalize แล้วของหนึ่งแถว ก่อนตัดสินเรื่องเที่ยวซ้ำ */
interface Draft {
  sheet: string
  rowNo: number
  date: string
  seq: string | null
  segment: string
  customer: string | null
  vehicleType: string | null
  plate: string | null
  driverName: string
  driverPhone: string
  route: string | null
  accountName: string | null
  accountNo: string | null
  bank: string | null
  note: string | null
  dispatcherName: string | null
  dispatcherPhone: string | null
  revenue: number | null
  cost: number | null
  margin: number | null
  marginPct: number | null
  withholding: number | null
  /** คีย์ธรรมชาติ 7 ช่อง — ตรงกับข้อความที่เอาไปเข้า sha256 */
  key: string
}

function naturalKey(d: Draft): string {
  return [
    d.date,
    d.customer ?? '',
    d.plate ?? '',
    d.driverPhone,
    d.route ?? '',
    d.revenue === null ? '' : String(d.revenue),
    d.cost === null ? '' : String(d.cost),
  ].join('|')
}

function toDraft(
  sheet: string,
  rowNo: number,
  cells: unknown[],
  columns: ColumnMap,
): Draft | InvalidRow {
  const date = normDate(cell(cells, columns, 'date'))
  const driverName = normText(cell(cells, columns, 'driverName'))
  const driverPhone = normPhone(cell(cells, columns, 'driverPhone'))

  if (!date) return { sheet, rowNo, reason: 'วันที่ว่างหรืออ่านไม่ออก' }
  if (!driverName) return { sheet, rowNo, reason: 'ไม่มีชื่อ พขร.' }
  if (!driverPhone) return { sheet, rowNo, reason: 'เบอร์โทร พขร. ไม่ครบ 9–10 หลัก' }

  const rawAcct = cell(cells, columns, 'accountNo')

  const d: Draft = {
    sheet,
    rowNo,
    date,
    // ลำดับงานอาจมาเป็น 13 หรือ 13.0 แล้วแต่ว่า Excel เก็บเป็นเลขหรือข้อความ
    seq: normText(cell(cells, columns, 'seq'))?.replace(/\.0$/, '') ?? null,
    segment: normText(cell(cells, columns, 'segment')) ?? 'B2B',
    customer: normCode(cell(cells, columns, 'customer')),
    vehicleType: normText(cell(cells, columns, 'vehicleType')),
    plate: normPlate(cell(cells, columns, 'plate')),
    driverName,
    driverPhone,
    route: normText(cell(cells, columns, 'route')),
    accountName: normText(cell(cells, columns, 'accountName')),
    accountNo: normText(
      rawAcct === null || rawAcct === undefined ? null : String(rawAcct).split('.')[0],
    ),
    bank: normBank(cell(cells, columns, 'bank')),
    note: normText(cell(cells, columns, 'note')),
    dispatcherName: normText(cell(cells, columns, 'dispatcherName')),
    dispatcherPhone: normPhone(cell(cells, columns, 'dispatcherPhone')),
    revenue: normMoney(cell(cells, columns, 'revenue')),
    cost: normMoney(cell(cells, columns, 'cost')),
    margin: normMoney(cell(cells, columns, 'margin')),
    marginPct: normMoney(cell(cells, columns, 'marginPct')),
    withholding: normMoney(cell(cells, columns, 'withholding')),
    key: '',
  }
  d.key = naturalKey(d)
  return d
}

function isInvalid(x: Draft | InvalidRow): x is InvalidRow {
  return 'reason' in x
}

/**
 * ทำความสะอาดหลายชีตพร้อมกัน แล้วตัดสินว่าแถวไหนคือเที่ยวเดียวกัน
 *
 * โจทย์ที่ยากอยู่ตรงนี้ — แถวที่มีคีย์ธรรมชาติเหมือนกันเป๊ะ มีได้สองความหมาย
 *
 *   ก) เที่ยวเดียวกันที่ถูกคัดลอกไปอยู่หลายชีต
 *      ไฟล์ IMPORT SUM ของจริงมีชีต "IMPORT SUM B2C DATA EXPRESS" ที่เป็นการเอา
 *      ชีต ALLMANUAL มาต่อกับ Import-Month-Now2025 ทำให้งานเดือนล่าสุด 454 แถว
 *      ปรากฏสองรอบในชีตเดียว ถ้านับตรง ๆ จะได้เที่ยวเกินมา 454 เที่ยว
 *
 *   ข) เที่ยวคนละเที่ยวจริง ๆ ที่บังเอิญเหมือนกันทุกช่อง
 *      นพพล เสนาบูรณ์ วิ่ง JTC - ท่าเรือ KERRY แหลมฉบัง สามเที่ยวในวันที่ 20 ก.ค.
 *      ราคาเท่ากันทั้งสามเที่ยว ต่างกันแค่ลำดับงาน 13 / 14 / 15
 *
 * ตัวแยกคือคอลัมน์ "ลำดับงาน" — แถวที่ลำดับงานเท่ากันคือแถวเดียวกันที่ถูกคัดลอก
 * ส่วนแถวที่ลำดับงานต่างกันคือคนละเที่ยว จึงนับดังนี้
 *
 *   1. ในแต่ละชีต ยุบแถวที่คีย์ตรงกันและลำดับงานตรงกันให้เหลืออันเดียว
 *   2. จำนวนเที่ยวจริงของคีย์หนึ่ง = ค่ามากที่สุดที่นับได้จากชีตใดชีตหนึ่ง
 *      (ชีตที่บันทึกครบที่สุดเป็นตัวตั้ง ชีตที่บันทึกไม่ครบไม่ทำให้ของหาย)
 *   3. เที่ยวที่ 1 ใช้ hash สูตรเดิม เที่ยวที่ 2 ขึ้นไปต่อท้ายด้วย |#n
 *
 * ผลกับไฟล์จริง: จาก 8,010 แถวที่ใช้ได้ เหลือ 7,556 เที่ยว โดยที่ทุกชีตให้
 * จำนวนเที่ยวตรงกันหมด (ไม่มีคีย์ไหนที่ชีตนับไม่ตรงกันเลย)
 */
export async function cleanSheets(sheets: SourceSheet[]): Promise<CleanResult> {
  const invalid: InvalidRow[] = []
  const drafts: Draft[] = []

  for (const s of sheets) {
    for (const r of s.rows) {
      const d = toDraft(s.name, r.rowNo, r.cells, s.columns)
      if (isInvalid(d)) invalid.push(d)
      else drafts.push(d)
    }
  }

  // ---- ขั้นที่ 1: ยุบแถวที่ซ้ำกันภายในชีตเดียวกัน (คีย์ + ลำดับงานตรงกัน)
  type Bucket = { list: Draft[]; seenSeq: Set<string> }
  const perSheet = new Map<string, Map<string, Bucket>>() // sheet -> key -> bucket
  let sameSeqCollapsed = 0

  for (const d of drafts) {
    let byKey = perSheet.get(d.sheet)
    if (!byKey) {
      byKey = new Map()
      perSheet.set(d.sheet, byKey)
    }
    let b = byKey.get(d.key)
    if (!b) {
      b = { list: [], seenSeq: new Set() }
      byKey.set(d.key, b)
    }
    if (d.seq !== null) {
      if (b.seenSeq.has(d.seq)) {
        sameSeqCollapsed++
        continue
      }
      b.seenSeq.add(d.seq)
    }
    b.list.push(d)
  }

  // ---- ขั้นที่ 2: ชีตที่นับเที่ยวได้มากที่สุดเป็นตัวตั้ง
  const winner = new Map<string, Draft[]>()
  for (const byKey of perSheet.values()) {
    for (const [key, b] of byKey) {
      const cur = winner.get(key)
      if (!cur || b.list.length > cur.length) winner.set(key, b.list)
    }
  }

  // แถวที่หายไปทั้งหมด = ที่ยุบในชีตเดียวกัน + ที่ปรากฏซ้ำข้ามชีต
  const keptTotal = [...winner.values()].reduce((a, l) => a + l.length, 0)
  const collapsedAcrossSheets = drafts.length - keptTotal

  // ---- ขั้นที่ 3: ให้เลขลำดับที่และคำนวณ hash
  const rows: CleanRow[] = []
  let repeatTrips = 0

  for (const list of winner.values()) {
    // เรียงตามลำดับงานให้ผลคงที่ ไม่ขึ้นกับว่าอ่านชีตไหนก่อน
    const ordered = [...list].sort((a, b) => {
      const an = a.seq === null ? Number.POSITIVE_INFINITY : Number(a.seq)
      const bn = b.seq === null ? Number.POSITIVE_INFINITY : Number(b.seq)
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn
      return a.rowNo - b.rowNo
    })

    for (let i = 0; i < ordered.length; i++) {
      const d = ordered[i]!
      const occurrence = i + 1
      if (occurrence > 1) repeatTrips++
      const { origin, destination } = splitRoute(d.route)
      rows.push({
        sheet: d.sheet,
        rowNo: d.rowNo,
        date: d.date,
        seq: d.seq,
        occurrence,
        segment: d.segment,
        customer: d.customer,
        vehicleType: d.vehicleType,
        plate: d.plate,
        driverName: d.driverName,
        driverPhone: d.driverPhone,
        route: d.route,
        origin,
        destination,
        accountName: d.accountName,
        accountNo: d.accountNo,
        bank: d.bank,
        note: d.note,
        dispatcherName: d.dispatcherName,
        dispatcherPhone: d.dispatcherPhone,
        revenue: d.revenue,
        cost: d.cost,
        margin: d.margin,
        marginPct: d.marginPct,
        withholding: d.withholding,
        hash: await rowHash(
          {
            date: d.date,
            customer: d.customer,
            plate: d.plate,
            phone: d.driverPhone,
            route: d.route,
            revenue: d.revenue,
            cost: d.cost,
          },
          occurrence,
        ),
      })
    }
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rowNo - b.rowNo))

  // หาแถวที่ใช้ลำดับงานเดียวกันแต่ราคาต่างกัน — นับจากผลสุดท้าย ไม่ใช่จากแถวดิบ
  // จะได้ไม่ไปนับแถวที่ยุบทิ้งไปแล้วซ้ำอีก
  const seqGroups = new Map<string, CleanRow[]>()
  for (const r of rows) {
    if (r.seq === null) continue
    const k = `${r.date}|${r.driverPhone}|${r.seq}`
    const list = seqGroups.get(k) ?? []
    list.push(r)
    seqGroups.set(k, list)
  }
  const surchargeLines = [...seqGroups.values()]
    .filter((l) => l.length > 1)
    .map((l) => ({
      date: l[0]!.date,
      driverName: l[0]!.driverName,
      seq: l[0]!.seq!,
      rows: l.length,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  return {
    rows,
    invalid,
    collapsedAcrossSheets,
    collapsedSameSheet: sameSeqCollapsed,
    repeatTrips,
    surchargeLines,
  }
}

/** ทางลัดสำหรับหน้ากรอกทีละงาน — หนึ่งแถว หนึ่งฟิลด์ต่อหนึ่งค่า */
export async function cleanManualRow(
  values: RawRow,
): Promise<{ rows: CleanRow[]; invalid: InvalidRow[] }> {
  const fields = Object.keys(values) as Field[]
  const columns: ColumnMap = {}
  const cells: unknown[] = []
  fields.forEach((f, i) => {
    columns[f] = i
    cells[i] = values[f] ?? null
  })
  const { rows, invalid } = await cleanSheets([
    { name: 'กรอกด้วยมือ', columns, rows: [{ rowNo: 1, cells }] },
  ])
  return { rows, invalid }
}

