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

  // จุดฟ้าข้างป้ายชื่อบอกว่าช่องไหนควรกรอกถัดไป — ไม่มีพื้นหลังไฮไลท์แล้ว
  // (เอาออกตามที่แจ้ง) แค่จุดเล็ก ๆ ยังคงไว้ ข้ามช่องไหนก็ได้เหมือนเดิม
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

  // uuid จริงของค่าที่เลือกไว้ — ใช้กรอง jobs ตรง ๆ (มี customer_id/vehicle_type_id
  // อยู่แถวเดียวกันอยู่แล้ว) แทนที่จะเทียบด้วย code ผ่านการ embed ซึ่งซับซ้อนกว่า
  const customerId = useMemo(
    () => customers.data?.find((c) => c.code === customer)?.id,
    [customers.data, customer],
  )
  const vehicleTypeId = useMemo(
    () => vehicleTypes.data?.find((v) => v.code === vehicleType)?.id,
    [vehicleTypes.data, vehicleType],
  )

  // เลือกลูกค้าแล้วเปลี่ยนใจเลือกลูกค้าใหม่ — ประเภทรถ/เส้นทางที่เลือกไว้ก่อนหน้า
  // อาจไม่ใช่สิ่งที่ลูกค้าใหม่เคยใช้เลย ต้องล้างทิ้งไม่งั้นจะค้นด้วยเงื่อนไขที่เป็นไปไม่ได้
  // (ลูกค้า A + ประเภทรถที่ลูกค้า A ไม่เคยใช้) แบบไม่มีใครรู้ตัว
  useEffect(() => {
    setVehicleType('')
    setRoute('')
  }, [customer])
  useEffect(() => {
    setRoute('')
  }, [vehicleType])

  // ประเภทรถที่ลูกค้ารายนี้เคยใช้จริง — กรองไล่ต่อกันทั้งสาย (ลูกค้า → รถ → เส้นทาง)
  // ยังไม่เลือกลูกค้าก็โชว์ทุกประเภทเหมือนเดิม ไม่บังคับต้องเลือกลูกค้าก่อน
  const vtByCustomer = useQuery({
    queryKey: ['jobs-vehicle-types', customerId],
    enabled: !!customerId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // .limit() ชัดเจน กัน PostgREST ตัดที่ค่า default (1000 แถว) แบบเงียบ ๆ
      // ถ้าลูกค้ารายนี้มีประวัติงานเกิน 1000 เที่ยว — ตอนนี้ระบบมีงานรวมกันแค่ ~7,500
      // เที่ยว ตั้งเพดานสูงกว่านั้นไว้เผื่ออนาคต ดีกว่าปล่อยให้ default มาตัดโดยไม่รู้ตัว
      const { data, error } = await supabase
        .from('jobs')
        .select('vehicle_types(code, name)')
        .eq('customer_id', customerId as string)
        .limit(10_000)
      if (error) throw error
      const seen = new Map<string, ComboOption>()
      for (const row of data ?? []) {
        // supabase-js สรุปชนิดของ embed ต้นทาง-หนึ่ง เป็นอาเรย์เสมอในระดับ type
        // (ไม่รู้จาก FK ว่าเป็น to-one) แต่ runtime จริงคืนเป็นอ็อบเจกต์เดี่ยวหรือ null
        const raw = row.vehicle_types as unknown as
          | { code: string; name: string | null }
          | { code: string; name: string | null }[]
          | null
        const vt = Array.isArray(raw) ? raw[0] : raw
        if (vt && !seen.has(vt.code)) {
          seen.set(vt.code, { value: vt.code, label: vt.code, hint: vt.name ?? undefined })
        }
      }
      return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
    },
  })

  const vtOpts: ComboOption[] = useMemo(() => {
    if (customer && vtByCustomer.data) return vtByCustomer.data
    return (vehicleTypes.data ?? []).map((v) => ({
      value: v.code,
      label: v.code,
      hint: v.name ?? undefined,
    }))
  }, [customer, vtByCustomer.data, vehicleTypes.data])

  // เส้นทางที่เคยวิ่งจริงกับลูกค้า/ประเภทรถที่เลือกไว้ — ยังไม่เลือกอะไรเลยก็กลับไปใช้
  // รายการยอดนิยมทั้งระบบผ่าน search_routes() เหมือนเดิม
  const routeSuggestions = useQuery({
    queryKey: ['route_suggestions', customerId, vehicleTypeId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!customerId && !vehicleTypeId) {
        const { data, error } = await supabase.rpc('search_routes', { p_limit: 500 })
        if (error) throw error
        return (data ?? []) as RouteSuggestion[]
      }
      // .limit() เหตุผลเดียวกับ vtByCustomer ด้านบน — ไม่งั้นลูกค้าที่มีงานเกิน 1,000
      // เที่ยวจะได้อันดับเส้นทางที่นับจากแค่บางส่วนของประวัติจริงแบบไม่มีใครรู้ตัว
      let q = supabase
        .from('jobs')
        .select('route_raw')
        .not('route_raw', 'is', null)
        .limit(10_000)
      if (customerId) q = q.eq('customer_id', customerId)
      if (vehicleTypeId) q = q.eq('vehicle_type_id', vehicleTypeId)
      const { data, error } = await q
      if (error) throw error
      const counts = new Map<string, number>()
      for (const row of data ?? []) {
        const r = String(row.route_raw ?? '').trim()
        if (r) counts.set(r, (counts.get(r) ?? 0) + 1)
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 500)
        .map(([route_raw, job_count]) => ({ route_raw, job_count }))
    },
  })

  // เดิมจำกัดไว้ 25 แบบตายตัวและไม่มีทางเห็นว่ายังเหลืออีกเท่าไร — เปลี่ยนเป็น
  // โหลดเพิ่มได้แทน ตั้งแต่ 0019 ตัวกรองลูกค้า/ประเภทรถ (รหัสมาตรฐาน) ตัดคนไม่ตรง
  // เงื่อนไขออกจากผลลัพธ์เลย ส่วนเส้นทาง (พิมพ์อิสระ) ยังเป็นแค่จัดลำดับเหมือนเดิม
  // จำนวนที่เหลือให้โหลดเพิ่มจึงอาจน้อยกว่าจำนวนคนขับที่ผ่านสถานะทั้งระบบมาก
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

  // total_count มากับทุกแถวของ search_drivers() เท่ากันหมด (count(*) over ()) คือ
  // จำนวนคนที่ผ่านตัวกรองทั้งหมด ไม่ใช่แค่จำนวนแถวที่ส่งมาในหน้านี้ (หลัง limit)
  const totalCount = results.data?.[0]?.total_count ?? 0

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>หา พขร. เพื่อเข้ารับงาน</h1>
          <p>
            ระบุความต้องการของงาน ระบบจะตัดคนที่สถานะไม่พร้อมออกก่อน กันคนที่เคยมีปัญหาหรือได้คะแนนต่ำ
            ไว้ท้ายแถว แล้วเรียงคนที่เหลือตามผลงานที่เกี่ยวข้องกับงานนี้โดยเฉพาะ ไม่ใช่คะแนนรวมอย่างเดียว
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="filters-row">
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="cu">
              ลูกค้า
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
          <div style={{ flex: '1 1 180px' }}>
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
          <div style={{ flex: '2 1 240px' }}>
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
          ลูกค้า/ประเภทรถ: ถ้าระบุ จะตัดคนที่ไม่เคยมีประสบการณ์ตรงกับเงื่อนไขนั้นออกจาก
          ผลลัพธ์ไปเลย — เส้นทางเป็นแค่ตัวช่วยจัดลำดับ ไม่ตัดใครออก จุดฟ้าข้างชื่อช่องคือช่อง
          ที่ควรกรอกถัดไป แต่เว้นช่องไหนไว้ก็ได้ถ้าไม่ต้องการระบุ
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
          <div className="tablewrap fit-table">
            <table>
              <thead>
                <tr>
                  <th>อันดับ</th>
                  <th>พขร.</th>
                  <th>เบอร์โทร</th>
                  <th>จำนวนเที่ยวทั้งหมด</th>
                  {submitted?.customer && (
                    <th>
                      <ColHead label="จำนวนเที่ยวที่วิ่งให้กับลูกค้า" context={submitted.customer} />
                    </th>
                  )}
                  {submitted?.vehicleType && (
                    <th>
                      <ColHead label="จำนวนเที่ยวที่วิ่งประเภทรถ" context={submitted.vehicleType} />
                    </th>
                  )}
                  {submitted?.route.trim() && (
                    <th>
                      <ColHead label="จำนวนเที่ยวที่วิ่งเส้นทาง" context={submitted.route.trim()} />
                    </th>
                  )}
                  <th>คะแนนประเมิน</th>
                  <th>งานล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {results.data.length === 0 && (
                  <tr>
                    <td
                      // คอลัมน์พื้นฐาน 6 + คอลัมน์ตามตัวกรองที่ระบุ (0–3) — ตายตัวที่ 8 เดิม
                      // พอดีแค่ตอนระบุ 2 ช่อง นอกนั้นแถวว่างกว้างเกินหรือขาดไปหนึ่งช่อง
                      colSpan={
                        6 +
                        Number(!!submitted?.customer) +
                        Number(!!submitted?.vehicleType) +
                        Number(!!submitted?.route.trim())
                      }
                      className="empty"
                    >
                      ไม่พบคนขับที่เคยมีประสบการณ์ตรงกับเงื่อนไขที่ระบุ ลองลดเงื่อนไขบางช่องดู
                    </td>
                  </tr>
                )}
                {results.data.map((r, i) => (
                  <tr key={r.driver_id}>
                    <td className="num muted">{i + 1}</td>
                    <td className="nowrap">
                      <Link to={`/drivers/${r.driver_id}`} style={{ fontWeight: 500 }}>
                        {r.full_name}
                      </Link>
                    </td>
                    <td className="mono nowrap">{fmtPhone(r.phone)}</td>
                    <td className="num">{fmtNum(r.total_jobs)}</td>
                    {submitted?.customer && <td className="num">{fmtNum(r.customer_jobs)}</td>}
                    {submitted?.vehicleType && (
                      <td className="num">{fmtNum(r.vehicle_type_jobs)}</td>
                    )}
                    {submitted?.route.trim() && <td className="num">{fmtNum(r.route_jobs)}</td>}
                    <td className="num">
                      {r.rating_count > 0 ? (
                        <>
                          {fmtScore(r.adjusted_score)}
                          <span className="muted" style={{ fontSize: 11 }}>
                            {' '}
                            ({r.rating_count})
                          </span>
                        </>
                      ) : (
                        <span className="muted nowrap" style={{ fontSize: 12 }}>
                          ยังไม่ประเมิน
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

          {results.data.length < totalCount && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
                แสดง {fmtNum(results.data.length)} จาก {fmtNum(totalCount)} คน
              </p>
              <button
                className="btn btn-sm"
                disabled={results.isFetching}
                onClick={() => setLimit((l) => Math.min(l + 25, totalCount))}
              >
                {results.isFetching ? 'กำลังโหลด…' : 'โหลดเพิ่ม 25 คน'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}

/**
 * หัวคอลัมน์สองบรรทัด — บรรทัดบนเป็นชื่อคอลัมน์สั้นคงที่ บรรทัดล่างเป็นค่าที่ผู้ใช้
 * ระบุมา (ชื่อลูกค้า/ประเภทรถ/เส้นทาง) ซึ่งยาวไม่จำกัด
 *
 * เดิมยัดทุกอย่างไว้บรรทัดเดียว ("จำนวนเที่ยวที่วิ่งเส้นทาง ...") ความกว้างคอลัมน์
 * จึงถูกชื่อเส้นทางลากให้กว้างตามจนบีบคอลัมน์ชื่อ พขร. เหลือ 3 บรรทัดต่อคน
 * แยกบรรทัดแล้วตัดท้ายด้วย ellipsis ทำให้ความกว้างถูกกำหนดโดยป้ายสั้นแทน
 * ส่วนค่าเต็มยังอ่านได้จาก title ตอนชี้เมาส์
 */
function ColHead({ label, context }: { label: string; context: string }) {
  return (
    <>
      {label}
      <span className="col-head-sub" title={context}>
        {context}
      </span>
    </>
  )
}
