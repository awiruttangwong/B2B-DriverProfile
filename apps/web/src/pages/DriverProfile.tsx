import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type {
  CustomerPerfRow,
  DriverDirectoryRow,
  DriverStatus,
  DriverStatusLogRow,
  DriverReviewRow,
  JobHistoryRow,
} from '../types/database'
import {
  fmtDate,
  fmtDateShort,
  fmtNum,
  fmtPhone,
  fmtScore,
  fmtSince,
  OUTCOME_LABEL,
  STATUS_LABEL,
} from '../lib/format'
import { IconArrowLeft, IconEdit } from '../components/icons'
import StatusDialog, { BLOCKING } from '../components/StatusDialog'

interface CriteriaAvg {
  code: string
  label: string
  weight: number
  avg: number
  n: number
}

export default function DriverProfile() {
  const { id = '' } = useParams()
  const { can } = useAuth()
  const [historyLimit, setHistoryLimit] = useState(25)
  const [statusOpen, setStatusOpen] = useState<{ initialNext?: DriverStatus } | null>(null)

  const driver = useQuery({
    queryKey: ['driver', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_directory')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as DriverDirectoryRow | null
    },
    enabled: !!id,
  })

  const history = useQuery({
    queryKey: ['driver', id, 'history', historyLimit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_job_history')
        .select('*')
        .eq('driver_id', id)
        .order('job_date', { ascending: false })
        .limit(historyLimit)
      if (error) throw error
      return (data ?? []) as JobHistoryRow[]
    },
    enabled: !!id,
  })

  const perf = useQuery({
    queryKey: ['driver', id, 'perf'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_customer_perf')
        .select('*')
        .eq('driver_id', id)
        .order('jobs', { ascending: false })
      if (error) throw error
      return (data ?? []) as CustomerPerfRow[]
    },
    enabled: !!id,
  })

  const statusLog = useQuery({
    queryKey: ['driver', id, 'statuslog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_status_log')
        .select('*')
        .eq('driver_id', id)
        .order('changed_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data ?? []) as DriverStatusLogRow[]
    },
    enabled: !!id,
  })

  /**
   * ใบประเมินของคนนี้ — ต้องอ่านจาก driver_ratings ตรง ๆ ไม่ใช่จาก driver_job_history
   * เพราะ view นั้น join คะแนนด้วย assignment_id ซึ่งใบประเมินภาพรวมเป็น null เสมอ
   * ถ้าอ่านจากที่นั่นเหตุผลที่ผู้ประเมินเขียนไว้จะไม่ขึ้นบนหน้าจอเลยสักใบ
   */
  const reviews = useQuery({
    queryKey: ['driver', id, 'reviews'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_ratings')
        .select(
          'id, overall_score, reason, tags, assign_again, created_at, assignment_id, rater:profiles!driver_ratings_rater_id_fkey(full_name)',
        )
        .eq('driver_id', id)
        .is('voided_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DriverReviewRow[]
    },
    enabled: !!id,
  })

  const criteria = useQuery({
    queryKey: ['driver', id, 'criteria'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rating_scores')
        .select(
          'score, rating_criteria!inner(code,label_th,weight,display_order), driver_ratings!inner(driver_id,voided_at)',
        )
        .eq('driver_ratings.driver_id', id)
        .is('driver_ratings.voided_at', null)
      if (error) throw error
      return (data ?? []) as unknown as Array<{
        score: number
        rating_criteria: { code: string; label_th: string; weight: number; display_order: number }
      }>
    },
    enabled: !!id,
  })

  const criteriaAvgs = useMemo<CriteriaAvg[]>(() => {
    const rows = criteria.data ?? []
    const acc = new Map<string, { label: string; weight: number; order: number; sum: number; n: number }>()
    for (const r of rows) {
      const c = r.rating_criteria
      if (!c) continue
      const cur = acc.get(c.code) ?? {
        label: c.label_th,
        weight: Number(c.weight),
        order: c.display_order,
        sum: 0,
        n: 0,
      }
      cur.sum += r.score
      cur.n += 1
      acc.set(c.code, cur)
    }
    return [...acc.entries()]
      .map(([code, v]) => ({
        code,
        label: v.label,
        weight: v.weight,
        avg: v.sum / v.n,
        n: v.n,
      }))
      .sort((a, b) => b.weight - a.weight)
  }, [criteria.data])

  const lastReviewAt = reviews.data?.[0]?.created_at ?? null

  if (driver.isLoading) {
    return (
      <main className="page">
        <div className="empty">
          <span className="spinner" /> กำลังโหลด…
        </div>
      </main>
    )
  }

  const d = driver.data
  if (!d) {
    return (
      <main className="page">
        <div className="note-box err">ไม่พบ พขร. รายนี้</div>
        <Link to="/drivers" className="back-link" style={{ marginTop: 14 }}>
          <IconArrowLeft size={15} />
          กลับไปรายชื่อ
        </Link>
      </main>
    )
  }

  return (
    <main className="page">
      <Link to="/drivers" className="back-link">
        <IconArrowLeft size={15} />
        รายชื่อ พขร.
      </Link>

      {/* ------------------------------------------------ หัวโปรไฟล์ */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 22 }}>{d.full_name}</h1>
            <div className="mono muted" style={{ fontSize: 12.5 }}>
              {d.driver_code} · {fmtPhone(d.phone)}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <span
                className={`badge ${
                  d.status === 'active' ? 'ok' : d.status === 'blacklisted' ? 'bad' : 'warn'
                }`}
              >
                {STATUS_LABEL[d.status] ?? d.status}
              </span>
              {can('admin', 'hr', 'ops') && (
                <button
                  className="btn btn-sm"
                  onClick={() => setStatusOpen({})}
                  title="เปลี่ยนสถานะการรับงานของ พขร. คนนี้"
                >
                  <IconEdit size={14} />
                  เปลี่ยนสถานะ
                </button>
              )}
              {(d.recent_problem_jobs ?? 0) > 0 && (
                <span className="badge bad">
                  มีเหตุ {d.recent_problem_jobs} ครั้งใน 12 เดือน
                </span>
              )}
            </div>

            {BLOCKING.includes(d.status) && (
              <div className="note-box warn" style={{ marginTop: 10, maxWidth: 62 + 'ch' }}>
                <strong>ไม่ขึ้นในหน้าหาคนสำหรับงาน</strong>
                {d.status_reason ? ` — ${d.status_reason}` : ''}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'right' }}>
            {d.rating_count && d.rating_count > 0 ? (
              <>
                <div className="score score-xl">
                  {fmtScore(d.adjusted_score)}
                  <small> / 5</small>
                </div>
                <div className="muted mono" style={{ fontSize: 11.5, marginTop: 5 }}>
                  จากการประเมิน {d.rating_count} ครั้ง
                  {lastReviewAt && (
                    <>
                      <br />
                      ล่าสุด {fmtDate(lastReviewAt)}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'right' }}>
                <div className="score-none" style={{ fontSize: 15 }}>
                  ยังไม่มีคะแนน
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  ประเมินได้ที่หน้า <Link to="/pending">รอประเมิน</Link>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="stats stats-3">
          <div className="stat">
            <div className="v num">{fmtNum(d.total_jobs)}</div>
            <div className="l">เที่ยววิ่งสะสม</div>
          </div>
          <div className="stat">
            <div className="v num">{fmtNum(d.customer_count)}</div>
            <div className="l">ลูกค้าที่เคยวิ่งให้</div>
          </div>
          <div className="stat">
            <div className="v" style={{ fontSize: 16 }}>
              {fmtSince(d.days_since_last_job)}
            </div>
            <div className="l">งานล่าสุด · {fmtDateShort(d.last_job_date)}</div>
          </div>
        </div>

        {criteriaAvgs.length > 0 && (
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {criteriaAvgs.map((c) => (
              <div
                key={c.code}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(110px,1.1fr) minmax(0,3fr) 44px',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: 13.5 }}>{c.label}</span>{' '}
                  <span className="mono muted" style={{ fontSize: 10.5 }}>
                    {Math.round(c.weight * 100)}%
                  </span>
                </div>
                <div className="bar">
                  <i
                    className={c.avg < 3.5 ? 'low' : ''}
                    style={{ width: `${(c.avg / 5) * 100}%` }}
                  />
                </div>
                <div className="mono num" style={{ textAlign: 'right', fontSize: 12.5 }}>
                  {c.avg.toFixed(1)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="split">
        {/* ------------------------------------------------ ประวัติงาน */}
        <div>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h2>ประวัติงาน</h2>
              <span className="muted" style={{ fontSize: 13 }}>
                แสดง {history.data?.length ?? 0} จาก {fmtNum(d.total_jobs)} เที่ยว
              </span>
            </div>
            <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ลูกค้า</th>
                    <th>เส้นทาง</th>
                    <th>ประเภทรถ</th>
                  </tr>
                </thead>
                <tbody>
                  {history.isLoading && (
                    <tr>
                      <td colSpan={4} className="empty">
                        <span className="spinner" /> กำลังโหลด…
                      </td>
                    </tr>
                  )}
                  {!history.isLoading && (history.data?.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={4} className="empty">
                        ยังไม่มีประวัติงาน
                      </td>
                    </tr>
                  )}
                  {(history.data ?? []).map((h) => (
                    <tr key={h.assignment_id}>
                      <td className="nowrap mono" style={{ fontSize: 12 }}>
                        {fmtDateShort(h.job_date)}
                      </td>
                      <td className="nowrap">
                        <span className="badge">{h.customer_code ?? '—'}</span>
                      </td>
                      <td style={{ minWidth: 200, fontSize: 13 }}>
                        {h.route_raw ?? '—'}
                        {h.outcome !== 'completed' && (
                          <span className="badge bad" style={{ marginLeft: 6 }}>
                            {OUTCOME_LABEL[h.outcome] ?? h.outcome}
                          </span>
                        )}
                      </td>
                      <td className="nowrap mono" style={{ fontSize: 11.5 }}>
                        {h.vehicle_type_code ?? '—'}
                        {h.plate && (
                          <div className="muted" style={{ fontSize: 10.5 }}>
                            {h.plate}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(d.total_jobs ?? 0) > historyLimit && (
              <div className="card-pad" style={{ textAlign: 'center', paddingTop: 12 }}>
                <button className="btn btn-sm" onClick={() => setHistoryLimit(historyLimit + 50)}>
                  โหลดเพิ่ม 50 เที่ยว
                </button>
              </div>
            )}
          </div>

          {/* ------------------------------------------ รีวิวพร้อมเหตุผล */}
          <div className="card">
            <div className="card-head">
              <h2>เหตุผลที่ได้คะแนนแบบนี้</h2>
            </div>
            {(reviews.data?.length ?? 0) === 0 ? (
              <div className="empty">
                ยังไม่เคยมีใครประเมิน พขร. คนนี้
                <br />
                <span style={{ fontSize: 13 }}>
                  คะแนนจะมีความหมายก็ต่อเมื่อมีเหตุผลกำกับ — ประเมินได้ที่หน้า{' '}
                  <Link to="/pending">รอประเมิน</Link>
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {(reviews.data ?? []).map((r) => (
                  <div
                    key={r.id}
                    className="card-pad"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <div className="row" style={{ gap: 10, marginBottom: 4 }}>
                      <span className="num" style={{ fontWeight: 600, color: 'var(--accent)' }}>
                        {fmtScore(r.overall_score)}
                      </span>
                      <span className="mono muted" style={{ fontSize: 12 }}>
                        {fmtDate(r.created_at)}
                        {r.rater?.full_name ? ` · ${r.rater.full_name}` : ''}
                      </span>
                      {r.assign_again !== null && (
                        <span className={`badge ${r.assign_again ? 'ok' : 'bad'}`}>
                          {r.assign_again ? 'ให้งานอีก' : 'ไม่ให้งานแล้ว'}
                        </span>
                      )}
                    </div>
                    <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--ink-2)' }}>
                      {r.reason}
                    </p>
                    {r.tags && r.tags.length > 0 && (
                      <div className="row" style={{ gap: 5 }}>
                        {r.tags.map((t) => (
                          <span key={t} className="tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ คอลัมน์ขวา */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="card">
          <div className="card-head">
            <h2>ผลดำเนินงานแยกตามรายลูกค้า</h2>
          </div>
          {(perf.data?.length ?? 0) === 0 ? (
            <div className="empty">ยังไม่มีข้อมูล</div>
          ) : (
            <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="table-compact table-center">
                <thead>
                  <tr>
                    <th>ลูกค้า</th>
                    <th>จำนวนเที่ยวที่วิ่งกับลูกค้า</th>
                    <th>วิ่งงานล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {(perf.data ?? []).map((p) => (
                    <tr key={p.customer_id}>
                      <td>
                        <span className="badge">{p.customer_code}</span>
                      </td>
                      <td className="num">{p.jobs}</td>
                      <td className="nowrap mono" style={{ fontSize: 11.5 }}>
                        {fmtDateShort(p.last_job_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-pad">
            <p className="hint" style={{ margin: 0 }}>
              ตารางนี้คือคำตอบของ “คนไหนเหมาะกับงานไหน” — จำนวนเที่ยวบอกความคุ้นเคยกับลูกค้ารายนี้
              ส่วนคะแนนคุณภาพเป็นการประเมินภาพรวมทั้งคน ดูได้ที่ด้านบนของหน้า
            </p>
          </div>
        </div>

        {/* -------------------------------------- ประวัติการเปลี่ยนสถานะ */}
        {(statusLog.data?.length ?? 0) > 0 && (
          <div className="card">
            <div className="card-head">
              <h2>ประวัติการเปลี่ยนสถานะ</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(statusLog.data ?? []).map((h, i) => (
                <div
                  key={h.id}
                  className="card-pad"
                  style={{ borderBottom: '1px solid var(--line)', paddingTop: 13, paddingBottom: 13 }}
                >
                  <div className="row" style={{ gap: 7, justifyContent: 'space-between' }}>
                    <div className="row" style={{ gap: 7 }}>
                      {h.from_status && (
                        <>
                          <span className="badge">{STATUS_LABEL[h.from_status] ?? h.from_status}</span>
                          <span className="muted" aria-hidden="true">
                            →
                          </span>
                        </>
                      )}
                      <span
                        className={`badge ${
                          h.to_status === 'active'
                            ? 'ok'
                            : h.to_status === 'blacklisted'
                              ? 'bad'
                              : 'warn'
                        }`}
                      >
                        {STATUS_LABEL[h.to_status] ?? h.to_status}
                      </span>
                    </div>
                    {/* ย้อนกลับได้เฉพาะรายการล่าสุด — ไม่แก้/ลบประวัติเดิม แค่เปลี่ยนสถานะ
                        กลับแล้วบันทึกเป็นรายการใหม่ต่อท้าย ร่องรอยเดิมยังอยู่ครบ */}
                    {i === 0 && h.from_status && d.status === h.to_status && can('admin', 'hr', 'ops') && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setStatusOpen({ initialNext: h.from_status! })}
                        title={`เปลี่ยนสถานะกลับเป็น "${STATUS_LABEL[h.from_status] ?? h.from_status}"`}
                      >
                        ย้อนกลับ
                      </button>
                    )}
                  </div>
                  {h.reason && (
                    <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--ink-2)' }}>
                      {h.reason}
                    </p>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {h.changed_by_name ?? 'ไม่ทราบผู้เปลี่ยน'} · {fmtDate(h.changed_at)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>

      {statusOpen && (
        <StatusDialog
          driverId={d.id}
          driverName={d.full_name}
          current={d.status}
          currentReason={d.status_reason}
          initialNext={statusOpen.initialNext}
          onClose={() => setStatusOpen(null)}
        />
      )}
    </main>
  )
}
