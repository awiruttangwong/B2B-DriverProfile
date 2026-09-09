/**
 * นำเข้าข้อมูลเที่ยววิ่ง — ใช้ร่วมกันทั้งหน้าอัปโหลดไฟล์และหน้ากรอกทีละงาน
 *
 * ทุกอย่างวิ่งผ่าน anon key + RLS ไม่ต้องมี service_role และไม่ต้องมี API ของเราเอง
 * ความปลอดภัยของการเขียนบังคับด้วย policy can_write_master() ที่ฐานข้อมูล
 *
 * ไฟล์นี้ไม่รู้จักชื่อคอลัมน์ในไฟล์ Excel เลย — การแปลงหัวตารางเป็นฟิลด์กลาง
 * อยู่ใน sourceProfiles.ts ทั้งหมด ที่นี่รับมาแต่ ColumnMap ที่แปลงเสร็จแล้ว
 */

import { supabase } from './supabase'
import { detUuid, isSamePerson } from './normalize'
import type { CleanRow, InvalidRow } from './cleaning'

export type {
  CleanResult,
  CleanRow,
  InvalidRow,
  RawRow,
  SourceSheet,
} from './cleaning'
export { cleanManualRow, cleanSheets, isUsableRow } from './cleaning'

/**
 * เที่ยวที่น่าจะเป็นเที่ยวเดิมในระบบที่ถูกแก้ข้อมูลในไฟล์ต้นทาง
 *
 * ระบบระบุตัวเที่ยวด้วย วันที่ + ลูกค้า + ทะเบียน + เบอร์ พขร. + เส้นทาง + ราคารับ + ราคาจ่าย
 * ถ้าฝ่ายบัญชีกลับไปแก้ช่องใดช่องหนึ่ง เที่ยวนั้นจะกลายเป็นเที่ยวใหม่ในสายตาระบบ
 * แล้วเที่ยวเดิมยังค้างอยู่ กลายเป็นสองเที่ยวจากงานเดียว
 *
 * ในไฟล์ IMPORT SUM ของจริงพบ 10 เที่ยวแบบนี้ ทั้งหมดเป็นการเติมทะเบียนรถย้อนหลัง
 */
export interface RevisedTrip {
  date: string
  driverName: string
  route: string | null
  /** ช่องที่ต่างจากเที่ยวเดิมในระบบ */
  changed: string[]
  existingJobId: string
}

export interface IngestReport {
  totalRows: number
  invalidRows: InvalidRow[]
  duplicateInFile: number
  alreadyInDb: number
  jobsInserted: number
  driversCreated: number
  driversMatched: number
  vehiclesCreated: number
  customersCreated: number
  vehicleTypesCreated: number
  revised: RevisedTrip[]
  /**
   * จำนวน พขร. ที่บันทึก/อัปเดตเลขบัญชีธนาคาร — เป็น PII เขียนได้เฉพาะ admin/hr
   * ถ้าผู้ใช้เป็น ops จะเขียนไม่ผ่าน RLS ตัวเลขนี้จึงอาจน้อยกว่าจำนวนที่ไฟล์มีจริง
   * ดู errors ประกอบถ้าตัวเลขนี้เป็น 0 ทั้งที่ไฟล์มีคอลัมน์เลขบัญชี
   */
  driverAccountsSaved: number
  errors: string[]
}

type Progress = (pct: number, label: string) => void

const CHUNK = 400

function chunk<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * นำเข้าแถวที่สะอาดแล้วลงฐานข้อมูล
 *
 * ลำดับสำคัญ: ตารางอ้างอิง -> พขร. -> งาน -> การมอบหมาย
 * เพราะแต่ละขั้นต้องใช้ id จากขั้นก่อนหน้า
 */
