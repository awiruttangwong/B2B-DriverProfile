import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { DriverDirectoryRow } from '../types/database'
import { fmtCostTotal, fmtNum, fmtPhone, fmtSince, STATUS_LABEL } from '../lib/format'
import ScoreCell from '../components/ScoreCell'
import ReadinessPanel from '../components/ReadinessPanel'
import { IconSearch, IconUsers } from '../components/icons'

type SortKey = 'total_jobs' | 'customer_count' | 'adjusted_score' | 'last_job_date' | 'full_name'

const PAGE_SIZE = 50

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
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('active')
  const [minJobs, setMinJobs] = useState(0)
  const [sort, setSort] = useState<SortKey>('total_jobs')
  const [asc, setAsc] = useState(false)
  const [page, setPage] = useState(0)

  const dq = useDebounced(q)

  useEffect(() => {
    setPage(0)
  }, [dq, status, minJobs, sort, asc])

  const { data, isLoading, error } = useQuery({
    queryKey: ['drivers', dq, status, minJobs, sort, asc, page],
    queryFn: async () => {
      let query = supabase
        .from('driver_directory')
        .select('*', { count: 'exact' })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (dq.trim()) {
        const t = dq.trim()
        query = query.or(`full_name.ilike.%${t}%,phone.ilike.%${t}%,driver_code.ilike.%${t}%`)
      }
      if (status) query = query.eq('status', status)
      if (minJobs > 0) query = query.gte('total_jobs', minJobs)

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

      const [all, regular, recent, pending, jobs] = await Promise.all([
        dir().eq('status', 'active'),
        dir().eq('status', 'active').gte('total_jobs', 10),
        dir().eq('status', 'active').lte('days_since_last_job', 30),
        supabase.from('pending_ratings').select('assignment_id', { count: 'exact' }).limit(1),
        supabase.from('driver_job_history').select('assignment_id', { count: 'exact' }).limit(1),
      ])

      return {
        all: all.count ?? 0,
        regular: regular.count ?? 0,
        recent: recent.count ?? 0,
        pending: pending.count ?? 0,
        totalJobs: jobs.count ?? 0,
      }
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

  function Th({ k, children, right }: { k: SortKey; children: string; right?: boolean }) {
    const on = sort === k
    return (
      <th
        className={`sortable${right ? ' right' : ''}`}
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
          <p>
            คะแนนที่แสดงเป็นคะแนนปรับแล้ว ถ่วงน้ำหนักตามจำนวนรีวิวและความสดของข้อมูล
            ไม่ใช่ค่าเฉลี่ยดิบ — กดหัวคอลัมน์เพื่อเรียงลำดับ
          </p>
        </div>
      </div>

      <ReadinessPanel
        total={kpi.data?.all}
        regular={kpi.data?.regular}
        recent={kpi.data?.recent}
        totalJobs={kpi.data?.totalJobs}
        pending={kpi.data?.pending}
        loading={kpi.isLoading}
      />

      {/* ---------------------------------------------- ตัวกรอง */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '2 1 260px' }}>
            <label htmlFor="q">ค้นหา</label>
            <div style={{ position: 'relative' }}>
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
                type="search"
                placeholder="ชื่อ พขร. / เบอร์โทร / DRV-00123"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ paddingLeft: 34 }}
              />
            </div>
          </div>
          <div style={{ flex: '1 1 130px' }}>
            <label htmlFor="st">สถานะ</label>
            <select id="st" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">ทั้งหมด</option>
              <option value="active">ใช้งาน</option>
              <option value="probation">ทดลองงาน</option>
              <option value="inactive">พักงาน</option>
              <option value="blacklisted">ห้ามใช้งาน</option>
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label htmlFor="mj">จำนวนเที่ยวขั้นต่ำ</label>
            <select id="mj" value={minJobs} onChange={(e) => setMinJobs(Number(e.target.value))}>
              <option value={0}>ไม่กำหนด</option>
              <option value={3}>ตั้งแต่ 3 เที่ยว</option>
              <option value={10}>ตั้งแต่ 10 เที่ยว</option>
              <option value={30}>ตั้งแต่ 30 เที่ยว</option>
            </select>
          </div>
        </div>
        {minJobs === 0 && !dq && (
          <p className="hint" style={{ marginTop: 10 }}>
            พขร. กว่าครึ่งในข้อมูลชุดแรกวิ่งเพียงเที่ยวเดียว
            กรองด้วยจำนวนเที่ยวขั้นต่ำเพื่อดูเฉพาะคนที่วิ่งประจำ
          </p>
        )}
      </div>

      {error && <div className="note-box err">โหลดข้อมูลไม่สำเร็จ: {(error as Error).message}</div>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <Th k="full_name">พขร.</Th>
              <th>เบอร์โทร</th>
              <Th k="total_jobs" right>
                เที่ยว
              </Th>
              <Th k="customer_count" right>
                ลูกค้า
              </Th>
              <Th k="adjusted_score">คะแนน</Th>
              <th className="right">ค่าจ้างสะสม</th>
              <Th k="last_job_date">งานล่าสุด</Th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j}>
                      <div className="sk" style={{ width: j === 0 ? '70%' : '50%' }} />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconUsers size={22} />
                    </span>
                    <b>ไม่พบ พขร. ที่ตรงกับเงื่อนไข</b>
                    {dq
                      ? `ไม่มีใครชื่อ เบอร์ หรือรหัสตรงกับ “${dq}”`
                      : 'ลองผ่อนตัวกรองสถานะหรือจำนวนเที่ยวขั้นต่ำ'}
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setQ('')
                          setStatus('')
                          setMinJobs(0)
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
                    <div className="mono muted" style={{ fontSize: 11.5 }}>
                      {d.driver_code}
                    </div>
                  </td>
                  <td className="mono nowrap">{fmtPhone(d.phone)}</td>
                  <td className="right num">{fmtNum(d.total_jobs)}</td>
                  <td className="right num">{fmtNum(d.customer_count)}</td>
                  <td>
                    <ScoreCell score={d.adjusted_score} count={d.rating_count} />
                  </td>
                  <td className="right num">{fmtCostTotal(d.total_cost, d.total_jobs)}</td>
                  <td className="nowrap muted" style={{ fontSize: 13 }}>
                    {fmtSince(d.days_since_last_job)}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        d.status === 'active' ? 'ok' : d.status === 'blacklisted' ? 'bad' : 'warn'
                      }`}
                    >
                      {STATUS_LABEL[d.status] ?? d.status}
                    </span>
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
    </main>
  )
}
