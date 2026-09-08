/**
 * demoClient.ts — ตัวแทน supabase-js สำหรับรันดูบนเครื่องโดยไม่ต้องมีฐานข้อมูล
 *
 * ใช้เมื่อ VITE_DEMO=1 เท่านั้น อ่านข้อมูลจริง 7,556 เที่ยวจาก public/demo/*.json
 * ซึ่งคำนวณผลของ view ไว้ล่วงหน้าด้วย scripts/build_demo_data.py
 *
 * ข้อจำกัดที่ต้องรู้
 *   - การเขียนอยู่ในหน่วยความจำ รีเฟรชหน้าแล้วหาย
 *   - ไม่มี RLS ทุกอย่างเปิดหมด ของจริงสิทธิ์บังคับที่ฐานข้อมูล
 *   - ยังไม่มีคะแนนใด ๆ ตรงกับสถานะจริงหลังนำเข้าข้อมูลชุดแรก
 */

type Row = Record<string, unknown>

interface Result<T> {
  data: T
  error: { message: string } | null
  count?: number
}

const cache = new Map<string, Row[]>()
const writes = new Map<string, Row[]>() // ข้อมูลที่เพิ่มระหว่างใช้งาน

const FILE_TABLES = new Set([
  'driver_directory',
  'driver_job_history',
  'driver_customer_perf',
  'customers',
  'vehicle_types',
  'rating_criteria',
  // สามตารางนี้มีแค่คอลัมน์ที่หน้าอัปโหลดใช้ตรวจของซ้ำ
  // ถ้าไม่โหลด ทุกแถวจะดูเหมือนเป็นของใหม่ แล้วผลการนำเข้าบนหน้าจะโกหก
  'jobs',
  'drivers',
  'vehicles',
])

/**
 * drivers_pending_review ไม่มีไฟล์ demo ของตัวเอง — คำนวณสดจาก driver_directory
 * ที่โหลดอยู่แล้ว (rating_count = 0) แทน เพราะเป็นแค่ filter/map ของข้อมูลเดิม
 * ไม่ต้องให้ build_demo_data.py คำนวณล่วงหน้าซ้ำอีกไฟล์
 */
async function loadPendingReview(): Promise<Row[]> {
  const dir = await loadTable('driver_directory')
  return dir
    .filter((d) => (Number(d.rating_count) || 0) === 0 && (d.status === 'active' || d.status === 'probation'))
    .map((d) => ({
      id: d.id,
      driver_code: d.driver_code,
      full_name: d.full_name,
      phone: d.phone,
      status: d.status,
      total_jobs: d.total_jobs ?? 0,
      last_job_date: d.last_job_date ?? null,
      days_since_last_job: d.days_since_last_job ?? null,
      rating_count: d.rating_count ?? 0,
      is_priority:
        Number(d.total_jobs ?? 0) >= 10 || Number(d.days_since_last_job ?? Infinity) <= 90,
    }))
}

async function loadTable(table: string): Promise<Row[]> {
  const extra = writes.get(table) ?? []
  if (table === 'drivers_pending_review') {
    const rows = await loadPendingReview()
    return extra.length ? [...extra, ...rows] : rows
  }
  if (!FILE_TABLES.has(table)) return extra

  let base = cache.get(table)
  if (!base) {
    const res = await fetch(`${import.meta.env.BASE_URL}demo/${table}.json`)
    base = res.ok ? ((await res.json()) as Row[]) : []
    cache.set(table, base)
  }
  return extra.length ? [...extra, ...base] : base
}

// ---------------------------------------------------------------- ตัวกรอง

type Filter = (r: Row) => boolean

/**
 * เทียบค่าแบบรู้ชนิด — ถ้าเป็นตัวเลขทั้งคู่ต้องเทียบเป็นตัวเลข
 * ถ้าเทียบเป็นข้อความ "9" จะมากกว่า "10" ซึ่งทำให้ตัวกรองจำนวนเที่ยวเพี้ยน
 */
function cmp(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return -1
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb ? 0 : na < nb ? -1 : 1
  const sa = String(a)
  const sb = String(b)
  return sa === sb ? 0 : sa < sb ? -1 : 1
}

