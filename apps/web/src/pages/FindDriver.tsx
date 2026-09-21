import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Customer, DriverFitRow, VehicleType } from '../types/database'
import { fmtDateShort, fmtNum, fmtPhone } from '../lib/format'
import Combobox, { type ComboOption } from '../components/Combobox'
import ScoreCell from '../components/ScoreCell'
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
  const inputRef = useRef<HTMLInputElement>(null)

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
  const showClear = value.length > 0

  return (
    <div className={`route-field combo${showClear ? ' combo-has-clear' : ''}`} ref={wrapRef}>
      <input
        id="rt"
        ref={inputRef}
        type="text"
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

      {showClear && (
        <button
          type="button"
          className="combo-clear"
          tabIndex={-1}
          aria-label="ล้างค่าที่เลือก"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('')
            setOpen(false)
            inputRef.current?.focus()
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}

      <button
        type="button"
        className="combo-toggle"
        tabIndex={-1}
        aria-label={open ? 'ปิดรายการ' : 'เปิดรายการ'}
        onClick={() => {
          setOpen((prev) => !prev)
          inputRef.current?.focus()
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

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
  const [routeStrict, setRouteStrict] = useState(false)
  // ลูกค้ากับประเภทรถกรองเข้มอยู่แล้วเป็นค่าเริ่มต้น (ต่างจากเส้นทาง) — ติ๊กออกคือเปลี่ยน
  // เป็นแค่จัดลำดับ
  const [customerStrict, setCustomerStrict] = useState(true)
  const [vehicleTypeStrict, setVehicleTypeStrict] = useState(true)
  const [submitted, setSubmitted] = useState<{
    customer: string
    vehicleType: string
    route: string
    routeStrict: boolean
    customerStrict: boolean
    vehicleTypeStrict: boolean
  } | null>(null)

  // ล้างช่องแล้วสวิตช์ของช่องนั้นต้องกลับเป็นค่าเริ่มต้นด้วย — สวิตช์ซ่อนอยู่ตอนช่องว่าง
  // ถ้าปล่อยค้างเป็นปิดไว้ มันยังแอบกำหนดการแคบตัวเลือกของอีกช่องอยู่โดยผู้ใช้มองไม่เห็น
  // (เส้นทางไม่ทำแบบนี้ เพราะพิมพ์ลบแล้วพิมพ์ใหม่เป็นเรื่องปกติ ไม่ควรต้องติ๊กซ้ำทุกครั้ง)
  const changeCustomer = (v: string) => {
    setCustomer(v)
    if (!v) setCustomerStrict(true)
  }
  const changeVehicleType = (v: string) => {
    setVehicleType(v)
    if (!v) setVehicleTypeStrict(true)
  }

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

  // คู่ (ลูกค้า, ประเภทรถ) ที่เคยมีงานจริง — ใช้แคบตัวเลือกของสองช่องนี้หากันได้ทั้งสองทาง
  // (โหลดไม่สำเร็จหรือไม่มีแถวเลย = ไม่มีข้อมูลให้แคบ ใช้รายการเต็ม ไม่แคบจนช่องว่างเปล่า)
  // เลือกช่องไหนก่อนก็ได้ ค่าที่เลือกไว้แล้วจึงไม่ต้องถูกล้างเวลาเปลี่ยนอีกช่อง: ตัวเลือก
  // ของช่องหนึ่งถูกกรองด้วยค่าของอีกช่องอยู่แล้ว ค่าที่เลือกได้จึงเป็นคู่ที่มีงานจริงเสมอ
  // (ทั้งก้อนมีไม่กี่ร้อยแถว ดึงครั้งเดียวแล้วคำนวณในเครื่อง ไม่ต้องยิงใหม่ทุกครั้งที่เลือก)
  //
  // แคบเฉพาะตอนที่ทั้งสองช่องเป็นโหมดกรองเข้ม: ช่องที่ปิดติ๊กแปลว่า "ใครก็ได้ แค่ขอคนที่
  // เคยวิ่งค่านี้ขึ้นก่อน" ไม่ได้ต้องการให้ค่านั้นมีงานคู่กับอีกช่องจริง ถ้ายังแคบอยู่
  // จะเลือกคู่ที่ไม่เคยมีงานร่วมกัน (เช่น ขอเรียงลูกค้า X ก่อน แต่กรองรถประเภทที่ X ไม่เคยใช้)
  // ไม่ได้ ทั้งที่เป็นสิ่งที่โหมดจัดลำดับมีไว้ให้ทำ
  const narrowByPairs = customerStrict && vehicleTypeStrict
  const pairs = useQuery({
    queryKey: ['job-customer-vehicle-pairs'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_customer_vehicle_pairs')
        .select('*')
        .limit(5000)
      if (error) throw error
      return (data ?? []) as {
        customer_code: string
        vehicle_type_code: string
        vehicle_type_name: string | null
      }[]
    },
  })

  // ยังไม่เลือกประเภทรถก็โชว์ทุกลูกค้า — ไม่บังคับต้องเลือกช่องไหนก่อน
  const customerOpts: ComboOption[] = useMemo(() => {
    const allowed =
      narrowByPairs && vehicleType && pairs.data?.length
        ? new Set(pairs.data.filter((p) => p.vehicle_type_code === vehicleType).map((p) => p.customer_code))
        : null
    return (customers.data ?? [])
      .filter((c) => !allowed || allowed.has(c.code))
      .map((c) => ({ value: c.code, label: c.code }))
  }, [customers.data, pairs.data, vehicleType, narrowByPairs])

  const vtOpts: ComboOption[] = useMemo(() => {
    if (narrowByPairs && customer && pairs.data?.length) {
      const seen = new Map<string, ComboOption>()
      for (const p of pairs.data) {
        if (p.customer_code === customer && !seen.has(p.vehicle_type_code)) {
          seen.set(p.vehicle_type_code, {
            value: p.vehicle_type_code,
            label: p.vehicle_type_code,
            hint: p.vehicle_type_name ?? undefined,
          })
        }
      }
      return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
    }
    return (vehicleTypes.data ?? []).map((v) => ({
      value: v.code,
      label: v.code,
      hint: v.name ?? undefined,
    }))
  }, [customer, pairs.data, vehicleTypes.data, narrowByPairs])

  // เส้นทางที่เคยวิ่งจริงกับลูกค้า/ประเภทรถที่เลือกไว้ — ยังไม่เลือกอะไรเลยก็กลับไปใช้
  // รายการยอดนิยมทั้งระบบผ่าน search_routes() เหมือนเดิม — ช่องที่ปิดติ๊ก (จัดลำดับ) ไม่นำมา
  // จำกัดรายการ เหตุผลเดียวกับการแคบตัวเลือกด้านบน
  const sugCustomerId = customerStrict ? customerId : undefined
  const sugVehicleTypeId = vehicleTypeStrict ? vehicleTypeId : undefined
  const routeSuggestions = useQuery({
    queryKey: ['route_suggestions', sugCustomerId, sugVehicleTypeId],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!sugCustomerId && !sugVehicleTypeId) {
        const { data, error } = await supabase.rpc('search_routes', { p_limit: 500 })
        if (error) throw error
        return (data ?? []) as RouteSuggestion[]
      }
      // .limit() ชัดเจน กัน PostgREST ตัดที่ค่า default (1000 แถว) แบบเงียบ ๆ — ไม่งั้น
      // ลูกค้าที่มีงานเกิน 1,000 เที่ยวจะได้อันดับเส้นทางที่นับจากแค่บางส่วนของประวัติจริง
      let q = supabase
        .from('jobs')
        .select('route_raw')
        .not('route_raw', 'is', null)
        .limit(10_000)
      if (sugCustomerId) q = q.eq('customer_id', sugCustomerId)
      if (sugVehicleTypeId) q = q.eq('vehicle_type_id', sugVehicleTypeId)
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
  // โหลดเพิ่มได้แทน ตัวกรองลูกค้า/ประเภทรถ (รหัสมาตรฐาน) ตัดคนไม่ตรงเงื่อนไขออกจากผลลัพธ์
  // เป็นค่าเริ่มต้น (ปิดติ๊กแล้วเป็นแค่จัดลำดับ) ส่วนเส้นทาง (พิมพ์อิสระ) เริ่มที่จัดลำดับ
  // อย่างเดียว (เปิดติ๊กแล้วกรองเข้ม) จำนวนที่เหลือให้โหลดเพิ่มจึงอาจน้อยกว่าจำนวนคนขับ
  // ที่ผ่านสถานะทั้งระบบมาก
  const [limit, setLimit] = useState(25)

  const results = useQuery({
    queryKey: ['fit', submitted, limit],
    enabled: !!submitted,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_drivers', {
        p_customer_code: submitted?.customer || null,
        p_vehicle_type_code: submitted?.vehicleType || null,
        p_route_keyword: submitted?.route.trim() || null,
        p_route_strict: submitted?.routeStrict ?? false,
        // ส่งเฉพาะตอนปิดติ๊ก (ค่าที่ต่างจากค่าเริ่มต้นของฟังก์ชัน) — การค้นแบบปกติจึงไม่ต้อง
        // พึ่งพารามิเตอร์ใหม่ ยังทำงานได้แม้ฐานข้อมูลยังไม่ได้รัน migration 0024/0025
        ...(submitted?.customerStrict === false ? { p_customer_strict: false } : {}),
        ...(submitted?.vehicleTypeStrict === false ? { p_vehicle_type_strict: false } : {}),
        p_limit: limit,
      })
      if (error) throw error
      return (data ?? []) as DriverFitRow[]
    },
  })

  // total_count มากับทุกแถวของ search_drivers() เท่ากันหมด (count(*) over ()) คือ
  // จำนวนคนที่ผ่านตัวกรองทั้งหมด ไม่ใช่แค่จำนวนแถวที่ส่งมาในหน้านี้ (หลัง limit)
  const totalCount = results.data?.[0]?.total_count ?? 0

  // ไม่ได้เลือกประเภทรถ = ผลรวมทุกประเภทไว้ด้วยกัน จึงแสดงต่อท้ายแถวว่าแต่ละคนวิ่งรถอะไร
  // (ระบุประเภทรถแล้วมีคอลัมน์จำนวนเที่ยวของประเภทนั้นอยู่แล้ว) ซ่อนเองถ้าฐานข้อมูลยังไม่ได้
  // รัน migration 0027 (ไม่มีฟิลด์ส่งมา) แทนที่จะโชว์คอลัมน์ว่างทั้งตาราง
  const showVehicleTypes =
    !submitted?.vehicleType && !!results.data?.some((r) => Array.isArray(r.vehicle_types))
  const vehicleTypeNames = useMemo(
    () => new Map((vehicleTypes.data ?? []).map((v) => [v.code, v.name])),
    [vehicleTypes.data],
  )

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
            <div className="filter-label-row">
              <label htmlFor="cu">
                ลูกค้า
                {activeStep === 1 && <span className="step-dot" aria-hidden="true" />}
              </label>
              {customer && (
                <label className="strict-switch">
                  <input
                    type="checkbox"
                    checked={customerStrict}
                    onChange={(e) => setCustomerStrict(e.target.checked)}
                  />
                  เฉพาะคนที่เคยวิ่งให้ลูกค้ารายนี้
                </label>
              )}
            </div>
            <Combobox
              id="cu"
              value={customer}
              onChange={changeCustomer}
              options={customerOpts}
              placeholder="ไม่ระบุ — พิมพ์ค้นหา"
              emptyText="ไม่พบลูกค้ารายนี้"
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <div className="filter-label-row">
              <label htmlFor="vt">
                ประเภทรถ
                {activeStep === 2 && <span className="step-dot" aria-hidden="true" />}
              </label>
              {vehicleType && (
                <label className="strict-switch">
                  <input
                    type="checkbox"
                    checked={vehicleTypeStrict}
                    onChange={(e) => setVehicleTypeStrict(e.target.checked)}
                  />
                  เฉพาะคนที่เคยวิ่งประเภทรถนี้
                </label>
              )}
            </div>
            <Combobox
              id="vt"
              value={vehicleType}
              onChange={changeVehicleType}
              options={vtOpts}
              placeholder="ไม่ระบุ — พิมพ์ค้นหา"
              emptyText="ไม่พบประเภทรถนี้"
            />
          </div>
          <div style={{ flex: '2 1 240px' }}>
            <div className="filter-label-row">
              <label htmlFor="rt">
                เส้นทาง
                {activeStep === 3 && <span className="step-dot" aria-hidden="true" />}
              </label>
              {route.trim() && (
                <label className="strict-switch">
                  <input
                    type="checkbox"
                    checked={routeStrict}
                    onChange={(e) => setRouteStrict(e.target.checked)}
                  />
                  เฉพาะคนที่เคยวิ่งเส้นทางนี้
                </label>
              )}
            </div>
            <RouteField value={route} onChange={setRoute} suggestions={routeSuggestions.data ?? []} />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setLimit(25)
              // สวิตช์มีผลเฉพาะตอนมีเส้นทางพิมพ์อยู่ — ล้างเส้นทางทิ้งแล้วค่าที่ค้างไว้ไม่ควรตามไป
              setSubmitted({
                customer,
                vehicleType,
                route,
                routeStrict: routeStrict && !!route.trim(),
                customerStrict: customerStrict || !customer,
                vehicleTypeStrict: vehicleTypeStrict || !vehicleType,
              })
            }}
          >
            ค้นหา
          </button>
        </div>

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
                  setSubmitted({
                    customer: '',
                    vehicleType: '',
                    route: '',
                    routeStrict: false,
                    customerStrict: true,
                    vehicleTypeStrict: true,
                  })
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
                  {showVehicleTypes && (
                    <th className="col-vt">
                      {/* หัวบอกชัดว่าป้ายนับจากอะไร — ตรงกับที่ฐานข้อมูลนับ (0027): มีลูกค้านับตาม
                          ลูกค้า ไม่มีลูกค้าแต่มีเส้นทางนับตามเส้นทาง ไม่มีทั้งคู่นับทุกเที่ยว */}
                      {submitted?.customer ? (
                        <ColHead label="ประเภทรถที่เคยวิ่งให้กับลูกค้า" context={submitted.customer} />
                      ) : submitted?.route.trim() ? (
                        <ColHead label="ประเภทรถที่เคยวิ่งเส้นทาง" context={submitted.route.trim()} />
                      ) : (
                        <ColHead label="ประเภทรถที่เคยวิ่ง" context="ทุกเที่ยว" />
                      )}
                    </th>
                  )}
                  <th className="col-score">คะแนนประเมิน</th>
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
                        Number(!!submitted?.route.trim()) +
                        Number(showVehicleTypes)
                      }
                      className="empty"
                    >
                      ไม่พบคนขับที่เคยมีประสบการณ์ตรงกับเงื่อนไขที่ระบุ ลองลดเงื่อนไขบางช่องดู
                      {submitted?.routeStrict && ' หรือปิดสวิตช์ “เฉพาะคนที่เคยวิ่งเส้นทางนี้”'}
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
                    {showVehicleTypes && (
                      <td className="col-vt">
                        <VehicleTypeChips types={r.vehicle_types ?? []} names={vehicleTypeNames} />
                      </td>
                    )}
                    <td className="col-score">
                      <ScoreCell score={r.adjusted_score} count={r.rating_count} />
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

