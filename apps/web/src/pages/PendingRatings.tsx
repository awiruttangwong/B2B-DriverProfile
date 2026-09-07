import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { PendingRatingRow } from '../types/database'
import { fmtDate, fmtNum, fmtPhone, localISODate } from '../lib/format'
import RatingDialog from '../components/RatingDialog'

const PAGE = 40

export default function PendingRatings() {
  const { can } = useAuth()
  const [days, setDays] = useState(30)
  const [target, setTarget] = useState<PendingRatingRow | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['pending', days],
    queryFn: async () => {
      const since = new Date()
      since.setDate(since.getDate() - days)
      const sinceIso = localISODate(since)

      const { data, error, count } = await supabase
        .from('pending_ratings')
        .select('*', { count: 'exact' })
        .gte('job_date', sinceIso)
        .order('job_date', { ascending: false })
        .limit(PAGE)

      if (error) throw error
      return { rows: (data ?? []) as PendingRatingRow[], count: count ?? 0 }
    },
  })

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>งานที่รอให้คะแนน</h1>
          <p>
            งานที่จบแล้วแต่ยังไม่มีใครให้คะแนน — ถ้าไม่มีใครกลับมาให้คะแนน ระบบทั้งระบบก็ไม่มีข้อมูล
            จึงควรเคลียร์รายการนี้ให้ว่างอยู่เสมอ
          </p>
        </div>
        <div style={{ minWidth: 170 }}>
          <label htmlFor="dr">ช่วงเวลา</label>
          <select id="dr" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 วันล่าสุด</option>
            <option value={30}>30 วันล่าสุด</option>
            <option value={90}>90 วันล่าสุด</option>
            <option value={3650}>ทั้งหมด</option>
          </select>
        </div>
      </div>

      {error && <div className="note-box err">โหลดข้อมูลไม่สำเร็จ: {(error as Error).message}</div>}

      {data && (
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          ค้างอยู่ {fmtNum(data.count)} งาน
          {data.count > PAGE && ` · แสดง ${PAGE} งานล่าสุด`}
        </p>
      )}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>วันที่</th>
              <th>พขร.</th>
              <th>เบอร์โทร</th>
              <th>ลูกค้า</th>
              <th>เส้นทาง</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="empty">
                  <span className="spinner" /> กำลังโหลด…
                </td>
              </tr>
            )}
            {!isLoading && (data?.rows.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  ไม่มีงานค้างในช่วงนี้
                </td>
              </tr>
            )}
            {(data?.rows ?? []).map((r) => (
              <tr key={r.assignment_id}>
                <td className="nowrap mono" style={{ fontSize: 12 }}>
                  {fmtDate(r.job_date)}
                </td>
                <td>
                  <Link to={`/drivers/${r.driver_id}`}>{r.driver_name}</Link>
                </td>
                <td className="mono nowrap">{fmtPhone(r.driver_phone)}</td>
                <td>
                  <span className="badge">{r.customer_code ?? '—'}</span>
                </td>
                <td style={{ fontSize: 13, minWidth: 200 }}>{r.route_raw ?? '—'}</td>
                <td className="nowrap right">
                  {can('admin', 'ops', 'hr') ? (
                    <button className="btn btn-sm" onClick={() => setTarget(r)}>
                      ให้คะแนน
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

      {target && (
        <RatingDialog
          driverId={target.driver_id}
          driverName={target.driver_name}
          assignmentId={target.assignment_id}
          jobLabel={`${fmtDate(target.job_date)} · ${target.customer_code ?? ''} · ${
            target.route_raw ?? ''
          }`}
          onClose={() => setTarget(null)}
        />
      )}
    </main>
  )
}