export async function ingestRows(
  rows: CleanRow[],
  opts: { filename: string; sheetName?: string; onProgress?: Progress } = {
    filename: 'manual',
  },
): Promise<IngestReport> {
  const report: IngestReport = {
    totalRows: rows.length,
    invalidRows: [],
    duplicateInFile: 0,
    alreadyInDb: 0,
    jobsInserted: 0,
    driversCreated: 0,
    driversMatched: 0,
    vehiclesCreated: 0,
    customersCreated: 0,
    vehicleTypesCreated: 0,
    revised: [],
    driverAccountsSaved: 0,
    errors: [],
  }

  const say: Progress = opts.onProgress ?? (() => {})
  if (rows.length === 0) return report

  // cleanSheets ยุบแถวซ้ำไปแล้ว แต่กันไว้อีกชั้นเผื่อมีคนเรียกตรง ๆ
  const seen = new Set<string>()
  const unique = rows.filter((r) => {
    if (seen.has(r.hash)) return false
    seen.add(r.hash)
    return true
  })
  report.duplicateInFile = rows.length - unique.length

  // ------------------------------------------------------------ ตารางอ้างอิง
  say(5, 'เตรียมลูกค้าและประเภทรถ')

  const customerCodes = [...new Set(unique.map((r) => r.customer).filter(Boolean))] as string[]
  const vtypeCodes = [...new Set(unique.map((r) => r.vehicleType).filter(Boolean))] as string[]
  const plates = [...new Set(unique.map((r) => r.plate).filter(Boolean))] as string[]

  const customerIds = await upsertLookup(
    'customers',
    customerCodes,
    'customer',
    report,
    'customersCreated',
  )
  const vtypeIds = await upsertLookup(
    'vehicle_types',
    vtypeCodes,
    'vtype',
    report,
    'vehicleTypesCreated',
  )

  // ---------------------------------------------------------------- รถ
  say(15, 'เตรียมทะเบียนรถ')
  const plateType = new Map<string, string | null>()
  for (const r of unique) {
    if (r.plate && !plateType.has(r.plate)) plateType.set(r.plate, r.vehicleType)
  }

  const existingVehicles = await fetchExisting('vehicles', 'plate', plates)
  const vehicleIds = new Map<string, string>(existingVehicles.map((v) => [v.key, v.id]))

  const newVehicles: { id: string; plate: string; vehicle_type_id: string | null }[] = []
  for (const p of plates) {
    if (vehicleIds.has(p)) continue
    const id = await detUuid('vehicle', p)
    const vt = plateType.get(p)
    newVehicles.push({ id, plate: p, vehicle_type_id: (vt && vtypeIds.get(vt)) || null })
    vehicleIds.set(p, id)
  }
  if (newVehicles.length) {
    for (const part of chunk(newVehicles)) {
      const { error } = await supabase
        .from('vehicles')
        .upsert(part, { onConflict: 'plate', ignoreDuplicates: true })
      if (error) report.errors.push(`ทะเบียนรถ: ${error.message}`)
    }
    report.vehiclesCreated = newVehicles.length
  }

  // -------------------------------------------------------------- พขร.
  say(30, 'จับคู่ตัวตน พขร.')
  const driverIds = await resolveDrivers(unique, report)

  // ------------------------------------------------------ บัญชีธนาคาร พขร.
  // ทำก่อนเช็คงานซ้ำโดยตั้งใจ — ต้องอัปเดตเลขบัญชีให้ทันแม้ทุกเที่ยวในไฟล์
  // จะเคยนำเข้าไปแล้วก็ตาม (เช่น อัปโหลดไฟล์เดิมซ้ำหลังบัญชีถูกแก้)
  say(38, 'บันทึกข้อมูลบัญชีธนาคาร')
  report.driverAccountsSaved = await saveDriverAccounts(unique, driverIds, report)

  // -------------------------------------------------------------- งาน
  say(55, 'ตรวจงานที่นำเข้าไปแล้ว')

  const hashes = unique.map((r) => r.hash)
  const existingHashes = new Set<string>()
  for (const part of chunk(hashes, 300)) {
    const { data, error } = await supabase.from('jobs').select('row_hash').in('row_hash', part)
    if (error) {
      report.errors.push(`ตรวจงานซ้ำ: ${error.message}`)
      continue
    }
    for (const row of data ?? []) existingHashes.add((row as { row_hash: string }).row_hash)
  }
  report.alreadyInDb = existingHashes.size

  const fresh = unique.filter((r) => !existingHashes.has(r.hash))
  if (fresh.length === 0) {
    say(100, 'ไม่มีงานใหม่ — ข้อมูลทั้งหมดนำเข้าไว้แล้ว')
    return report
  }

  say(60, 'ตรวจเที่ยวที่อาจเป็นของเดิมที่ถูกแก้')
  report.revised = await findRevisedTrips(fresh, driverIds, report)

  // บันทึกประวัติการนำเข้าไว้ตรวจสอบย้อนหลัง
  const { data: batch } = await supabase
    .from('import_batches')
    .insert({
      filename: opts.filename,
      sheet_name: opts.sheetName ?? null,
      row_total: rows.length,
      status: 'running',
    })
    .select('id')
    .maybeSingle()
  const batchId = (batch as { id: string } | null)?.id ?? null

  say(65, `บันทึกงานใหม่ ${fresh.length.toLocaleString('th-TH')} เที่ยว`)

  const jobRows = await Promise.all(
    fresh.map(async (r) => ({
      id: await detUuid('job', r.hash),
      job_date: r.date,
      seq_no: r.seq,
      segment: r.segment,
      customer_id: (r.customer && customerIds.get(r.customer)) || null,
      vehicle_type_id: (r.vehicleType && vtypeIds.get(r.vehicleType)) || null,
      vehicle_id: (r.plate && vehicleIds.get(r.plate)) || null,
      route_raw: r.route,
      origin: r.origin,
      destination: r.destination,
      revenue: r.revenue,
      cost: r.cost,
      margin: r.margin,
      margin_pct: r.marginPct,
      withholding_1pct: r.withholding,
      dispatcher_name: r.dispatcherName,
      dispatcher_phone: r.dispatcherPhone,
      note: r.note,
      source: 'import',
      import_batch_id: batchId,
      row_hash: r.hash,
    })),
  )

  let done = 0
  for (const part of chunk(jobRows)) {
    const { error } = await supabase
      .from('jobs')
      .upsert(part, { onConflict: 'row_hash', ignoreDuplicates: true })
    if (error) {
      report.errors.push(`บันทึกงาน: ${error.message}`)
    } else {
      report.jobsInserted += part.length
    }
    done += part.length
    say(65 + Math.round((done / jobRows.length) * 20), 'บันทึกงาน')
  }

  // ---------------------------------------------------- ผูก พขร. กับงาน
  say(88, 'ผูก พขร. เข้ากับงาน')

  const asgRows: { id: string; job_id: string; driver_id: string; role: string; outcome: string }[] =
    []
  for (const r of fresh) {
    const did = driverIds.get(driverKey(r.driverPhone, r.driverName))
    if (!did) continue
    asgRows.push({
      id: await detUuid('asg', r.hash),
      job_id: await detUuid('job', r.hash),
      driver_id: did,
      role: 'primary',
      outcome: 'completed',
    })
  }

  for (const part of chunk(asgRows)) {
    const { error } = await supabase
      .from('job_assignments')
      .upsert(part, { onConflict: 'job_id,driver_id', ignoreDuplicates: true })
    if (error) report.errors.push(`ผูก พขร. กับงาน: ${error.message}`)
  }

  if (batchId) {
    await supabase
      .from('import_batches')
      .update({
        row_inserted: report.jobsInserted,
        row_skipped: report.alreadyInDb + report.duplicateInFile,
        row_failed: report.errors.length,
        status: report.errors.length ? 'failed' : 'done',
        finished_at: new Date().toISOString(),
      })
      .eq('id', batchId)
  }

  say(100, 'เสร็จสิ้น')
  return report
}

