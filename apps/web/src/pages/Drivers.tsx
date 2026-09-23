import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverDirectoryRow } from '../types/database'
import {
  fmtNum,
  fmtPhone,
  fmtSince,
  safeSearchTerm,
  STATUS_LABEL,
  suspensionRemainingLabel,
} from '../lib/format'
import { JOB_RANGE_OPTIONS } from '../lib/jobRanges'
import ScoreCell from '../components/ScoreCell'
import ReadinessPanel from '../components/ReadinessPanel'
import StatusDialog from '../components/StatusDialog'
import Combobox from '../components/Combobox'
import SkeletonRows from '../components/SkeletonRows'
import { IconSearch, IconUsers } from '../components/icons'

const STATUS_OPTIONS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'active', label: 'ใช้งาน' },
  { value: 'probation', label: 'ทดลองงาน' },
  { value: 'inactive', label: 'พักงาน' },
  { value: 'blacklisted', label: 'ห้ามใช้งาน' },
]

type SortKey = 'total_jobs' | 'adjusted_score' | 'last_job_date' | 'full_name'
const SORT_KEYS: SortKey[] = ['total_jobs', 'adjusted_score', 'last_job_date', 'full_name']

const PAGE_SIZE = 50

interface DriverSuggestion {
  id: string
  full_name: string
  phone: string | null
  driver_code: string
  status: string
}

/**
 * ช่องค้นหาพร้อมคำแนะนำ — พิมพ์แล้วกรองตารางด้านล่างตามปกติเหมือนเดิม
 * แต่ถ้าเจอคนที่ใช่แล้วในลิสต์แนะนำ คลิกได้เลยเพื่อกระโดดตรงไปหน้าโปรไฟล์คนนั้น
 * ไม่ต้องรอกรองตารางแล้วไล่หาอีกที
 */
