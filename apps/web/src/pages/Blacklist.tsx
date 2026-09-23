import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverDirectoryRow, DriverStatusLogRow } from '../types/database'
import { fmtDateShort, fmtNum, fmtPhone } from '../lib/format'
import StatusDialog from '../components/StatusDialog'
import SkeletonRows from '../components/SkeletonRows'
import SearchField from '../components/SearchField'
import { IconBan } from '../components/icons'

/** เฉพาะคอลัมน์ที่หน้านี้ใช้จริงจาก driver_status_log — ไม่ได้ดึงทั้งแถว */
type BlacklistLogRow = Pick<DriverStatusLogRow, 'driver_id' | 'changed_at' | 'changed_by_name'>

export default function Blacklist() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusFor, setStatusFor] = useState<DriverDirectoryRow | null>(null)
  // อ่านจาก URL ครั้งเดียวตอนเมาท์ แล้วเขียนกลับออกไปทางเดียว — เหตุผลเดียวกับหน้าพักงาน/
  // รายชื่อ พขร. อื่น ๆ: กดย้อนกลับจากโปรไฟล์ พขร. ที่ลิงก์ออกไปจากตารางนี้แล้วต้องเห็น
  // คำค้นหาเดิม ไม่รีเซ็ตเป็นค่าว่าง กรองฝั่งเครื่องล้วน ๆ ไม่ยิง query ใหม่ (จำนวนคนใน
  // แบล็คลิสต์เป็นตัวเลขเล็กเสมอ ดึงมาหมดแล้วอยู่แล้ว — ดูคอมเมนต์คิวรี drivers ด้านล่าง)
  const [q, setQ] = useState(() => searchParams.get('q') ?? '')

  useEffect(() => {
    setSearchParams(
      (sp) => {
        const next = new URLSearchParams(sp)
        if (q) next.set('q', q)
        else next.delete('q')
        return next
      },
      { replace: true },
    )
  }, [q, setSearchParams])

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

  // "ขึ้นแบล็คลิสต์เมื่อไร ใครบันทึก" ไม่ได้อยู่ใน driver_directory (มีแค่สถานะปัจจุบัน) ต้องแยก
  // ไปดูประวัติ — เอาแค่ครั้งล่าสุดที่เปลี่ยน "เป็น" blacklisted ต่อคน (คนหนึ่งอาจเคยเข้า-ออก
  // แบล็คลิสต์หลายรอบ เอาครั้งล่าสุดพอ)
  //
  // จำกัดด้วย .in(driver_id) ของคนที่อยู่ในแบล็คลิสต์จริงตอนนี้เท่านั้น ไม่ดึงประวัติทั้งตาราง:
  // driver_status_history โตขึ้นเรื่อย ๆ ตามทุกการเปลี่ยนสถานะที่เคยเกิด รวมคนที่ถูกปลดออกไป
  // นานแล้วด้วย ถ้าดึงหมดแล้ววันหนึ่งชนเพดานแถวของ PostgREST (ปกติ 1000) ผลจะถูกตัดเงียบ ๆ
  // โดยเรียงใหม่→เก่า คนที่ขึ้นแบล็คลิสต์มานานแล้วจะหลุดออกจากผลจนคอลัมน์วันที่/ผู้บันทึก
  // กลายเป็น "—" ทั้งที่มีข้อมูลอยู่ — จำนวนคนในแบล็คลิสต์เป็นตัวเลขเล็กเสมอ จึงคุมขนาดได้แน่นอน
  const driverIds = (drivers.data ?? []).map((d) => d.id)
  const log = useQuery({
    queryKey: ['blacklist', 'log', driverIds],
    enabled: driverIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_status_log')
        .select('driver_id, changed_at, changed_by_name')
        .eq('to_status', 'blacklisted')
        .in('driver_id', driverIds)
        .order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BlacklistLogRow[]
    },
  })
  const latestByDriver = new Map<string, BlacklistLogRow>()
  for (const row of log.data ?? []) {
    if (!latestByDriver.has(row.driver_id)) latestByDriver.set(row.driver_id, row)
  }

  const isLoading = drivers.isLoading || log.isLoading
  const rows = drivers.data ?? []

  // กรองฝั่งเครื่อง จับแค่ชื่อ/เบอร์โทร ไม่รวมเหตุผล (เหตุผลเดียวกับหน้าพักงาน — ดูคอมเมนต์
  // เต็มใน Suspended.tsx)
  const term = q.trim().toLowerCase()
  const filteredRows = term
    ? rows.filter((d) => `${d.full_name} ${d.phone ?? ''}`.toLowerCase().includes(term))
    : rows

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

      {/* แสดงการ์ดตัวกรองตลอด ไม่ผูกกับว่ามีข้อมูลอยู่ก่อนหรือไม่ — เหมือนหน้าอื่นที่มีตัวกรอง
          ทั้งหมดในระบบ (รายชื่อ พขร./รอประเมิน/บันทึกกิจกรรม/พักงาน) ที่โชว์ตัวกรองค้างไว้
          เสมอแล้วให้ empty-state ในตารางจัดการกรณี "ไม่มีอะไรให้ดู" เอง — ห่อด้วย .filters-row
          เหมือนทุกหน้า แม้จะมีแค่ช่องเดียว เพื่อให้ได้พฤติกรรมจอแคบ/ระยะห่างชุดเดียวกัน (ดู
          คอมเมนต์ .filters-row ใน index.css — เคยมีบั๊กจริงตอนไม่ได้ห่อแบบนี้) */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="filters-row">
          <div style={{ flex: '1 1 320px' }}>
            <label htmlFor="q">ค้นหา</label>
            <SearchField id="q" value={q} onChange={setQ} placeholder="ชื่อ พขร. / เบอร์โทร" />
          </div>
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
                  { width: '50%', align: 'center' }, // ขึ้นแบล็คลิสต์เมื่อ
                  { width: '50%', align: 'center' }, // ผู้บันทึก
                  { width: '50%', align: 'center' }, // สถานะ
                ]}
              />
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
            {!isLoading && rows.length > 0 && filteredRows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <span className="e-icon">
                      <IconBan size={22} />
                    </span>
                    <b>ไม่พบคนที่ตรงกับคำค้นหา</b>
                    <div style={{ marginTop: 12 }}>
                      <button className="btn btn-sm" onClick={() => setQ('')}>
                        ล้างคำค้นหา
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading &&
              filteredRows.map((d) => {
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
          {term ? (
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