// ------------------------------------------------------------------ helpers

function driverKey(phone: string, name: string) {
  return `${phone}|${name}`
}

/**
 * หาเที่ยวใหม่ที่น่าจะเป็นเที่ยวเดิมในระบบที่ถูกแก้ข้อมูล
 *
 * ค้นเฉพาะ พขร. และวันที่ที่ปรากฏในแถวใหม่เท่านั้น ต้นทุนจึงผูกกับขนาดของสิ่งที่
 * เพิ่งนำเข้า ไม่ใช่ขนาดฐานข้อมูล — อัปโหลดรายเดือนจะยิงแค่ไม่กี่คำสั่ง
 *
 * เทียบด้วย (พขร., วันที่, เส้นทาง) ซึ่งเป็นสามช่องที่แทบไม่มีใครกลับไปแก้
 * ส่วนช่องที่แก้กันบ่อย (ทะเบียน ราคา) เอามาไล่ดูว่าต่างตรงไหน
 */
async function findRevisedTrips(
  fresh: CleanRow[],
  driverIds: Map<string, string>,
  report: IngestReport,
): Promise<RevisedTrip[]> {
  const ids = [
    ...new Set(
      fresh.map((r) => driverIds.get(driverKey(r.driverPhone, r.driverName))).filter(Boolean),
    ),
  ] as string[]
  const dates = [...new Set(fresh.map((r) => r.date))]
  if (ids.length === 0 || dates.length === 0) return []

  type Hist = {
    job_id: string
    driver_id: string
    job_date: string
    route_raw: string | null
    plate: string | null
    revenue: number | null
    cost: number | null
  }

  /*
   * ยิงทีละก้อนของ พขร. โดยคุมวันที่ด้วย "ช่วงวันที่" ไม่ใช่รายการวันทีละก้อน
   *
   * ของเดิมวนสองชั้น (ก้อน พขร. × ก้อนวันที่) ซึ่งเป็นผลคูณไขว้ พอเป็นการนำเข้า
   * ไฟล์ประวัติทั้งก้อน (พขร. 1,290 คน × ~500 วัน) จะกลายเป็น 7 × 3 = 21 คำสั่ง
   * ที่รอกันเป็นทอด ๆ คำสั่งละ ~88 มิลลิวินาทีที่ฐานข้อมูล บวกเวลาเดินทางอีกเส้นละ
   * ~150 มิลลิวินาที รวมแล้วผู้ใช้รอเปล่า ๆ ราว 5 วินาที
   *
   * ใช้ช่วง min..max ของวันที่แทน ได้ผลลัพธ์ครอบคลุมเท่าเดิม (กว้างกว่าเล็กน้อย)
   * แล้วปล่อยให้ byKey ข้างล่างคัดตรง ๆ อยู่แล้ว — เหลือ 7 คำสั่ง และยิงพร้อมกันได้
   */
  const sortedDates = [...dates].sort()
  const minDate = sortedDates[0]!
  const maxDate = sortedDates[sortedDates.length - 1]!

  const parts = await Promise.all(
    chunk(ids, 200).map(async (part) => {
      const { data, error } = await supabase
        .from('driver_job_history')
        .select('job_id, driver_id, job_date, route_raw, plate, revenue, cost')
        .in('driver_id', part)
        .gte('job_date', minDate)
        .lte('job_date', maxDate)
      if (error) throw new Error(error.message)
      return (data ?? []) as Hist[]
    }),
  ).catch((err: Error) => {
    report.errors.push(`ตรวจเที่ยวที่ถูกแก้: ${err.message}`)
    return null
  })
  if (parts === null) return []
  const existing: Hist[] = parts.flat()
  if (existing.length === 0) return []

  const key = (driverId: string, date: string, route: string | null) =>
    `${driverId}|${date}|${route ?? ''}`

  const byKey = new Map<string, Hist[]>()
  for (const e of existing) {
    const k = key(e.driver_id, e.job_date, e.route_raw)
    const list = byKey.get(k) ?? []
    list.push(e)
    byKey.set(k, list)
  }

  // เที่ยวเดิมหนึ่งแถวจับคู่ได้ครั้งเดียว ไม่งั้นสามเที่ยวซ้ำในวันเดียวจะรายงานผิด
  const used = new Set<string>()
  const out: RevisedTrip[] = []

  for (const r of fresh) {
    const did = driverIds.get(driverKey(r.driverPhone, r.driverName))
    if (!did) continue
    const candidates = byKey.get(key(did, r.date, r.route)) ?? []
    const hit = candidates.find((c) => !used.has(c.job_id))
    if (!hit) continue

    const changed: string[] = []
    if ((hit.plate ?? '') !== (r.plate ?? '')) changed.push('ทะเบียน')
    if (Number(hit.revenue ?? 0) !== Number(r.revenue ?? 0)) changed.push('ราคารับ')
    if (Number(hit.cost ?? 0) !== Number(r.cost ?? 0)) changed.push('ราคาจ่าย')
    if (changed.length === 0) continue

    used.add(hit.job_id)
    out.push({
      date: r.date,
      driverName: r.driverName,
      route: r.route,
      changed,
      existingJobId: hit.job_id,
    })
  }

  return out
}