function DriverSearchField({
  value,
  onChange,
  suggestions,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: DriverSuggestion[]
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // คำแนะนำมาจากฐานข้อมูลแล้ว (จำกัด 8 รายการ) ไม่ต้องกรองซ้ำในเครื่อง
  const filtered = value.trim() ? suggestions : []

  return (
    <div className={`search-field${value ? ' has-clear' : ''}`} ref={wrapRef}>
      <span
        style={{
          position: 'absolute',
          left: 11,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--muted)',
          display: 'flex',
        }}
      >
        <IconSearch size={16} />
      </span>
      <input
        id="q"
        ref={inputRef}
        // type="text" ไม่ใช่ "search" — เบราว์เซอร์ (Chrome เป็นต้น) แปะปุ่มล้าง
        // ค่า (×) ในตัวให้ input type=search ที่มีค่าอยู่แล้วเสมอ ซ้อนทับกับปุ่ม
        // .combo-clear ที่เราวาดเองด้านล่าง กลายเป็นมี × สองอันซ้อนกัน — Combobox
        // (ใช้ในหน้า "หา พขร. เพื่อเข้ารับงาน") ใช้ type="text" อยู่แล้วจึงไม่เจอปัญหานี้
        type="text"
        autoComplete="off"
        placeholder="ชื่อ พขร. / เบอร์โทร"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        style={{ paddingLeft: 34 }}
      />
      {value && (
        <button
          type="button"
          className="combo-clear"
          tabIndex={-1}
          aria-label="ล้างคำค้นหา"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
      {open && filtered.length > 0 && (
        <ul className="combo-list" role="listbox">
          {filtered.map((s) => (
            <li
              key={s.id}
              role="option"
              aria-selected={false}
              className="combo-item"
              onMouseDown={(e) => {
                e.preventDefault()
                setOpen(false)
                navigate(`/drivers/${s.id}`)
              }}
            >
              <span className="combo-label">{s.full_name}</span>
              <span className="combo-hint">{fmtPhone(s.phone)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** หน่วงการค้นหา ไม่ยิงคำสั่งใหม่ทุกตัวอักษรที่พิมพ์ */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export default function Drivers() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  // อ่านค่าเริ่มต้นจาก URL ครั้งเดียวตอนโหลดหน้า (ไม่มี effect ไหนอ่านย้อนกลับจาก URL
  // อีกหลังจากนี้) เพราะผู้ใช้ต้องปรับตัวกรองต่อได้เองโดยไม่ถูกดึงกลับไปค่าจาก URL ทุกครั้ง
  // — ตัวกรองทั้งหมดเขียนออกไปที่ URL ทางเดียวด้านล่าง (ดู effect ท้ายบล็อกนี้) เพื่อให้กด
  // ย้อนกลับจากหน้าโปรไฟล์ (หรือหน้าอื่นที่ลิงก์มา) แล้วเห็นตัวกรอง/การเรียง/เลขหน้าเดิม
  // เป๊ะ ๆ แทนที่จะรีเซ็ตเป็นค่าเริ่มต้นทุกครั้ง (เดิมมีแค่ "stale" ที่ทำแบบนี้)
  const [staleOnly, setStaleOnly] = useState(() => searchParams.get('stale') === '1')
  const [q, setQ] = useState(() => searchParams.get('q') ?? '')
  const [status, setStatus] = useState(() => {
    const v = searchParams.get('status')
    return v !== null && STATUS_OPTIONS.some((o) => o.value === v) ? v : 'active'
  })
  const [jobRange, setJobRange] = useState(() => {
    const v = searchParams.get('jobs') ?? ''
    return JOB_RANGE_OPTIONS.some((o) => o.value === v) ? v : ''
  })
  const [sort, setSort] = useState<SortKey>(() => {
    const v = searchParams.get('sort') as SortKey | null
    if (v && SORT_KEYS.includes(v)) return v
    return staleOnly ? 'last_job_date' : 'total_jobs'
  })
  const [asc, setAsc] = useState(() => {
    const v = searchParams.get('asc')
    return v !== null ? v === '1' : staleOnly
  })
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('page'))
    return Number.isFinite(p) && p > 0 ? p - 1 : 0
  })
  const [statusFor, setStatusFor] = useState<DriverDirectoryRow | null>(null)

  const dq = useDebounced(q)

  function clearStaleFilter() {
    setStaleOnly(false)
    setSort('total_jobs')
    setAsc(false)
  }

  // รีเซ็ตหน้าเฉพาะตอนตัวกรอง "เปลี่ยนจริง" เท่านั้น เทียบกับค่าที่จำไว้ล่าสุดแทนการใช้
  // flag "เมาท์ครั้งแรกหรือยัง" ตรง ๆ — เพราะ React StrictMode ตอนพัฒนายิง effect ซ้ำ
  // สองรอบตอนเมาท์ (mount -> cleanup -> mount) ถ้าใช้ flag ตัวเดียวที่ถูกสลับเป็น "เจอ
  // แล้ว" ตั้งแต่รอบแรก รอบที่สองซึ่งจำลองเมาท์ใหม่จะหลุดผ่านเงื่อนไขไปรีเซ็ตหน้าที่เพิ่ง
  // กู้คืนมาจาก URL (เช่น page=3 ตอนกดย้อนกลับ) ทันที ทั้งที่ผู้ใช้ไม่ได้เปลี่ยนอะไรเลย —
  // เทียบค่าแทนปลอดภัยไม่ว่า effect จะถูกยิงซ้ำกี่รอบ เพราะรีเซ็ตเฉพาะตอนค่าต่างจริง ๆ
  const prevFilters = useRef({ dq, status, jobRange, sort, asc, staleOnly })
  useEffect(() => {
    const prev = prevFilters.current
    const changed =
      prev.dq !== dq ||
      prev.status !== status ||
      prev.jobRange !== jobRange ||
      prev.sort !== sort ||
      prev.asc !== asc ||
      prev.staleOnly !== staleOnly
    prevFilters.current = { dq, status, jobRange, sort, asc, staleOnly }
    if (changed) setPage(0)
  }, [dq, status, jobRange, sort, asc, staleOnly])

  // ผูกตัวกรองทั้งหมดไว้กับ URL ทางเดียว (state -> URL เท่านั้น ไม่มีทางย้อนกลับ) ใช้
  // replace ไม่ใช่ push ทุกครั้ง ไม่งั้นพิมพ์คำค้นหนึ่งคำจะสร้าง history entry ใหม่ทุกตัวอักษร
  // กดย้อนกลับทีเดียวจะไม่ไปไหนเพราะติดอยู่ในประวัติการพิมพ์ของตัวเอง — ตัดค่าที่เป็นค่า
  // เริ่มต้นออกจาก URL ด้วย ไม่ให้ลิงก์รกเป็น /drivers?q=&status=active&jobs=&sort=... ทุกครั้ง
  useEffect(() => {
    setSearchParams(
      (sp) => {
        const next = new URLSearchParams(sp)
        const setOrDelete = (k: string, v: string, isDefault: boolean) => {
          if (isDefault) next.delete(k)
          else next.set(k, v)
        }
        setOrDelete('stale', '1', !staleOnly)
        setOrDelete('q', q, !q)
        setOrDelete('status', status, status === 'active')
        setOrDelete('jobs', jobRange, !jobRange)
        const defaultSort = staleOnly ? 'last_job_date' : 'total_jobs'
        setOrDelete('sort', sort, sort === defaultSort)
        setOrDelete('asc', asc ? '1' : '0', asc === staleOnly)
        setOrDelete('page', String(page + 1), page === 0)
        return next
      },
      { replace: true },
    )
  }, [staleOnly, q, status, jobRange, sort, asc, page, setSearchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ['drivers', dq, status, jobRange, sort, asc, page, staleOnly],
    queryFn: async () => {
      let query = supabase
        .from('driver_directory')
        .select('*', { count: 'exact' })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      const t = safeSearchTerm(dq)
      if (t) {
        query = query.or(`full_name.ilike.%${t}%,phone.ilike.%${t}%,driver_code.ilike.%${t}%`)
      }
      if (status) query = query.eq('status', status)
      const range = JOB_RANGE_OPTIONS.find((o) => o.value === jobRange)
      if (range?.min !== undefined) query = query.gte('total_jobs', range.min)
      if (range?.max !== undefined) query = query.lte('total_jobs', range.max)
      if (staleOnly) query = query.gt('total_jobs', 0).gt('days_since_last_job', 90)

      query = query.order(sort, { ascending: asc, nullsFirst: false })

      const { data, error, count } = await query
      if (error) throw error
      return { rows: (data ?? []) as DriverDirectoryRow[], count: count ?? 0 }
    },
  })

  const kpi = useQuery({
    queryKey: ['driver-kpis'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const dir = () =>
        supabase.from('driver_directory').select('id', { count: 'exact' }).limit(1)

      // เงื่อนไขต้องตรงกับค่าเริ่มต้นของหน้า /pending และตัวเลขบนเมนูเสมอ ไม่งั้น
      // ตัวเลขจะไม่ตรงกันข้ามหน้า — นับจากสถานะ active/probation ล้วน ๆ ไม่กรอง
      // ด้วยความเคลื่อนไหวล่าสุดอีกชั้น เพราะสถานะคือสิ่งที่คนตัดสินใจปิดเองอยู่แล้ว
      const [all, regular, recent, pending, scopeAll] = await Promise.all([
        dir().eq('status', 'active'),
        dir().eq('status', 'active').gte('total_jobs', 10),
        dir().eq('status', 'active').lte('days_since_last_job', 30),
        supabase.from('drivers_pending_review').select('id', { count: 'exact' }).limit(1),
        // ตัวหารของแถบความคืบหน้า ต้องเป็นกลุ่มเดียวกับตัวตั้ง (active/probation
        // ทั้งหมด ไม่ว่าประเมินไปแล้วหรือยัง) ไม่งั้นคนที่ "ยังไม่ประเมิน" จะถูกนับ
        // เป็นประเมินแล้วโดยอัตโนมัติ
        dir().in('status', ['active', 'probation']),
      ])

      return {
        all: all.count ?? 0,
        regular: regular.count ?? 0,
        recent: recent.count ?? 0,
        pending: pending.count ?? 0,
        scopeAll: scopeAll.count ?? 0,
      }
    },
  })

  // คำแนะนำตอนพิมพ์ค้นหา — ค้นที่ฐานข้อมูลแล้วเอามาแค่ 8 รายการ
  //
  // เดิมโหลดรายชื่อทั้งหมดสูงสุด 2,000 แถวมากรองในเครื่อง ซึ่งดึงข้อมูลหลักร้อย KB
  // ทุกครั้งที่เปิดหน้านี้ ทั้งที่ผู้ใช้เห็นแค่ 8 บรรทัด และจะพังเงียบ ๆ เมื่อ พขร.
  // เกิน 2,000 คน (คนที่ 2,001 เป็นต้นไปจะไม่ขึ้นในคำแนะนำเลยโดยไม่มีอะไรบอก)
  //
  // ไม่ผูกกับตัวกรองสถานะ/จำนวนเที่ยว เพราะเป็นทางลัดกระโดดไปหน้าโปรไฟล์ ไม่ใช่ผลลัพธ์ตาราง
  const suggestPool = useQuery({
    queryKey: ['driver-suggest', dq],
    enabled: safeSearchTerm(dq).length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const t = safeSearchTerm(dq)
      const { data, error } = await supabase
        .from('driver_directory')
        .select('id, full_name, phone, driver_code, status')
        .or(`full_name.ilike.%${t}%,phone.ilike.%${t}%,driver_code.ilike.%${t}%`)
        .order('total_jobs', { ascending: false, nullsFirst: false })
        .limit(8)
      if (error) throw error
      return (data ?? []) as DriverSuggestion[]
    },
  })

  const rows = data?.rows ?? []
  const total = data?.count ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (sort === key) setAsc(!asc)
    else {
      setSort(key)
      setAsc(key === 'full_name')
    }
  }

  function Th({ k, children, className }: { k: SortKey; children: string; className?: string }) {
    const on = sort === k
    return (
      <th
        className={`sortable${className ? ` ${className}` : ''}`}
        aria-sort={on ? (asc ? 'ascending' : 'descending') : undefined}
        onClick={() => toggleSort(k)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            toggleSort(k)
          }
        }}
      >
        {children}
        <span className="arrow" aria-hidden="true">
          {on ? (asc ? '▲' : '▼') : '▼'}
        </span>
      </th>
    )
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>รายชื่อ พขร.</h1>
          <p>ภาพรวมคะแนนและสถานะของ พขร. ทุกคนในระบบ</p>
        </div>
      </div>

      <ReadinessPanel
        total={kpi.data?.all}
        regular={kpi.data?.regular}
        recent={kpi.data?.recent}
        pending={kpi.data?.pending}
        scopeAll={kpi.data?.scopeAll}
        loading={kpi.isLoading}
      />

      {/* ---------------------------------------------- ตัวกรอง */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="filters-row">
          <div style={{ flex: '2 1 260px' }}>
            <label htmlFor="q">ค้นหา</label>
            <DriverSearchField value={q} onChange={setQ} suggestions={suggestPool.data ?? []} />
          </div>
          <div style={{ flex: '1 1 130px' }}>
            <label htmlFor="st">สถานะ</label>
            <Combobox
              id="st"
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS.filter((o) => o.value !== '')}
              placeholder="ทั้งหมด"
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label htmlFor="mj">จำนวนเที่ยววิ่งขั้นต่ำ</label>
            <Combobox
              id="mj"
              value={jobRange}
              onChange={setJobRange}
              options={JOB_RANGE_OPTIONS.filter((o) => o.value !== '')}
              placeholder="ไม่มีกำหนด"
            />
          </div>
        </div>
        {staleOnly && (
          <p className="hint" style={{ marginTop: 10 }}>
            กำลังกรอง: สถานะ active ที่เคยวิ่งงานจริงมาก่อน แต่ไม่มีความเคลื่อนไหวเกิน 90 วันแล้ว
            เรียงคนที่เงียบหายนานสุดขึ้นก่อน{' '}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ verticalAlign: 'baseline', padding: '2px 10px' }}
              onClick={clearStaleFilter}
            >
              ล้างตัวกรอง
            </button>
          </p>
        )}
      </div>

      {error && <div className="note-box err">โหลดข้อมูลไม่สำเร็จ: {(error as Error).message}</div>}

      <div className="tablewrap drivers-table">
        <table>
          <thead>
            <tr>
              <Th k="full_name">พขร.</Th>
              <th>เบอร์โทร</th>
              <Th k="total_jobs">เที่ยววิ่งสะสม</Th>
              <Th k="adjusted_score" className="col-score">
                คะแนนประเมิน
              </Th>
              <Th k="last_job_date">งานล่าสุด</Th>
              <th className="col-action">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <SkeletonRows
                rows={8}
                columns={[
                  { width: '70%' }, // พขร. — ชิดซ้าย คอลัมน์เดียวที่ไม่กึ่งกลาง
                  { width: '50%', align: 'center' }, // เบอร์โทร
                  { width: '50%', align: 'center' }, // เที่ยววิ่งสะสม
                  { width: '50%' }, // คะแนนประเมิน (.col-score ชิดซ้ายเหมือนกัน — ดู index.css)
                  { width: '50%', align: 'center' }, // งานล่าสุด
                  { width: '50%', align: 'center' }, // สถานะ
                ]}
              />
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconUsers size={22} />
                    </span>
                    <b>ไม่พบ พขร. ที่ตรงกับเงื่อนไข</b>
                    {dq
                      ? `ไม่มีใครชื่อ เบอร์ หรือรหัสตรงกับ “${dq}”`
                      : 'ลองผ่อนตัวกรองสถานะหรือจำนวนเที่ยววิ่งขั้นต่ำ'}
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setQ('')
                          setStatus('')
                          setJobRange('')
                        }}
                      >
                        ล้างตัวกรองทั้งหมด
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              rows.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/drivers/${d.id}`} style={{ fontWeight: 500 }}>
                      {d.full_name}
                    </Link>
                  </td>
                  <td className="mono nowrap">{fmtPhone(d.phone)}</td>
                  <td className="num">{fmtNum(d.total_jobs)}</td>
                  <td className="col-score">
                    <ScoreCell score={d.adjusted_score} count={d.rating_count} />
                  </td>
                  <td className="nowrap muted" style={{ fontSize: 13 }}>
                    {fmtSince(d.days_since_last_job)}
                  </td>
                  <td className="col-action">
                    {can('admin', 'hr', 'ops') ? (
                      <button
                        type="button"
                        className={`badge badge-btn ${
                          d.status === 'active' ? 'ok' : d.status === 'blacklisted' ? 'bad' : 'warn'
                        }`}
                        onClick={() => setStatusFor(d)}
                        title="เปลี่ยนสถานะการรับงาน"
                      >
                        {STATUS_LABEL[d.status] ?? d.status}
                      </button>
                    ) : (
                      <span
                        className={`badge ${
                          d.status === 'active' ? 'ok' : d.status === 'blacklisted' ? 'bad' : 'warn'
                        }`}
                      >
                        {STATUS_LABEL[d.status] ?? d.status}
                      </span>
                    )}
                    {/* พักงานแบบมีกำหนดเวลา (ฟีเจอร์ 30/60/90 วัน) — ไม่กำหนดเวลาจะไม่มี
                        status_until เลยไม่มีบรรทัดนี้ เหมือนพฤติกรรมเดิมทุกอย่าง */}
                    {d.status === 'inactive' && d.status_until && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                        {suspensionRemainingLabel(d.status_until)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 13 }}>
          พบ {fmtNum(total)} คน
          {pages > 1 && ` · หน้า ${page + 1} จาก ${pages}`}
        </span>
        {pages > 1 && (
          <div className="row">
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              ก่อนหน้า
            </button>
            <button
              className="btn btn-sm"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              ถัดไป
            </button>
          </div>
        )}
      </div>

      {statusFor && (
        <StatusDialog
          driverId={statusFor.id}
          driverName={statusFor.full_name}
          current={statusFor.status}
          currentReason={statusFor.status_reason}
          currentStatusUntil={statusFor.status_until}
          onClose={() => setStatusFor(null)}
        />
      )}
    </main>
  )
}
