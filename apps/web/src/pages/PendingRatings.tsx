import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverDirectoryRow, DriverPendingReviewRow } from '../types/database'
import { fmtDateShort, fmtNum, fmtPhone, fmtScore, safeSearchTerm } from '../lib/format'
import RatingDialog from '../components/RatingDialog'

const PAGE = 40

interface TargetDriver {
  id: string
  full_name: string
}

export default function PendingRatings() {
  const { can } = useAuth()
  const [page, setPage] = useState(0)
  const [target, setTarget] = useState<TargetDriver | null>(null)
  const [q, setQ] = useState('')
  // ค่าเริ่มต้นโชว์เฉพาะคนที่มีผลต่องานจริง — พขร. ที่ยังไม่เคยประเมินมี 1,290 คน
  // แต่ 721 คน (56%) วิ่งแค่เที่ยวเดียวตลอดกาล ถ้าไล่ให้ครบทุกคนก็กลับไปเป็น
  // คิวที่ไม่มีวันหมดเหมือนตอนให้คะแนนรายเที่ยว
  const [onlyPriority, setOnlyPriority] = useState(true)

  const { data, isLoading, error } = useQuery({
    queryKey: ['pending', page, onlyPriority],
    queryFn: async () => {
      let query = supabase
        .from('drivers_pending_review')
        .select('*', { count: 'exact' })
        .order('total_jobs', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1)

      if (onlyPriority) query = query.eq('is_priority', true)

      const { data, error, count } = await query
      if (error) throw error
      return { rows: (data ?? []) as DriverPendingReviewRow[], count: count ?? 0 }
    },
  })

  const pages = Math.ceil((data?.count ?? 0) / PAGE)

  // ค้นหาคนขับคนไหนก็ได้เพื่อประเมิน (ใช้ตอนต้องการประเมินซ้ำคนที่เคยประเมินไปแล้ว)
  const term = safeSearchTerm(q)
  const search = useQuery({
    queryKey: ['pending-search', term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_directory')
        .select('id, driver_code, full_name, phone, rating_count, adjusted_score')
        .or(`full_name.ilike.%${term}%,driver_code.ilike.%${term}%,phone.ilike.%${term}%`)
        .limit(8)
      if (error) throw error
      return (data ?? []) as DriverDirectoryRow[]
    },
  })

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>พขร. ที่รอประเมิน</h1>
          <p>
            ประเมินเป็นรายคน ครอบคลุมภาพรวมการทำงานทั้งหมด ไม่ใช่ทีละเที่ยว — ถ้าคนขับไม่เหมาะกับงาน
            บางประเภท ให้บันทึกไว้ในช่องเหตุผลตอนประเมิน
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <label htmlFor="dsearch">ค้นหาคนขับเพื่อประเมิน (ประเมินซ้ำคนที่เคยประเมินแล้วได้)</label>
        <input
          id="dsearch"
          type="search"
          autoComplete="off"
          placeholder="ชื่อ, รหัส พขร. หรือเบอร์โทร — พิมพ์อย่างน้อย 2 ตัวอักษร"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {term.length >= 2 && (
          <div className="tablewrap" style={{ marginTop: 10, border: 0, borderRadius: 0 }}>
            {search.isLoading && (
              <div className="empty" style={{ padding: 12 }}>
                <span className="spinner" /> กำลังค้นหา…
              </div>
            )}
            {!search.isLoading && (search.data?.length ?? 0) === 0 && (
              <div className="empty" style={{ padding: 12 }}>
                ไม่พบคนขับที่ตรงกับคำค้นนี้
              </div>
            )}
            {(search.data ?? []).map((d) => (
              <div
                key={d.id}
                className="row"
                style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)' }}
              >
                <div>
                  <Link to={`/drivers/${d.id}`} style={{ fontWeight: 500 }}>
                    {d.full_name}
                  </Link>{' '}
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {d.driver_code} · {fmtPhone(d.phone)}
                  </span>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {d.rating_count && d.rating_count > 0
                      ? `เคยประเมินแล้ว · ${fmtScore(d.adjusted_score)}`
                      : 'ยังไม่เคยประเมิน'}
                  </span>
                  {can('admin', 'ops', 'hr') && (
                    <button
                      className="btn btn-sm"
                      onClick={() => setTarget({ id: d.id, full_name: d.full_name })}
                    >
                      {d.rating_count && d.rating_count > 0 ? 'ประเมินใหม่' : 'ประเมิน'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="note-box err">โหลดข้อมูลไม่สำเร็จ: {(error as Error).message}</div>}

      <div
        className="row"
        style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}
      >
        {data && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {onlyPriority ? 'ควรประเมินก่อน' : 'ยังไม่เคยประเมินทั้งหมด'} {fmtNum(data.count)} คน
            {pages > 1 && ` · หน้า ${page + 1} จาก ${fmtNum(pages)}`}
          </p>
        )}
        <button
          className="btn btn-sm"
          onClick={() => {
            setOnlyPriority(!onlyPriority)
            setPage(0)
          }}
        >
          {onlyPriority ? 'ดูทั้งหมดรวมคนที่วิ่งไม่กี่เที่ยว' : 'ดูเฉพาะคนที่ควรประเมินก่อน'}
        </button>
      </div>

      {onlyPriority && (
        <p className="hint" style={{ marginTop: 0 }}>
          แสดงเฉพาะคนที่วิ่งตั้งแต่ 10 เที่ยวขึ้นไป หรือยังวิ่งงานอยู่ใน 90 วันล่าสุด —
          คนที่วิ่งไม่กี่เที่ยวแล้วหายไปนานไม่ได้ถูกลบ แค่ไม่ถูกนับเป็นงานค้าง
        </p>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>พขร.</th>
              <th>เบอร์โทร</th>
              <th className="right">เที่ยววิ่งสะสม</th>
              <th>งานล่าสุด</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="empty">
                  <span className="spinner" /> กำลังโหลด…
                </td>
              </tr>
            )}
            {!isLoading && (data?.rows.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  ไม่มีคนขับที่รอประเมิน
                </td>
              </tr>
            )}
            {(data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/drivers/${r.id}`}>{r.full_name}</Link>
                  <div className="mono muted" style={{ fontSize: 11 }}>
                    {r.driver_code}
                  </div>
                </td>
                <td className="mono nowrap">{fmtPhone(r.phone)}</td>
                <td className="right num">{fmtNum(r.total_jobs)}</td>
                <td className="nowrap mono" style={{ fontSize: 12 }}>
                  {fmtDateShort(r.last_job_date)}
                </td>
                <td className="nowrap right">
                  {can('admin', 'ops', 'hr') ? (
                    <button
                      className="btn btn-sm"
                      onClick={() => setTarget({ id: r.id, full_name: r.full_name })}
                    >
                      ประเมิน
                    </button>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      ไม่มีสิทธิ์
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
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

      {target && (
        <RatingDialog
          driverId={target.id}
          driverName={target.full_name}
          onClose={() => setTarget(null)}
        />
      )}
    </main>
  )
}
