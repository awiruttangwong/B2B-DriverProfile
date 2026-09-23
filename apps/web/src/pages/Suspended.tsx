import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverDirectoryRow, DriverStatusLogRow } from '../types/database'
import { fmtDateShort, fmtNum, fmtPhone, suspensionRemainingLabel } from '../lib/format'
import StatusDialog from '../components/StatusDialog'
import SkeletonRows from '../components/SkeletonRows'
import ClearableSelect from '../components/ClearableSelect'
import SearchField from '../components/SearchField'
import { IconPause } from '../components/icons'

/** เฉพาะคอลัมน์ที่หน้านี้ใช้จริงจาก driver_status_log — ไม่ได้ดึงทั้งแถว (เหตุผลเดียวกับ
 *  หน้าแบล็คลิสต์ ดูคอมเมนต์เต็มในคิวรี log ด้านล่าง) */
type SuspendedLogRow = Pick<DriverStatusLogRow, 'driver_id' | 'from_status' | 'changed_at' | 'changed_by_name'>

/** จำนวนวันก่อนครบกำหนด (ปัดเป็นจำนวนเต็ม) — ใช้ร่วมกันทั้งตัวกรอง "กำหนดพักงาน" ด้านล่าง
 *  และป้ายเตือนสีในตาราง (เกณฑ์ ≤3 วันของป้ายเตือนเป็นคนละเรื่องกับช่วงตัวกรอง — ป้ายเตือน
 *  บอกว่า "ต้องรีบตัดสินใจ" ส่วนตัวกรองบอกว่า "อยู่ในกลุ่มระยะเวลาไหน" จึงมีเกณฑ์ต่างกันได้) */
function daysUntil(dateStr: string): number {
  return Math.round((new Date(`${dateStr}T00:00:00`).getTime() - Date.now()) / 86_400_000)
}

// เกณฑ์ ≤30 วันอิงตัวเลข 30 เดียวกับตัวเลือกระยะเวลาพักงานสั้นสุดในกล่องเปลี่ยนสถานะ
// (StatusDialog.tsx) แทนเกณฑ์ "≤3 วัน" ที่ตั้งขึ้นเองลอย ๆ ก่อนหน้านี้ซึ่งไม่ได้อิงกับ
// อะไรในระบบเลย — ตัดตัวเลือก 31-60/มากกว่า 60 ออกตามที่ขอ เหลือแค่กลุ่มที่ใช้งานจริง
const DUE_OPTIONS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'le30', label: 'ครบกำหนดใน ≤30 วัน' },
  { value: 'indefinite', label: 'ไม่กำหนดเวลา' },
]

