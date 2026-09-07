import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Customer, DriverFitRow, VehicleType } from '../types/database'
import { fmtDateShort, fmtNum, fmtPhone, fmtScore } from '../lib/format'
import Combobox, { type ComboOption } from '../components/Combobox'
import { IconTarget } from '../components/icons'

interface RouteSuggestion {
  route_raw: string
  job_count: number
}

/**
 * ช่องพิมพ์เส้นทางแบบอิสระ — ไม่บังคับเลือกจากลิสต์เหมือน Combobox
 * เพราะค้นด้วย ILIKE คำที่พิมพ์ได้เลย พิมพ์อะไรก็ใช้ได้ ลิสต์เป็นแค่ทางลัด
 */
function RouteField({
  value,
  onChange,
  suggestions,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: RouteSuggestion[]
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const q = value.trim().toLowerCase()
  const filtered = (q ? suggestions.filter((s) => s.route_raw.toLowerCase().includes(q)) : suggestions).slice(0, 8)

  return (
    <div className="route-field" ref={wrapRef}>
      <input
        id="rt"
        type="search"
        autoComplete="off"
        placeholder="เช่น ระยอง, คลังสุวินทวงศ์, แหลมฉบัง"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && filtered.length > 0 && (
        <ul className="combo-list" role="listbox">
          {filtered.map((s) => (
            <li
              key={s.route_raw}
              role="option"
              aria-selected={s.route_raw === value}
              className="combo-item"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(s.route_raw)
                setOpen(false)
              }}
            >
              <span className="combo-label">{s.route_raw}</span>
              <span className="combo-hint">{fmtNum(s.job_count)} เที่ยว</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function FindDriver() {
  const [customer, setCustomer] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [route, setRoute] = useState('')
  const [submitted, setSubmitted] = useState<{
    customer: string
    vehicleType: string
    route: string
  } | null>(null)

  const customers = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').order('code')
      if (error) throw error
      return (data ?? []) as Customer[]
    },
    staleTime: 30 * 60_000,
  })

  const vehicleTypes = useQuery({
    queryKey: ['vehicle_types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_types').select('*').order('code')
      if (error) throw error
      return (data ?? []) as VehicleType[]
    },
    staleTime: 30 * 60_000,
  })

  const customerOpts: ComboOption[] = useMemo(
    () => (customers.data ?? []).map((c) => ({ value: c.code, label: c.code })),
    [customers.data],
  )
  const vtOpts: ComboOption[] = useMemo(
    () =>
      (vehicleTypes.data ?? []).map((v) => ({
        value: v.code,
        label: v.code,
        hint: v.name ?? undefined,
      })),
    [vehicleTypes.data],
  )

  const routeSuggestions = useQuery({
    queryKey: ['route_suggestions'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_routes', { p_limit: 500 })
      if (error) throw error
      return (data ?? []) as RouteSuggestion[]
    },
    staleTime: 30 * 60_000,
  })

  const results = useQuery({
    queryKey: ['fit', submitted],
    enabled: !!submitted,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_drivers', {
        p_customer_code: submitted?.customer || null,
        p_vehicle_type_code: submitted?.vehicleType || null,
        p_route_keyword: submitted?.route.trim() || null,
        p_limit: 25,
      })
      if (error) throw error
      return (data ?? []) as DriverFitRow[]
    },
  })

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>หาคนสำหรับงาน</h1>
          <p>
            ระบุความต้องการของงาน ระบบจะตัดคนที่สถานะไม่พร้อมออกก่อน
            แล้วเรียงคนที่เหลือตามผลงานที่เกี่ยวข้องกับงานนี้โดยเฉพาะ ไม่ใช่คะแนนรวมอย่างเดียว
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="filters-row">
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="cu">ลูกค้า / ประเภทงาน</label>
            <Combobox
              id="cu"
              value={customer}
              onChange={setCustomer}
              options={customerOpts}
              placeholder="ไม่ระบุ — พิมพ์ค้นหา"
              emptyText="ไม่พบลูกค้ารายนี้"
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <label htmlFor="vt">ประเภทรถ</label>
            <Combobox
              id="vt"
              value={vehicleType}
              onChange={setVehicleType}
              options={vtOpts}
              placeholder="ไม่ระบุ — พิมพ์ค้นหา"
              emptyText="ไม่พบประเภทรถนี้"
            />
          </div>
          <div style={{ flex: '2 1 240px' }}>
            <label htmlFor="rt">เส้นทาง</label>
            <RouteField value={route} onChange={setRoute} suggestions={routeSuggestions.data ?? []} />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setSubmitted({ customer, vehicleType, route })}
          >
            ค้นหา
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          ยิ่งระบุมาก อันดับยิ่งตรงงาน — ถ้าไม่ระบุอะไรเลยจะได้อันดับจากผลงานโดยรวมเท่านั้น
        </p>
      </div>

      {!submitted && (
        <div className="card">
          <div className="empty">
            <span className="e-icon">
              <IconTarget size={22} />
            </span>
            <b>ยังไม่ได้จัดอันดับ</b>
            เลือกลูกค้า ประเภทรถ หรือใส่เส้นทางด้านบน แล้วกด “ค้นหา”
            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-sm"
                onClick={() => setSubmitted({ customer: '', vehicleType: '', route: '' })}
              >
                ดูอันดับรวมโดยไม่ระบุเงื่อนไข
              </button>
            </div>
          </div>
        </div>
      )}

      {results.isLoading && (
        <div className="card empty">
          <span className="spinner" /> กำลังคำนวณอันดับ…
        </div>
      )}

      {results.error && (
        <div className="note-box err">
          เรียกฟังก์ชันจัดอันดับไม่สำเร็จ: {(results.error as Error).message}
        </div>
      )}

      {results.data && (
        <>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th className="right">อันดับ</th>
                  <th>พขร.</th>
                  <th>เบอร์โทร</th>
                  <th className="right">เที่ยวรวม</th>
                  {submitted?.customer && <th className="right">เที่ยวลูกค้านี้</th>}
                  {submitted?.vehicleType && <th className="right">เที่ยวรถแบบนี้</th>}
                  {submitted?.route.trim() && <th className="right">เที่ยวเส้นนี้</th>}
                  <th className="right">คะแนน</th>
                  <th>งานล่าสุด</th>
                  <th className="right">ความเหมาะสม</th>
                </tr>
              </thead>
              <tbody>
                {results.data.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty">
                      ไม่พบ พขร. ที่ผ่านเงื่อนไข
                    </td>
                  </tr>
                )}
                {results.data.map((r, i) => (
                  <tr key={r.driver_id}>
                    <td className="right num muted">{i + 1}</td>
                    <td>
                      <Link to={`/drivers/${r.driver_id}`} style={{ fontWeight: 500 }}>
                        {r.full_name}
                      </Link>
                      <div className="mono muted" style={{ fontSize: 11 }}>
                        {r.driver_code}
                      </div>
                    </td>
                    <td className="mono nowrap">{fmtPhone(r.phone)}</td>
                    <td className="right num">{fmtNum(r.total_jobs)}</td>
                    {submitted?.customer && (
                      <td className="right num" style={{ fontWeight: r.customer_jobs ? 600 : 400 }}>
                        {fmtNum(r.customer_jobs)}
                      </td>
                    )}
                    {submitted?.vehicleType && (
                      <td className="right num">{fmtNum(r.vehicle_type_jobs)}</td>
                    )}
                    {submitted?.route.trim() && (
                      <td className="right num" style={{ fontWeight: r.route_jobs ? 600 : 400 }}>
                        {fmtNum(r.route_jobs)}
                      </td>
                    )}
                    <td className="right num">
                      {r.rating_count > 0 ? (
                        <>
                          {fmtScore(r.adjusted_score)}
                          <span className="muted" style={{ fontSize: 11 }}>
                            {' '}
                            ({r.rating_count})
                          </span>
                        </>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>
                          ยังไม่มี
                        </span>
                      )}
                    </td>
                    <td className="nowrap mono" style={{ fontSize: 11.5 }}>
                      {fmtDateShort(r.last_job_date)}
                    </td>
                    <td className="right">
                      <span className="num" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                        {Number(r.fit_score).toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="note-box" style={{ marginTop: 16 }}>
            <strong>อ่านคะแนนความเหมาะสมอย่างไร</strong> — เต็ม 100 ประกอบด้วย คุณภาพงาน 40 ·
            ตรงเวลา 20 · ความคุ้นเคยกับลูกค้ารายนี้ 15 · ประเภทรถ 10 · เส้นทาง 10 ·
            ความสดของข้อมูล 5 แล้วหักครั้งละ 10 ต่อเหตุใน 12 เดือนที่ผ่านมา
            <br />
            ตอนนี้ยังไม่มีคะแนนรีวิวในระบบ ส่วนคุณภาพงานจึงใช้ค่ากลางเท่ากันทุกคน
            อันดับช่วงแรกจึงตัดสินด้วยประสบการณ์ตรงสายเป็นหลัก
            และจะแม่นขึ้นเรื่อย ๆ เมื่อเริ่มให้คะแนน
          </div>
        </>
      )}
    </main>
  )
}