async function fetchExisting(
  table: 'customers' | 'vehicle_types' | 'vehicles' | 'banks',
  keyCol: 'code' | 'plate',
  keys: string[],
): Promise<{ key: string; id: string }[]> {
  const out: { key: string; id: string }[] = []
  for (const part of chunk(keys, 300)) {
    if (part.length === 0) continue
    const { data, error } = await supabase.from(table).select(`id, ${keyCol}`).in(keyCol, part)
    if (error) continue
    for (const row of data ?? []) {
      const r = row as Record<string, string>
      out.push({ key: r[keyCol] as string, id: r.id as string })
    }
  }
  return out
}

async function upsertLookup(
  table: 'customers' | 'vehicle_types' | 'banks',
  codes: string[],
  uuidKind: string,
  report: IngestReport,
  counter: 'customersCreated' | 'vehicleTypesCreated' | null,
): Promise<Map<string, string>> {
  const existing = await fetchExisting(table, 'code', codes)
  const map = new Map<string, string>(existing.map((e) => [e.key, e.id]))

  const missing = codes.filter((c) => !map.has(c))
  if (missing.length === 0) return map

  const rows = await Promise.all(
    missing.map(async (code) => ({ id: await detUuid(uuidKind, code), code, name: code })),
  )
  for (const part of chunk(rows)) {
    const { error } = await supabase
      .from(table)
      .upsert(part, { onConflict: 'code', ignoreDuplicates: true })
    if (error) report.errors.push(`${table}: ${error.message}`)
  }
  for (const r of rows) map.set(r.code, r.id)
  if (counter) report[counter] = missing.length
  return map
}

