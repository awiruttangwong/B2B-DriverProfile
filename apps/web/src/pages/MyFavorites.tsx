import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverDirectoryRow } from '../types/database'
import { fmtNum, fmtPhone, fmtSince, STATUS_LABEL } from '../lib/format'
import ScoreCell from '../components/ScoreCell'
import StatusDialog from '../components/StatusDialog'
import SkeletonRows from '../components/SkeletonRows'
import SearchField from '../components/SearchField'
import { IconPin } from '../components/icons'
import { useFavorite } from '../hooks/useFavorite'

/**
 * รายชื่อ พขร. ที่ผู้ใช้คนนี้ปักหมุดไว้เอง (driver_favorites, 0034_driver_favorites.sql) —
 * private ต่อ user แต่ละคนเห็นคนละชุด ไม่มี filter สถานะ/จำนวนเที่ยว/sort/pagination
 * เหมือนหน้ารายชื่อ พขร. เพราะรายการนี้ตั้งใจให้เล็กและคัดมาเองแล้ว มีแค่ช่องค้นหา
 */
export default function MyFavorites() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusFor, setStatusFor] = useState<DriverDirectoryRow | null>(null)
  // อ่านจาก URL ครั้งเดียวตอนเมาท์ แล้วเขียนกลับทางเดียว (state -> URL) เหมือนหน้ารายชื่อ
  // พขร./พักงาน/แบล็คลิสต์ — กดเข้าโปรไฟล์แล้วย้อนกลับต้องเห็นคำค้นหาเดิม ไม่รีเซ็ต
  const [q, setQ] = useState(() => searchParams.get('q') ?? '')

  useEffect(() => {
    setSearchParams(
      (sp) => {
        const next = new URLSearchParams(sp)
        if (!q) next.delete('q')
        else next.set('q', q)
        return next
      },
      { replace: true },
    )
  }, [q, setSearchParams])

  const favIds = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_favorites')
        .select('driver_id')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => r.driver_id as string)
    },
  })

  // สองขั้น — driver_favorites.driver_id อ้างถึง drivers(id) แต่ข้อมูลที่ต้องแสดง (เที่ยววิ่ง/
  // คะแนน) มาจาก view driver_directory ที่ PostgREST embed ผ่าน FK ของ view ไม่ได้ตรง ๆ
  const drivers = useQuery({
    queryKey: ['favorites', 'drivers', favIds.data],
    enabled: !!favIds.data,
    queryFn: async () => {
      if (!favIds.data!.length) return []
      const { data, error } = await supabase
        .from('driver_directory')
        .select('*')
        .in('id', favIds.data!)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as DriverDirectoryRow[]
    },
  })

  const isLoading = favIds.isLoading || drivers.isLoading
  const rows = drivers.data ?? []

  // กรองฝั่งเครื่องล้วน ๆ ไม่ยิง query ใหม่ทุกครั้งที่พิมพ์ — รายการ "ประจำ" ต่อคนคาดว่าเล็ก
  // เสมอ ดึงมาหมดอยู่แล้ว (เหตุผลเดียวกับหน้าพักงาน) ค้นแค่ชื่อ/เบอร์โทร ตรงกับทุกหน้าอื่น
  const term = q.trim().toLowerCase()
  const filteredRows = rows.filter((d) => {
    if (!term) return true
    return `${d.full_name} ${d.phone ?? ''}`.toLowerCase().includes(term)
  })

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>พขร. ประจำของฉัน</h1>
          <p>
            พขร. ที่คุณปักหมุดไว้ใช้ซ้ำบ่อย ๆ — ส่วนตัวของคุณคนเดียว เพื่อนร่วมทีมเห็นคนละชุด
            กดไอคอนหมุดที่หน้าโปรไฟล์ พขร. เพื่อเพิ่ม/เอาออกจากรายการนี้
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="filters-row">
          <div style={{ flex: '2 1 260px' }}>
            <label htmlFor="q">ค้นหา</label>
            <SearchField id="q" value={q} onChange={setQ} placeholder="ชื่อ พขร. / เบอร์โทร" />
          </div>
        </div>
      </div>

      <div className="tablewrap drivers-table">
        <table>
          <thead>
            <tr>
              <th>พขร.</th>
              <th>เบอร์โทร</th>
              <th>เที่ยววิ่งสะสม</th>
              <th className="col-score">คะแนนประเมิน</th>
              <th>งานล่าสุด</th>
              <th className="col-action">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <SkeletonRows
                rows={4}
                columns={[
                  { width: '70%' },
                  { width: '50%', align: 'center' },
                  { width: '50%', align: 'center' },
                  { width: '50%' },
                  { width: '50%', align: 'center' },
                  { width: '50%', align: 'center' },
                ]}
              />
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconPin size={22} />
                    </span>
                    <b>ยังไม่มี พขร. ประจำ</b>
                    กดไอคอนหมุดที่หน้าโปรไฟล์ พขร. เพื่อเพิ่มเข้ารายการนี้
                    <div style={{ marginTop: 12 }}>
                      <Link to="/drivers" className="btn btn-sm">
                        ไปหน้ารายชื่อ พขร.
                      </Link>
                    </div>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && rows.length > 0 && filteredRows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconPin size={22} />
                    </span>
                    <b>ไม่พบคนที่ตรงกับคำค้นหา</b>
                    ลองคำค้นอื่น
                    <div style={{ marginTop: 12 }}>
                      <button type="button" className="btn btn-sm" onClick={() => setQ('')}>
                        ล้างคำค้นหา
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              filteredRows.map((d) => (
                <FavoriteRow
                  key={d.id}
                  driver={d}
                  canEdit={can('admin', 'hr', 'ops')}
                  onStatusClick={() => setStatusFor(d)}
                />
              ))}
          </tbody>
        </table>
      </div>

      {!isLoading && rows.length > 0 && (
        <div className="row" style={{ marginTop: 14 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            พบ {fmtNum(filteredRows.length)} จากทั้งหมด {fmtNum(rows.length)} คน
          </span>
        </div>
      )}

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

/** แยกเป็น component ย่อยเพราะแต่ละแถวต้องเรียก useFavorite(d.id) เอง (เรียก hook ใน .map()
 *  ตรง ๆ ไม่ได้) — ปุ่มปักหมุดเอาออกได้จากหน้านี้เลย ไม่ต้องเข้าโปรไฟล์ พขร. ก่อน */
function FavoriteRow({
  driver: d,
  canEdit,
  onStatusClick,
}: {
  driver: DriverDirectoryRow
  canEdit: boolean
  onStatusClick: () => void
}) {
  // ส่ง true ไปเลย ไม่ต้องให้ hook ยิงถามซ้ำ — ทุกแถวในหน้านี้คือคนที่ปักหมุดไว้อยู่แล้ว
  const { isFavorite, isToggling, error, toggle } = useFavorite(d.id, true)

  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-start' }}>
          <button
            type="button"
            className="pin-toggle"
            aria-pressed={isFavorite}
            aria-label={isFavorite ? 'เอาออกจากรายการ พขร. ประจำ' : 'เพิ่มเป็น พขร. ประจำของฉัน'}
            disabled={isToggling}
            onClick={toggle}
            title={isFavorite ? 'เอาออกจากรายการ พขร. ประจำ' : 'เพิ่มเป็น พขร. ประจำของฉัน'}
          >
            <IconPin size={16} filled={isFavorite} />
          </button>
          <Link to={`/drivers/${d.id}`} style={{ fontWeight: 500 }}>
            {d.full_name}
          </Link>
        </div>
        {/* กดเอาออกจากรายการนี้แล้วพังกลางทาง (เช่น ชนกันเองจากคนละแท็บพร้อมกันพอดี) — ไม่ปล่อย
            ให้ดูเหมือนกดไม่ติดเฉย ๆ โดยไม่บอกอะไรเลย */}
        {error && (
          <div className="doc-slot-err" style={{ marginTop: 2 }}>
            {error}
          </div>
        )}
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
        {canEdit ? (
          <button
            type="button"
            className={`badge badge-btn ${
              d.status === 'active' ? 'ok' : d.status === 'blacklisted' ? 'bad' : 'warn'
            }`}
            onClick={onStatusClick}
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
      </td>
    </tr>
  )
}