const VT_CHIPS_SHOWN = 3

/**
 * ป้ายประเภทรถของ พขร. หนึ่งคน (เรียงเที่ยวมาก→น้อยมาจากฐานข้อมูลแล้ว) — โชว์ 3 ประเภทแรก
 * ที่เหลือรวมเป็น "+N" ชี้เมาส์ดูครบได้ คงความสูงแถวให้เท่ากันทุกแถว
 * ไม่มีข้อมูล (ไม่เคยวิ่งเที่ยวที่ตรงเงื่อนไข) แสดง "—" ไม่ปล่อยช่องว่างเปล่า
 */
function VehicleTypeChips({
  types,
  names,
}: {
  types: { code: string; jobs: number }[]
  names: Map<string, string | null>
}) {
  if (types.length === 0) return <span className="muted">—</span>
  const label = (t: { code: string; jobs: number }) => {
    const name = names.get(t.code)
    return `${t.code}${name && name !== t.code ? ` (${name})` : ''} · ${fmtNum(t.jobs)} เที่ยว`
  }
  const shown = types.slice(0, VT_CHIPS_SHOWN)
  const rest = types.slice(VT_CHIPS_SHOWN)
  return (
    <span className="vt-chips">
      {shown.map((t) => (
        <span key={t.code} className="vt-chip" title={label(t)}>
          <span className="vt-chip-code">{t.code}</span>
          <span className="vt-chip-n">{fmtNum(t.jobs)}</span>
        </span>
      ))}
      {rest.length > 0 && (
        <span className="vt-chip vt-chip-more" title={rest.map(label).join('\n')}>
          +{rest.length}
        </span>
      )}
    </span>
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
