import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverDirectoryRow, DriverStatusLogRow } from '../types/database'
import { fmtDateShort, fmtNum, fmtPhone } from '../lib/format'
import StatusDialog from '../components/StatusDialog'
import { IconBan } from '../components/icons'

export default function Blacklist() {
  const { can } = useAuth()
  const [statusFor, setStatusFor] = useState<DriverDirectoryRow | null>(null)

  const drivers = useQuery({
    queryKey: ['blacklist', 'drivers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_directory')
        .select('*')
        .eq('status', 'blacklisted')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as DriverDirectoryRow[]
    },
  })

  // "ขึ้นบัญชีดำเมื่อไร ใครสั่ง" ไม่ได้อยู่ใน driver_directory (แค่สถานะปัจจุบัน) ต้องแยกไปดู
  // ประวัติ — เอาแค่ครั้งล่าสุดที่เปลี่ยน "เป็น" blacklisted ต่อคน (คนหนึ่งอาจเคยเข้า-ออกบัญชี
  // ดำหลายรอบ เอาครั้งล่าสุดพอ) ผูกกับตารางที่ query แยกเพราะ driver_status_log ไม่มี join
  // สำเร็จรูปกับ driver_directory ให้ในคำสั่งเดียว และ view เดิมทั้งสองใช้กันคนละที่อยู่แล้ว
  const log = useQuery({
    queryKey: ['blacklist', 'log'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_status_log')
        .select('*')
        .eq('to_status', 'blacklisted')
        .order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as DriverStatusLogRow[]
    },
  })
  const latestByDriver = new Map<string, DriverStatusLogRow>()
  for (const row of log.data ?? []) {
    if (!latestByDriver.has(row.driver_id)) latestByDriver.set(row.driver_id, row)
  }

  const isLoading = drivers.isLoading || log.isLoading
  const rows = drivers.data ?? []

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>แบล็คลิสต์</h1>
          <p>
            รายชื่อ พขร. ที่ถูกระงับการรับงาน (แบล็คลิสต์) เพราะมีปัญหา แยกจาก พขร. ที่ "พักงาน" —
            จะไม่แสดงผลในหน้าหา พขร. เพื่อเข้ารับงานจนกว่าจะเปลี่ยนสถานะ
          </p>
        </div>
      </div>

      <div className="tablewrap blacklist-table">
        <table>
          <thead>
            <tr>
              <th>พขร.</th>
              <th style={{ textAlign: 'center' }}>เบอร์โทร</th>
              <th>เหตุผล</th>
              <th style={{ textAlign: 'center' }}>ขึ้นแบล็คลิสต์เมื่อ</th>
              <th style={{ textAlign: 'center' }}>ผู้บันทึก</th>
              <th>สถานะ</th>
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
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconBan size={22} />
                    </span>
                    <b>ไม่มีใครอยู่ในบัญชีดำตอนนี้</b>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading &&
              rows.map((d) => {
                const entry = latestByDriver.get(d.id)
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
                    {/* เหตุผลยาวได้ไม่จำกัด ถ้าปล่อยให้คอลัมน์ขยายตามความยาวข้อความจะไปแย่งพื้นที่
                        คอลัมน์ชื่อจนชื่อคนขึ้นบรรทัดใหม่ (เจอจริงกับ "ณัฐวัฒน์ สุดประเสริฐ")
                        จำกัดความกว้างไว้ที่ maxWidth แทน แล้วให้ข้อความตัดขึ้นบรรทัดใหม่เอง
                        (ต้องเห็นครบทุกตัวอักษร ไม่ตัดด้วย ... เหมือนที่ลองมาก่อนหน้านี้) */}
                    <td style={{ maxWidth: 260, fontSize: 13 }}>{d.status_reason ?? '—'}</td>
                    <td className="nowrap mono" style={{ fontSize: 12, textAlign: 'center' }}>
                      {entry ? fmtDateShort(entry.changed_at) : '—'}
                    </td>
                    <td className="nowrap" style={{ fontSize: 13, textAlign: 'center' }}>
                      {entry?.changed_by_name ?? '—'}
                    </td>
                    <td className="nowrap">
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
          onClose={() => setStatusFor(null)}
        />
      )}
    </main>
  )
}
