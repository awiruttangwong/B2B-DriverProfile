import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ActivityLogRow } from '../types/database'
import {
  ACTION_LABEL,
  ACTION_TONE,
  ROLE_LABEL,
  STATUS_LABEL,
  fmtDateTime,
  fmtNum,
} from '../lib/format'
import { IconClock } from '../components/icons'

const PAGE_SIZE = 40

interface ActorOption {
  id: string
  full_name: string
  email: string | null
}

/** สรุปรายละเอียดของแต่ละแถวเป็นข้อความอ่านง่าย ต่างกันตามชนิดการกระทำ */
function Detail({ row }: { row: ActivityLogRow }) {
  const d = row.detail ?? {}

  if (row.action === 'driver_status') {
    const from = d.from as string | null
    const to = d.to as string
    const reason = d.reason as string | null
    return (
      <>
        <span className="row" style={{ gap: 6 }}>
          {from && (
            <>
              <span className="badge">{STATUS_LABEL[from] ?? from}</span>
              <span className="muted" aria-hidden="true">→</span>
            </>
          )}
          <span className="badge">{STATUS_LABEL[to] ?? to}</span>
        </span>
        {reason && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            {reason}
          </div>
        )}
      </>
    )
  }

  if (row.action === 'rating_create') {
    const score = d.score as number | null
    const reason = d.reason as string | null
    return (
      <>
        {score !== null && score !== undefined && (
          <span className="badge ok">{Number(score).toFixed(2)} ★</span>
        )}
        {reason && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            {reason}
          </div>
        )}
      </>
    )
  }

  if (row.action === 'rating_void') {
    const reason = d.void_reason as string | null
    return <div style={{ fontSize: 12.5 }}>{reason ?? '—'}</div>
  }

  if (row.action === 'job_import') {
    const total = (d.row_total as number) ?? 0
    const inserted = (d.row_inserted as number) ?? 0
    const skipped = (d.row_skipped as number) ?? 0
    const failed = (d.row_failed as number) ?? 0
    return (
      <div style={{ fontSize: 12.5 }}>
        บันทึกได้ {fmtNum(inserted)} จาก {fmtNum(total)} แถว
        {skipped > 0 && <span className="muted"> · ข้าม {fmtNum(skipped)}</span>}
        {failed > 0 && <span style={{ color: 'var(--bad)' }}> · ล้มเหลว {fmtNum(failed)}</span>}
      </div>
    )
  }

  if (row.action === 'user_join') {
    const role = d.role as string
    return <span className="badge brand">{ROLE_LABEL[role] ?? role}</span>
  }

  return <span className="muted">—</span>
}

export default function ActivityLog() {
  const [actorId, setActorId] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [actorId, action])

  const actors = useQuery({
    queryKey: ['activity-actors'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as ActorOption[]
    },
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['activity-log', actorId, action, page],
    queryFn: async () => {
      let query = supabase
        .from('activity_log')
        .select('*', { count: 'exact' })
        .order('at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (actorId) query = query.eq('actor_id', actorId)
      if (action) query = query.eq('action', action)

      const { data, error, count } = await query
      if (error) throw error
      return { rows: (data ?? []) as ActivityLogRow[], count: count ?? 0 }
    },
  })

  const rows = data?.rows ?? []
  const total = data?.count ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>บันทึกกิจกรรมระบบ</h1>
          <p>
            บันทึกทุกความเคลื่อนไหวของผู้ใช้งานในระบบ — เปลี่ยนสถานะ พขร. ประเมิน บันทึกงาน
            ไปจนถึงมีผู้ใช้งานใหม่เข้าร่วมระบบ ครอบคลุมถึงคนที่เพิ่มเข้ามาในอนาคตโดยอัตโนมัติ
            ไม่ต้องตั้งค่าอะไรเพิ่ม
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="filters-row">
          <div style={{ flex: '1 1 220px' }}>
            <label htmlFor="actor">ผู้ทำรายการ</label>
            <select id="actor" value={actorId} onChange={(e) => setActorId(e.target.value)}>
              <option value="">ทุกคน</option>
              {(actors.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                  {a.email ? ` · ${a.email}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="action">การกระทำ</label>
            <select id="action" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">ทั้งหมด</option>
              {Object.entries(ACTION_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="note-box err">โหลดข้อมูลไม่สำเร็จ: {(error as Error).message}</div>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ผู้ทำรายการ</th>
              <th>การกระทำ</th>
              <th>เป้าหมาย</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j}>
                      <div className="sk" style={{ width: j === 0 ? '70%' : '50%' }} />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconClock size={22} />
                    </span>
                    <b>ยังไม่มีกิจกรรมที่ตรงกับเงื่อนไข</b>
                    ลองล้างตัวกรองผู้ทำรายการหรือการกระทำ
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap" style={{ fontSize: 13 }}>
                    {fmtDateTime(r.at)}
                  </td>
                  <td>
                    {r.actor_name ? (
                      <>
                        <div style={{ fontWeight: 500 }}>{r.actor_name}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          {r.actor_email ?? ''}
                          {r.actor_role && (
                            <span className="badge" style={{ marginLeft: 6, fontSize: 10.5 }}>
                              {ROLE_LABEL[r.actor_role] ?? r.actor_role}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      // แถวเก่าก่อนวันที่ระบบเริ่มเติมผู้ทำรายการให้อัตโนมัติ — บอกตรง ๆ
                      // ว่าไม่มีข้อมูล ดีกว่าโชว์ขีดเปล่าที่อ่านได้ว่า "ไม่มีใครทำ"
                      <span className="muted" style={{ fontSize: 12.5 }}>
                        ไม่ได้บันทึกไว้
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${ACTION_TONE[r.action] ?? ''}`}>
                      {r.action_label}
                    </span>
                  </td>
                  <td>
                    {r.target_type === 'driver' && r.target_id ? (
                      <Link to={`/drivers/${r.target_id}`}>{r.target_label}</Link>
                    ) : (
                      r.target_label ?? '—'
                    )}
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <Detail row={r} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: 13 }}>
          พบ {fmtNum(total)} รายการ
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
