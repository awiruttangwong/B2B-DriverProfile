import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverDirectoryRow, DriverStatusLogRow } from '../types/database'
import { fmtDateShort, fmtNum, fmtPhone, suspensionRemainingLabel } from '../lib/format'
import StatusDialog from '../components/StatusDialog'
import { IconPause } from '../components/icons'

/** เฉพาะคอลัมน์ที่หน้านี้ใช้จริงจาก driver_status_log — ไม่ได้ดึงทั้งแถว (เหตุผลเดียวกับ
 *  หน้าแบล็คลิสต์ ดูคอมเมนต์เต็มในคิวรี log ด้านล่าง) */
type SuspendedLogRow = Pick<DriverStatusLogRow, 'driver_id' | 'from_status' | 'changed_at' | 'changed_by_name'>

export default function Suspended() {
  const { can } = useAuth()
  const [statusFor, setStatusFor] = useState<DriverDirectoryRow | null>(null)

  const drivers = useQuery({
    queryKey: ['suspended', 'drivers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_directory')
        .select('*')
        .eq('status', 'inactive')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as DriverDirectoryRow[]
    },
  })

  // "ขึ้นพักงานเมื่อไร ใครบันทึก" ไม่ได้อยู่ใน driver_directory (มีแค่สถานะปัจจุบัน) ต้องแยก
  // ไปดูประวัติ — เอาแค่ครั้งล่าสุดที่ "เพิ่งเข้าสู่" สถานะพักงาน (from_status ≠ inactive) ต่อคน
  // ไม่ใช่ครั้งล่าสุดที่แตะสถานะนี้เฉย ๆ เพราะฟีเจอร์ปรับ/ต่อ/ย่นระยะเวลา (30/60/90 วัน) ทำให้
  // เกิดรายการ "พักงาน → พักงาน" (แค่เปลี่ยนกำหนดเวลา) แทรกอยู่ได้ ถ้านับรวมด้วย คอลัมน์นี้จะ
  // กลายเป็น "ล่าสุดที่แก้ไขกำหนดเวลา" ไม่ใช่ "เริ่มพักงานตั้งแต่เมื่อไร" ตามชื่อคอลัมน์จริง ๆ
  //
  // จำกัดด้วย .in(driver_id) ของคนที่กำลังพักงานอยู่จริงตอนนี้เท่านั้น ไม่ดึงประวัติทั้งตาราง
  // (ดูเหตุผลเต็มแบบเดียวกับหน้าแบล็คลิสต์ — กันเพดาน 1000 แถวของ PostgREST ตัดข้อมูลเงียบ ๆ)
  const driverIds = (drivers.data ?? []).map((d) => d.id)
  const log = useQuery({
    queryKey: ['suspended', 'log', driverIds],
    enabled: driverIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_status_log')
        .select('driver_id, from_status, changed_at, changed_by_name')
        .eq('to_status', 'inactive')
        .in('driver_id', driverIds)
        .order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SuspendedLogRow[]
    },
  })
  const latestByDriver = new Map<string, SuspendedLogRow>()
  for (const row of log.data ?? []) {
    if (row.from_status === 'inactive') continue // แค่ปรับกำหนดเวลา ไม่ใช่จุดเริ่มพักงาน
    if (!latestByDriver.has(row.driver_id)) latestByDriver.set(row.driver_id, row)
  }

  const isLoading = drivers.isLoading || log.isLoading
  const rows = drivers.data ?? []

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>พักงาน</h1>
          <p>
            รายชื่อ พขร. ที่ระงับการรับงานชั่วคราว (พักงาน) แยกจาก พขร. ที่ถูก "แบล็คลิสต์" —
            จะไม่แสดงผลในหน้าหา พขร. เพื่อเข้ารับงานจนกว่าจะพ้นกำหนดหรือเปลี่ยนสถานะ
          </p>
        </div>
      </div>

      <div className="tablewrap suspended-table">
        <table>
          <thead>
            <tr>
              <th>พขร.</th>
              <th style={{ textAlign: 'center' }}>เบอร์โทร</th>
              <th>เหตุผล</th>
              <th style={{ textAlign: 'center' }}>ขึ้นพักงานเมื่อ</th>
              <th style={{ textAlign: 'center' }}>กำหนดพักงาน</th>
              <th style={{ textAlign: 'center' }}>ผู้บันทึก</th>
              <th className="col-action" style={{ textAlign: 'center' }}>
                สถานะ
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="empty">
                  <span className="spinner" /> กำลังโหลด…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconPause size={22} />
                    </span>
                    <b>ไม่มีใครพักงานอยู่ตอนนี้</b>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading &&
              rows.map((d) => {
                const entry = latestByDriver.get(d.id)
                // ≤3 วันก่อนพ้นกำหนด — เน้นสีเตือนให้ตัดสินใจทัน (ต่อระยะเวลาต่อ/ปล่อยให้กลับ
                // เป็นใช้งานเอง) เหตุผลเดียวกับ .score-value.low ที่ใช้เน้นคะแนนต่ำในหน้าอื่น
                const soon = (() => {
                  if (!d.status_until) return false
                  const days = Math.round(
                    (new Date(`${d.status_until}T00:00:00`).getTime() - Date.now()) / 86_400_000,
                  )
                  return days <= 3
                })()
                return (
                  <tr key={d.id}>
                    <td className="nowrap">
                      <Link to={`/drivers/${d.id}`} style={{ fontWeight: 500 }}>
                        {d.full_name}
                      </Link>
                    </td>
                    <td className="mono nowrap" style={{ textAlign: 'center' }}>
                      {fmtPhone(d.phone)}
                    </td>
                    {/* เหตุผลยาวได้ไม่จำกัด ให้ตัดขึ้นบรรทัดใหม่เองแทนการ truncate — เหตุผลเดียวกับ
                        หน้าแบล็คลิสต์ ต้องเห็นครบทุกตัวอักษร ไม่ตัดด้วย ... */}
                    <td style={{ maxWidth: 260, fontSize: 13 }}>{d.status_reason ?? '—'}</td>
                    <td className="nowrap mono" style={{ fontSize: 12, textAlign: 'center' }}>
                      {entry ? fmtDateShort(entry.changed_at) : '—'}
                    </td>
                    <td className="nowrap" style={{ fontSize: 13, textAlign: 'center' }}>
                      {d.status_until ? (
                        <>
                          <div>ถึง {fmtDateShort(d.status_until)}</div>
                          <div
                            className={soon ? undefined : 'muted'}
                            style={{ fontSize: 12, color: soon ? 'var(--warn)' : undefined }}
                          >
                            {suspensionRemainingLabel(d.status_until)}
                          </div>
                        </>
                      ) : (
                        <span className="muted">ไม่กำหนดเวลา</span>
                      )}
                    </td>
                    <td className="nowrap" style={{ fontSize: 13, textAlign: 'center' }}>
                      {entry?.changed_by_name ?? '—'}
                    </td>
                    <td className="nowrap col-action" style={{ textAlign: 'center' }}>
                      {can('admin', 'ops', 'hr') ? (
                        <button className="btn btn-sm" onClick={() => setStatusFor(d)}>
                          เปลี่ยนสถานะ
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>
                          ไม่มีสิทธิ์
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {!isLoading && rows.length > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          ทั้งหมด {fmtNum(rows.length)} คน
        </p>
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