function ilike(value: unknown, pattern: string): boolean {
  const v = String(value ?? '').toLowerCase()
  const p = pattern.toLowerCase()
  if (p.startsWith('%') && p.endsWith('%')) return v.includes(p.slice(1, -1))
  if (p.startsWith('%')) return v.endsWith(p.slice(1))
  if (p.endsWith('%')) return v.startsWith(p.slice(0, -1))
  return v === p
}

/** แปลงเงื่อนไขแบบ PostgREST เช่น "full_name.ilike.%สม%" */
function parseCondition(expr: string): Filter {
  const first = expr.indexOf('.')
  const second = expr.indexOf('.', first + 1)
  const col = expr.slice(0, first)
  const op = expr.slice(first + 1, second)
  const val = expr.slice(second + 1)
  switch (op) {
    case 'ilike':
      return (r) => ilike(r[col], val)
    case 'like':
      return (r) => String(r[col] ?? '').includes(val.replace(/%/g, ''))
    case 'eq':
      return (r) => String(r[col] ?? '') === val
    // ใช้ cmp ที่รู้ชนิด ไม่ใช่เทียบข้อความ ไม่งั้น "9" จะมากกว่า "10"
    // แล้วตัวกรองจำนวนเที่ยว/จำนวนวันใน .or() จะให้ผลผิดแบบเงียบ ๆ
    case 'gte':
      return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], val) >= 0
    case 'lte':
      return (r) => r[col] !== null && r[col] !== undefined && cmp(r[col], val) <= 0
    default:
      return () => true
  }
}

// ---------------------------------------------------------------- builder

class Query implements PromiseLike<Result<Row[]>> {
  private filters: Filter[] = []
  private orders: { col: string; asc: boolean }[] = []
  private limitN: number | null = null
  private rangeFromTo: [number, number] | null = null
  private wantCount = false
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private pending: Row[] | null = null
  private patch: Row | null = null

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: string }) {
    if (opts?.count === 'exact') this.wantCount = true
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push((r) => String(r[col] ?? '') === String(val))
    return this
  }

  gte(col: string, val: unknown) {
    this.filters.push((r) => cmp(r[col], val) >= 0)
    return this
  }

  lte(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && cmp(r[col], val) <= 0)
    return this
  }

  gt(col: string, val: unknown) {
    this.filters.push((r) => cmp(r[col], val) > 0)
    return this
  }

  lt(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== null && r[col] !== undefined && cmp(r[col], val) < 0)
    return this
  }

  not(col: string, op: string, val: unknown) {
    if (op === 'is' && val === null) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined)
    }
    return this
  }

  is(col: string, val: unknown) {
    this.filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : true))
    return this
  }

  in(col: string, vals: unknown[]) {
    const set = new Set(vals.map(String))
    this.filters.push((r) => set.has(String(r[col] ?? '')))
    return this
  }

  or(expr: string) {
    const parts = expr.split(',').map(parseCondition)
    this.filters.push((r) => parts.some((f) => f(r)))
    return this
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false })
    return this
  }

  limit(n: number) {
    this.limitN = n
    return this
  }

  range(from: number, to: number) {
    this.rangeFromTo = [from, to]
    return this
  }

  maybeSingle() {
    this.mode = 'maybe'
    return this as unknown as PromiseLike<Result<Row | null>>
  }

  single() {
    this.mode = 'single'
    return this as unknown as PromiseLike<Result<Row>>
  }

  insert(rows: Row | Row[]) {
    const list = (Array.isArray(rows) ? rows : [rows]).map((r) => ({
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      ...r,
    }))
    this.pending = list
    const cur = writes.get(this.table) ?? []
    writes.set(this.table, [...list, ...cur])
    return this
  }

  upsert(rows: Row | Row[], _opts?: unknown) {
    return this.insert(rows)
  }

  update(patch: Row) {
    this.patch = patch
    return this
  }

  delete() {
    this.pending = []
    return this
  }

  async run(): Promise<Result<never>> {
    if (this.pending) {
      const data = this.pending
      return {
        data: (this.mode === 'many' ? data : (data[0] ?? null)) as never,
        error: null,
      }
    }

    if (this.patch) {
      const changed = await applyUpdate(this.table, this.patch, this.filters)
      return {
        data: (this.mode === 'many' ? changed : (changed[0] ?? null)) as never,
        error: null,
      }
    }

    let rows = await loadTable(this.table)
    for (const f of this.filters) rows = rows.filter(f)

    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[o.col]
        const y = b[o.col]
        if (x === y) return 0
        if (x === null || x === undefined) return 1
        if (y === null || y === undefined) return -1
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'th')
        return o.asc ? cmp : -cmp
      })
    }

    const total = rows.length
    if (this.rangeFromTo) rows = rows.slice(this.rangeFromTo[0], this.rangeFromTo[1] + 1)
    else if (this.limitN !== null) rows = rows.slice(0, this.limitN)

    if (this.mode === 'single' || this.mode === 'maybe') {
      return { data: (rows[0] ?? null) as never, error: null }
    }
    return { data: rows as never, error: null, count: this.wantCount ? total : undefined }
  }

  then<A, B = never>(
    onOk?: ((v: Result<Row[]>) => A | PromiseLike<A>) | null,
    onErr?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onOk as never, onErr)
  }
}