export default function Suspended() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusFor, setStatusFor] = useState<DriverDirectoryRow | null>(null)
  // อ่านจาก URL ครั้งเดียวตอนเมาท์ แล้วเขียนกลับออกไปทางเดียว (state -> URL) ใน effect
  // ด้านล่าง — เหตุผลเดียวกับตัวกรองในหน้ารายชื่อ พขร./รอประเมิน/บันทึกกิจกรรม: กดย้อนกลับ
  // จากโปรไฟล์ พขร. ที่ลิงก์ออกไปจากตารางนี้แล้วต้องเห็นตัวกรองเดิม ไม่รีเซ็ตเป็นค่าเริ่มต้น
  // กรองฝั่งเครื่อง (ไม่ยิง query ใหม่) เพราะจำนวนคนพักงานเป็นตัวเลขเล็กเสมอ — ดึงมาหมดแล้ว
  // อยู่แล้วโดยธรรมชาติของหน้านี้ (ดูคอมเมนต์คิวรี drivers ด้านล่าง)
  const [q, setQ] = useState(() => searchParams.get('q') ?? '')
  const [due, setDue] = useState(() => {
    const v = searchParams.get('due') ?? ''
    return DUE_OPTIONS.some((o) => o.value === v) ? v : ''
  })

  useEffect(() => {
    setSearchParams(
      (sp) => {
        const next = new URLSearchParams(sp)
        const setOrDelete = (k: string, v: string, isDefault: boolean) => {
          if (isDefault) next.delete(k)
          else next.set(k, v)
        }
        setOrDelete('q', q, !q)
        setOrDelete('due', due, !due)
        return next
      },
      { replace: true },
    )
  }, [q, due, setSearchParams])

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

  // "เริ่มพักงานเมื่อไร ใครบันทึก" ไม่ได้อยู่ใน driver_directory (มีแค่สถานะปัจจุบัน) ต้องแยก
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

  // กรองฝั่งเครื่องล้วน ๆ ไม่ยิง query ใหม่ (ดูคอมเมนต์ query "drivers" ด้านบน — จำนวนคน
  // พักงานเป็นตัวเลขเล็กเสมอ ดึงมาหมดอยู่แล้ว) คำค้นหาจับแค่ชื่อ/เบอร์โทร ไม่รวมเหตุผล —
  // เหตุผลเป็นข้อความอิสระยาวไม่จำกัด ค้นแล้วมักเจอคำที่ไม่ได้ตั้งใจหาคนคนนั้นจริง ๆ (เช่น
  // ค้นคำว่า "งาน" แล้วขึ้นทุกแถวที่มีคำนี้ในเหตุผล) ตรงกับที่หน้ารายชื่อ พขร. ก็ไม่ค้นจาก
  // เหตุผลเหมือนกัน
  const term = q.trim().toLowerCase()
  const filteredRows = rows.filter((d) => {
    if (term) {
      const hay = `${d.full_name} ${d.phone ?? ''}`.toLowerCase()
      if (!hay.includes(term)) return false
    }
    if (due === 'indefinite') {
      if (d.status_until) return false
    } else if (due === 'le30') {
      if (!d.status_until || daysUntil(d.status_until) > 30) return false
    }
    return true
  })
  const hasFilter = !!q || !!due

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

      {/* แสดงการ์ดตัวกรองตลอด ไม่ผูกกับว่ามีข้อมูลอยู่ก่อนหรือไม่ — เหมือนหน้ารายชื่อ พขร./
          รอประเมิน/บันทึกกิจกรรม ที่โชว์ตัวกรองค้างไว้เสมอแล้วให้ empty-state ในตารางจัดการ
          กรณี "ไม่มีอะไรให้ดู" เอง แยกความกังวลออกจากกัน ไม่ต้องมีเงื่อนไขพิเศษซ้อนอีกชั้น */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="filters-row">
          <div style={{ flex: '2 1 220px' }}>
            <label htmlFor="q">ค้นหา</label>
            <SearchField id="q" value={q} onChange={setQ} placeholder="ชื่อ พขร. / เบอร์โทร" />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="due">กำหนดพักงาน</label>
            <ClearableSelect
              id="due"
              value={due}
              onChange={setDue}
              options={DUE_OPTIONS}
              clearLabel="ล้างตัวกรองกำหนดพักงาน"
            />
          </div>
        </div>
      </div>

      <div className="tablewrap suspended-table">
        <table>
          <thead>
            <tr>
              <th>พขร.</th>
              <th style={{ textAlign: 'center' }}>เบอร์โทร</th>
              <th>เหตุผล</th>
              <th style={{ textAlign: 'center' }}>เริ่มพักงานเมื่อ</th>
              <th style={{ textAlign: 'center' }}>กำหนดพักงาน</th>
              <th style={{ textAlign: 'center' }}>ผู้บันทึก</th>
              <th className="col-action" style={{ textAlign: 'center' }}>
                สถานะ
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <SkeletonRows
                rows={5}
                columns={[
                  { width: '65%' }, // พขร.
                  { width: '55%', align: 'center' }, // เบอร์โทร
                  { width: '75%' }, // เหตุผล
                  { width: '50%', align: 'center' }, // เริ่มพักงานเมื่อ
                  { width: '55%', align: 'center' }, // กำหนดพักงาน
                  { width: '50%', align: 'center' }, // ผู้บันทึก
                  { width: '50%', align: 'center' }, // สถานะ
                ]}
              />
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
            {!isLoading && rows.length > 0 && filteredRows.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconPause size={22} />
                    </span>
                    <b>ไม่พบคนที่ตรงกับเงื่อนไข</b>
                    ลองล้างคำค้นหาหรือตัวกรองกำหนดพักงาน
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setQ('')
                          setDue('')
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
              filteredRows.map((d) => {
                const entry = latestByDriver.get(d.id)
                // ≤3 วันก่อนพ้นกำหนด — เน้นสีเตือนให้ตัดสินใจทัน (ต่อระยะเวลาต่อ/ปล่อยให้กลับ
                // เป็นใช้งานเอง) เหตุผลเดียวกับ .score-value.low ที่ใช้เน้นคะแนนต่ำในหน้าอื่น
                const soon = !!d.status_until && daysUntil(d.status_until) <= 3
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

      {!isLoading && filteredRows.length > 0 && (
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {hasFilter ? (
            <>
              พบ {fmtNum(filteredRows.length)} จากทั้งหมด {fmtNum(rows.length)} คน
            </>
          ) : (
            <>ทั้งหมด {fmtNum(rows.length)} คน</>
          )}
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
