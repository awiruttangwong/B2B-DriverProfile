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

  // แสดงทั้ง 3 ช่องพร้อมกันเสมอ (ไม่ซ่อน) แล้วไฮไลท์เฉพาะ "ขั้นถัดไปที่ควรกรอก" แทน
  // — ขั้นแรกที่ยังว่างอยู่คือขั้นที่ถูกเน้น ถ้ากรอกครบทุกช่องแล้วก็ไม่เน้นช่องไหนเป็นพิเศษ
  // เว้นช่องไหนไว้ก็ยังค้นหาด้วยเงื่อนไขเดียวได้เหมือนเดิม ไม่บังคับกรอกครบ
  const activeStep = !customer ? 1 : !vehicleType ? 2 : !route.trim() ? 3 : 0

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

  // เดิมจำกัดไว้ 25 แบบตายตัวและไม่มีทางเห็นว่ายังเหลืออีกเท่าไร — ตรวจกับฐานข้อมูล
  // จริงพบว่า พขร. ที่ผ่านตัวกรองสถานะมี 1,290 คน ไม่ใช่ 25 คน ตัวกรองลูกค้า/ประเภทรถ/
  // เส้นทางไม่ได้ตัดคนออกจากรายชื่อเลย มีผลแค่กับลำดับการเรียง คนที่ 26 เป็นต้นไปจึง
  // อาจเป็นคนที่ตรงเงื่อนไขจริงแต่ไม่เคยเห็นเลยสักครั้ง — เปลี่ยนเป็นโหลดเพิ่มได้แทน
  const [limit, setLimit] = useState(25)

  const results = useQuery({
    queryKey: ['fit', submitted, limit],
    enabled: !!submitted,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_drivers', {
        p_customer_code: submitted?.customer || null,
        p_vehicle_type_code: submitted?.vehicleType || null,
        p_route_keyword: submitted?.route.trim() || null,
        p_limit: limit,
      })
      if (error) throw error
      return (data ?? []) as DriverFitRow[]
    },
  })

  // ตัวกรองไม่ได้ตัดคนออกจากรายชื่อ (ดูหมายเหตุด้านบน) ตัวส่วนของ "แสดง X จาก Y"
  // จึงอ้างอิงแค่จำนวน พขร. ที่ผ่านสถานะ active/probation เฉย ๆ ไม่ต้องคำนวณใหม่ทุกครั้ง
  // ที่เปลี่ยนตัวกรอง
  const eligibleCount = useQuery({
    queryKey: ['fit-eligible-count'],
    enabled: !!submitted,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('drivers')
        .select('id', { count: 'exact' })
        .in('status', ['active', 'probation'])
        .limit(1)
      if (error) throw error
      return count ?? 0
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
          <div className={activeStep === 1 ? 'filter-step-active' : undefined} style={{ flex: '1 1 200px' }}>
            <label htmlFor="cu">
              ลูกค้า / ประเภทงาน
              {activeStep === 1 && <span className="step-dot" aria-hidden="true" />}
            </label>
            <Combobox
              id="cu"
              value={customer}
              onChange={setCustomer}
              options={customerOpts}
              placeholder="ไม่ระบุ — พิมพ์ค้นหา"
              emptyText="ไม่พบลูกค้ารายนี้"
            />
          </div>
          <div className={activeStep === 2 ? 'filter-step-active' : undefined} style={{ flex: '1 1 180px' }}>
            <label htmlFor="vt">
              ประเภทรถ
              {activeStep === 2 && <span className="step-dot" aria-hidden="true" />}
            </label>
            <Combobox
              id="vt"
              value={vehicleType}
              onChange={setVehicleType}
              options={vtOpts}
              placeholder="ไม่ระบุ — พิมพ์ค้นหา"
              emptyText="ไม่พบประเภทรถนี้"
            />
          </div>
          <div className={activeStep === 3 ? 'filter-step-active' : undefined} style={{ flex: '2 1 240px' }}>
            <label htmlFor="rt">
              เส้นทาง
              {activeStep === 3 && <span className="step-dot" aria-hidden="true" />}
            </label>
            <RouteField value={route} onChange={setRoute} suggestions={routeSuggestions.data ?? []} />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setLimit(25)
              setSubmitted({ customer, vehicleType, route })
            }}
          >
            ค้นหา
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          ยิ่งระบุมาก อันดับยิ่งตรงงาน — ช่องที่ไฮไลท์อยู่คือช่องที่ควรกรอกถัดไป
          แต่เว้นช่องไหนไว้ก็ได้ถ้าไม่ต้องการระบุ
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
                onClick={() => {
                  setLimit(25)
                  setSubmitted({ customer: '', vehicleType: '', route: '' })
                }}
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
                  <th className="right">จำนวนเที่ยวรวมทุกลูกค้า</th>
                  {submitted?.customer && (
                    <th className="right">จำนวนเที่ยวที่วิ่งให้ {submitted.customer}</th>
                  )}
                  {submitted?.vehicleType && (
                    <th className="right">จำนวนเที่ยวที่วิ่งรถแบบ {submitted.vehicleType}</th>
                  )}
                  {submitted?.route.trim() && (
                    <th className="right">จำนวนเที่ยวที่วิ่งเส้นทาง &ldquo;{submitted.route.trim()}&rdquo;</th>
                  )}
                  <th className="right">คะแนน</th>
                  <th>งานล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {results.data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {eligibleCount.data !== undefined && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
                แสดง {fmtNum(results.data.length)} จาก {fmtNum(eligibleCount.data)} คน
              </p>
              {results.data.length < eligibleCount.data && (
                <button
                  className="btn btn-sm"
                  disabled={results.isFetching}
                  onClick={() => setLimit((l) => Math.min(l + 25, eligibleCount.data ?? l + 25))}
                >
                  {results.isFetching ? 'กำลังโหลด…' : 'โหลดเพิ่ม 25 คน'}
                </button>
              )}
            </div>
          )}

          <div className="note-box" style={{ marginTop: 16 }}>
            <strong>อ่านลำดับอย่างไร</strong> — เรียงจากข้อมูลจริงเท่านั้น ไม่มีคะแนนผสมสูตรที่มโนขึ้นเอง
            โดยคะแนนทำหน้าที่ <em>คัดคนที่ไม่ควรส่ง</em> ส่วนประสบการณ์ทำหน้าที่ <em>เลือกคนที่ควรส่ง</em>:
            เริ่มจากกดคนที่เคยมีปัญหา (ไม่มารับงาน/มีเหตุ) ใน 12 เดือนล่าสุด และคนที่ถูกประเมินต่ำกว่า 3.00
            ลงไปไว้ท้าย — คนที่ยังไม่เคยถูกประเมินไม่ถือว่าแย่ เพราะ &ldquo;ไม่รู้&rdquo; ไม่เท่ากับ
            &ldquo;ไม่ดี&rdquo; — ที่เหลือเรียงตามประสบการณ์ที่ตรงกับงานนี้ (ลูกค้า/ประเภทรถ/เส้นทางที่ระบุ)
            เสมอกันจึงดูคะแนน แล้วตามด้วยประสบการณ์รวมและความสดของงานล่าสุด
          </div>
        </>
      )}
    </main>
  )
}