/**
 * แก้ข้อมูลจริงในหน่วยความจำ
 *
 * แอปสั่งแก้ตาราง `drivers` แต่หน้าจออ่านจาก view `driver_directory`
 * ในโหมดทดลองไม่มี view ให้คำนวณใหม่ จึงต้องแมปการเขียนไปที่ข้อมูลที่หน้าจออ่านอยู่
 * และจำลองทริกเกอร์ที่ฐานข้อมูลจริงใช้บันทึกประวัติการเปลี่ยนสถานะเอง
 */
async function applyUpdate(table: string, patch: Row, filters: Filter[]): Promise<Row[]> {
  const target = table === 'drivers' ? 'driver_directory' : table

  // ต้องแก้ที่อาเรย์ต้นทางโดยตรง ไม่ใช่สำเนาที่ loadTable คืนมา ไม่งั้นการแก้จะหายไป
  await loadTable(target)
  const rows = (FILE_TABLES.has(target) ? cache.get(target) : writes.get(target)) ?? []
  const hits: Row[] = []

  for (let i = 0; i < rows.length; i++) {
    const old = rows[i]!
    if (!filters.every((f) => f(old))) continue

    const before = old.status
    // สร้างอ็อบเจกต์ใหม่แทนการแก้ของเดิม ไม่งั้น react-query จะมองว่าข้อมูลไม่เปลี่ยน
    // (เทียบด้วย reference เดิม) แล้วหน้าจอจะไม่วาดใหม่
    const next = { ...old, ...patch }
    rows[i] = next
    hits.push(next)

    // จำลอง trigger drivers_log_status
    if (target === 'driver_directory' && 'status' in patch && patch.status !== before) {
      const log = writes.get('driver_status_log') ?? []
      log.unshift({
        id: crypto.randomUUID(),
        driver_id: next.id,
        from_status: before ?? null,
        to_status: patch.status,
        reason: (patch.status_reason as string | null) ?? null,
        changed_at: new Date().toISOString(),
        changed_by: DEMO_USER.id,
        changed_by_name: 'ผู้ใช้ทดลอง',
      })
      writes.set('driver_status_log', log)
    }
  }
  return hits
}

// ------------------------------------------------------- จัดอันดับ

/**
 * เรียงด้วยข้อมูลจริงหลายชั้น ไม่มีคะแนนผสมสูตรเดียว — จำลอง search_drivers()
 * ใน supabase/migrations/0009_search_drivers_real_signals.sql
 * (เวอร์ชันก่อนหน้าเคยผสมคะแนนคุณภาพงาน/ตรงเวลาที่ไม่มีข้อมูลจริงรองรับเข้าไปด้วย
 * ตัดทิ้งเพราะเป็นค่าที่มโนขึ้นเอง ไม่ใช่ข้อมูลจริงจากผู้ใช้)
 */
