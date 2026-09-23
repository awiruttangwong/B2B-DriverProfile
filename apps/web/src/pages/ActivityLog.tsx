import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ActivityLogRow } from '../types/database'
import {
  ACTION_LABEL,
  ACTION_TONE,
  CONTACT_OUTCOME_LABEL,
  CONTACT_OUTCOME_TONE,
  STATUS_LABEL,
  fmtDateShort,
  fmtDateTime,
  fmtNum,
  roleLabel,
} from '../lib/format'
import ClearableSelect from '../components/ClearableSelect'
import SkeletonRows from '../components/SkeletonRows'
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
    // มีเฉพาะแถวที่เกิดหลัง 0031_driver_suspension_duration.sql — แถวเก่าก่อนหน้านั้น
    // ไม่มีคีย์นี้ใน detail เลย จึงต้องรองรับ undefined ด้วย ไม่ใช่แค่ null
    const statusUntil = d.status_until as string | null | undefined
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
          {to === 'inactive' && statusUntil && (
            <span className="muted" style={{ fontSize: 12 }}>
              ถึง {fmtDateShort(statusUntil)}
            </span>
          )}
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
    const email = d.email as string | null
    return <span className="badge brand">{roleLabel(role, email)}</span>
  }

  if (row.action === 'driver_contact') {
    const outcome = d.outcome as string
    const note = d.note as string | null
    const calledAt = d.called_at as string | null
    return (
      <>
        <span className="row" style={{ gap: 6 }}>
          <span className={`badge ${CONTACT_OUTCOME_TONE[outcome] ?? ''}`}>
            {CONTACT_OUTCOME_LABEL[outcome] ?? outcome}
          </span>
          {/* เวลาในคอลัมน์ซ้ายสุดคือเวลาที่บันทึก — ถ้าลงย้อนหลัง ต้องบอกเวลาที่โทรจริงด้วย */}
          {calledAt && <span className="muted" style={{ fontSize: 12 }}>โทร {fmtDateTime(calledAt)}</span>}
        </span>
        {note?.trim() && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
            {note}
          </div>
        )}
      </>
    )
  }

  return <span className="muted">—</span>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function ActivityLog() {
  const [searchParams, setSearchParams] = useSearchParams()
  // อ่านจาก URL ครั้งเดียวตอนเมาท์ แล้วเขียนกลับออกไปทางเดียวใน effect ด้านล่าง (เหตุผล
  // เดียวกับหน้ารายชื่อ พขร./รอประเมิน) — กดย้อนกลับจากโปรไฟล์ พขร. ที่ลิงก์ไปจากคอลัมน์
  // "รายการที่เกี่ยวข้อง" จึงเห็นตัวกรอง+หน้าเดิม ไม่รีเซ็ตเป็นค่าเริ่มต้น
  const [actorId, setActorId] = useState(() => {
    const v = searchParams.get('actor') ?? ''
    return UUID_RE.test(v) ? v : ''
  })
  const [action, setAction] = useState(() => {
    const v = searchParams.get('action') ?? ''
    return v in ACTION_LABEL ? v : ''
  })
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('page'))
    return Number.isFinite(p) && p > 0 ? p - 1 : 0
  })

  // รีเซ็ตหน้าเฉพาะตอนตัวกรอง "เปลี่ยนจริง" เท่านั้น เทียบกับค่าที่จำไว้ล่าสุดแทนการใช้
  // flag "เมาท์ครั้งแรกหรือยัง" ตรง ๆ — เพราะ React StrictMode ตอนพัฒนายิง effect ซ้ำสอง
  // รอบตอนเมาท์ ถ้าใช้ flag ตัวเดียวรอบที่สองจะหลุดผ่านเงื่อนไขไปรีเซ็ตหน้าที่เพิ่งกู้คืน
  // มาจาก URL (เช่น page=3 ตอนกดย้อนกลับ) ทันที ทั้งที่ไม่มีอะไรเปลี่ยนจริง (ดูคอมเมนต์
  // เต็มแบบเดียวกันใน Drivers.tsx)
  const prevFilters = useRef({ actorId, action })
  useEffect(() => {
    const prev = prevFilters.current
    const changed = prev.actorId !== actorId || prev.action !== action
    prevFilters.current = { actorId, action }
    if (changed) setPage(0)
  }, [actorId, action])

  useEffect(() => {
    setSearchParams(
      (sp) => {
        const next = new URLSearchParams(sp)
        const setOrDelete = (k: string, v: string, isDefault: boolean) => {
          if (isDefault) next.delete(k)
          else next.set(k, v)
        }
        setOrDelete('actor', actorId, !actorId)
        setOrDelete('action', action, !action)
        setOrDelete('page', String(page + 1), page === 0)
        return next
      },
      { replace: true },
    )
  }, [actorId, action, page, setSearchParams])

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
            <ClearableSelect
              id="actor"
              value={actorId}
              onChange={setActorId}
              options={[
                { value: '', label: 'ทุกคน' },
                ...(actors.data ?? []).map((a) => ({
                  value: a.id,
                  label: a.email ? `${a.full_name} · ${a.email}` : a.full_name,
                })),
              ]}
              clearLabel="ล้างตัวกรองผู้ทำรายการ"
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="action">ประเภทกิจกรรม</label>
            <ClearableSelect
              id="action"
              value={action}
              onChange={setAction}
              options={[
                { value: '', label: 'ทั้งหมด' },
                ...Object.entries(ACTION_LABEL).map(([k, label]) => ({ value: k, label })),
              ]}
              clearLabel="ล้างตัวกรองประเภทกิจกรรม"
            />
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
              <th>ประเภทกิจกรรม</th>
              <th>รายการที่เกี่ยวข้อง</th>
              <th>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <SkeletonRows
                rows={8}
                columns={[
                  { width: '55%' }, // เวลา
                  { width: '70%' }, // ผู้ทำรายการ
                  { width: '45%' }, // ประเภทกิจกรรม
                  { width: '55%' }, // รายการที่เกี่ยวข้อง
                  { width: '80%' }, // รายละเอียด
                ]}
              />
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconClock size={22} />
                    </span>
                    <b>ยังไม่มีกิจกรรมที่ตรงกับเงื่อนไข</b>
                    ลองล้างตัวกรองผู้ทำรายการหรือประเภทกิจกรรม
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
                              {roleLabel(r.actor_role, r.actor_email)}
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