/**
 * หา พขร. ที่มีอยู่แล้ว หรือสร้างใหม่
 *
 * เบอร์โทรอย่างเดียวใช้เป็นคีย์ไม่ได้ เพราะในข้อมูลจริงมีเบอร์กลางของผู้รับเหมา
 * ที่ผูกกับคนขับหลายคน จึงต้องเทียบชื่อด้วย: ชื่อที่คล้ายกันพอบนเบอร์เดียวกัน
 * = คนเดิมสะกดต่าง ส่วนชื่อที่ต่างกันชัดเจน = คนละคน
 */
async function resolveDrivers(
  rows: CleanRow[],
  report: IngestReport,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()

  const pairs = new Map<string, { phone: string; name: string }>()
  for (const r of rows) {
    pairs.set(driverKey(r.driverPhone, r.driverName), {
      phone: r.driverPhone,
      name: r.driverName,
    })
  }

  const phones = [...new Set([...pairs.values()].map((p) => p.phone))]

  // ดึง พขร. ที่มีเบอร์ตรงกันมาก่อน แล้วค่อยเทียบชื่อในหน่วยความจำ
  const byPhone = new Map<string, { id: string; full_name: string }[]>()
  for (const part of chunk(phones, 300)) {
    const { data, error } = await supabase
      .from('drivers')
      .select('id, full_name, phone')
      .in('phone', part)
    if (error) {
      report.errors.push(`ค้นหา พขร.: ${error.message}`)
      continue
    }
    for (const row of data ?? []) {
      const d = row as { id: string; full_name: string; phone: string }
      const list = byPhone.get(d.phone) ?? []
      list.push({ id: d.id, full_name: d.full_name })
      byPhone.set(d.phone, list)
    }
  }

  const toCreate: {
    id: string
    full_name: string
    phone: string
    first_job_date: string
    last_job_date: string
  }[] = []

  const dates = new Map<string, { first: string; last: string }>()
  for (const r of rows) {
    const k = driverKey(r.driverPhone, r.driverName)
    const cur = dates.get(k)
    if (!cur) dates.set(k, { first: r.date, last: r.date })
    else {
      if (r.date < cur.first) cur.first = r.date
      if (r.date > cur.last) cur.last = r.date
    }
  }

  for (const [key, { phone, name }] of pairs) {
    const candidates = byPhone.get(phone) ?? []
    const hit =
      candidates.find((c) => c.full_name === name) ??
      candidates.find((c) => isSamePerson(c.full_name, name))

    if (hit) {
      result.set(key, hit.id)
      report.driversMatched += 1
      continue
    }

    const id = await detUuid('driver', `${phone}|${name}`)
    const range = dates.get(key)!
    toCreate.push({
      id,
      full_name: name,
      phone,
      first_job_date: range.first,
      last_job_date: range.last,
    })
    result.set(key, id)
    // จำไว้ด้วย เผื่อมีชื่อสะกดใกล้เคียงตามมาในไฟล์เดียวกัน
    byPhone.set(phone, [...candidates, { id, full_name: name }])
  }

  if (toCreate.length) {
    for (const part of chunk(toCreate)) {
      const { error } = await supabase
        .from('drivers')
        .upsert(part, { onConflict: 'phone,full_name', ignoreDuplicates: true })
      if (error) report.errors.push(`สร้าง พขร.: ${error.message}`)
    }
    report.driversCreated = toCreate.length
  }

  return result
}