async function searchDrivers(p: {
  p_customer_code?: string | null
  p_vehicle_type_code?: string | null
  p_route_keyword?: string | null
  p_limit?: number
}): Promise<Result<Row[]>> {
  const dir = await loadTable('driver_directory')
  const hist = await loadTable('driver_job_history')

  const cust = p.p_customer_code?.toUpperCase() || null
  const vt = p.p_vehicle_type_code?.toUpperCase() || null
  const kw = p.p_route_keyword?.toLowerCase() || null

  const byDriver = new Map<string, { c: number; v: number; r: number }>()
  for (const h of hist) {
    const id = String(h.driver_id)
    const e = byDriver.get(id) ?? { c: 0, v: 0, r: 0 }
    if (cust && String(h.customer_code ?? '').toUpperCase() === cust) e.c++
    if (vt && String(h.vehicle_type_code ?? '').toUpperCase() === vt) e.v++
    if (kw && String(h.route_raw ?? '').toLowerCase().includes(kw)) e.r++
    byDriver.set(id, e)
  }

  const rows = dir
    .filter((d) => d.status === 'active' || d.status === 'probation')
    .map((d) => {
      const e = byDriver.get(String(d.id)) ?? { c: 0, v: 0, r: 0 }
      return {
        driver_id: d.id,
        driver_code: d.driver_code,
        full_name: d.full_name,
        phone: d.phone,
        total_jobs: (d.total_jobs as number) ?? 0,
        customer_jobs: e.c,
        vehicle_type_jobs: e.v,
        route_jobs: e.r,
        adjusted_score: d.adjusted_score as number | null,
        rating_count: (d.rating_count as number) ?? 0,
        last_job_date: d.last_job_date as string | null,
        _problems: (d.recent_problem_jobs as number) ?? 0,
      }
    })
    .sort((a, b) => {
      const problems = a._problems - b._problems
      if (problems !== 0) return problems
      const hasRating = Number(b.rating_count > 0) - Number(a.rating_count > 0)
      if (hasRating !== 0) return hasRating
      const rating = (b.adjusted_score ?? -1) - (a.adjusted_score ?? -1)
      if (rating !== 0) return rating
      const customer = b.customer_jobs - a.customer_jobs
      if (customer !== 0) return customer
      const vtype = b.vehicle_type_jobs - a.vehicle_type_jobs
      if (vtype !== 0) return vtype
      const route = b.route_jobs - a.route_jobs
      if (route !== 0) return route
      const total = b.total_jobs - a.total_jobs
      if (total !== 0) return total
      return String(b.last_job_date ?? '').localeCompare(String(a.last_job_date ?? ''))
    })
    .slice(0, p.p_limit ?? 25)
    .map(({ _problems: _, ...row }) => row)

  return { data: rows, error: null }
}

// ----------------------------------------------------- คำแนะนำเส้นทาง

async function searchRoutes(p: { p_limit?: number }): Promise<Result<Row[]>> {
  const hist = await loadTable('driver_job_history')

  const counts = new Map<string, number>()
  for (const h of hist) {
    const route = String(h.route_raw ?? '').trim()
    if (!route) continue
    counts.set(route, (counts.get(route) ?? 0) + 1)
  }

  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, p.p_limit ?? 500)
    .map(([route_raw, job_count]) => ({ route_raw, job_count }))

  return { data: rows, error: null }
}

// ------------------------------------------------------------ auth ปลอม

const DEMO_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@example.com',
}
const DEMO_SESSION = { user: DEMO_USER, access_token: 'demo' }

writes.set('profiles', [
  {
    id: DEMO_USER.id,
    full_name: 'ผู้ใช้ทดลอง',
    email: DEMO_USER.email,
    role: 'admin',
    department: null,
    is_active: true,
    created_at: new Date().toISOString(),
  },
])

export const demoClient = {
  from: (table: string) => new Query(table),
  rpc: (fn: string, params: Record<string, unknown>) =>
    fn === 'search_drivers'
      ? searchDrivers(params)
      : fn === 'search_routes'
        ? searchRoutes(params)
        : Promise.resolve({ data: [], error: { message: `demo ไม่รองรับ rpc ${fn}` } }),
  auth: {
    getSession: async () => ({ data: { session: DEMO_SESSION }, error: null }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
    signInWithPassword: async () => ({ data: { session: DEMO_SESSION }, error: null }),
    signUp: async () => ({ data: { session: DEMO_SESSION }, error: null }),
    signOut: async () => {
      window.alert('โหมดทดลองไม่มีการออกจากระบบ')
      return { error: null }
    },
  },
}