/**
 * บันทึกเลขบัญชีธนาคารของ พขร. — ข้อมูลนี้ etl_excel.py เคยเก็บให้ตอนโหลดชุดแรก
 * แต่เส้นทางอัปโหลดผ่านเว็บไม่เคยเขียนตารางนี้เลย ทำให้ พขร. ทุกคนที่เพิ่มผ่านเว็บ
 * ไม่มีเลขบัญชีติดมาด้วยทั้งที่ไฟล์ต้นทางมีคอลัมน์นี้อยู่
 *
 * ถ้า พขร. คนหนึ่งมีบัญชีหลายเลขในไฟล์ (เปลี่ยนธนาคารระหว่างทาง) ใช้แถวที่มี
 * วันที่ล่าสุดเป็นตัวชี้ขาด ตรงกับตรรกะใน etl_excel.py ทุกประการ
 *
 * driver_private เป็น PII เขียนได้เฉพาะ admin/hr (ดู can_see_pii() ในฐานข้อมูล)
 * ถ้าผู้ใช้เป็น ops การเขียนจะถูก RLS ปฏิเสธ — ปล่อยให้ error ไปโผล่ใน report.errors
 * แทนที่จะหยุดการนำเข้าทั้งหมด เพราะข้อมูลหลัก (งาน/พขร.) สำคัญกว่าบัญชีธนาคาร
 */
async function saveDriverAccounts(
  rows: CleanRow[],
  driverIds: Map<string, string>,
  report: IngestReport,
): Promise<number> {
  const bankCodes = [...new Set(rows.map((r) => r.bank).filter(Boolean))] as string[]
  const bankIds =
    bankCodes.length > 0 ? await upsertLookup('banks', bankCodes, 'bank', report, null) : new Map<string, string>()

  const latest = new Map<string, CleanRow>()
  for (const r of rows) {
    if (!r.accountNo) continue
    const did = driverIds.get(driverKey(r.driverPhone, r.driverName))
    if (!did) continue
    const cur = latest.get(did)
    if (!cur || r.date > cur.date) latest.set(did, r)
  }
  if (latest.size === 0) return 0

  const privateRows = [...latest.entries()].map(([driverId, r]) => ({
    driver_id: driverId,
    bank_id: (r.bank && bankIds.get(r.bank)) || null,
    account_no: r.accountNo,
    account_name: r.accountName,
  }))

  for (const part of chunk(privateRows)) {
    const { error } = await supabase.from('driver_private').upsert(part, { onConflict: 'driver_id' })
    if (error) report.errors.push(`บัญชีธนาคาร พขร.: ${error.message}`)
  }
  return privateRows.length
}
