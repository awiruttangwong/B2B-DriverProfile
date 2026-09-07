import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { cleanManualRow, ingestRows, type RawRow } from '../lib/ingest'
import { normPhone, normText, splitRoute } from '../lib/normalize'
import type { Customer, DriverDirectoryRow, VehicleType } from '../types/database'
import { fmtMoney, fmtNum, localISODate } from '../lib/format'
import Combobox, { type ComboOption } from '../components/Combobox'

const EMPTY = {
  date: localISODate(),
  customer: '',
  vehicleType: '',
  plate: '',
  driverName: '',
  driverPhone: '',
  route: '',
  revenue: '',
  cost: '',
  note: '',
}

export default function NewJob() {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [form, setForm] = useState({ ...EMPTY })
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const allowed = can('admin', 'hr', 'ops')

  const customers = useQuery({
    queryKey: ['customers'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').order('code')
      if (error) throw error
      return (data ?? []) as Customer[]
    },
  })

  const vehicleTypes = useQuery({
    queryKey: ['vehicle_types'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_types').select('*').order('code')
      if (error) throw error
      return (data ?? []) as VehicleType[]
    },
  })

  // ---------------------------------------------- ตรวจว่ามี พขร. คนนี้อยู่แล้วไหม
  const phone = normPhone(form.driverPhone)
  const [debPhone, setDebPhone] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebPhone(phone), 350)
    return () => clearTimeout(t)
  }, [phone])

  const existing = useQuery({
    queryKey: ['driver-by-phone', debPhone],
    enabled: !!debPhone && debPhone.length >= 9,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_directory')
        .select('*')
        .eq('phone', debPhone)
        .limit(5)
      if (error) throw error
      return (data ?? []) as DriverDirectoryRow[]
    },
  })

  const customerOpts: ComboOption[] = useMemo(
    () => (customers.data ?? []).map((c) => ({ value: c.code, label: c.code })),
    [customers.data],
  )
  const vtOpts: ComboOption[] = useMemo(
    () => (vehicleTypes.data ?? []).map((v) => ({ value: v.code, label: v.code, hint: v.name ?? undefined })),
    [vehicleTypes.data],
  )

  // ---------------------------------------------- คำนวณสด
  const revenue = form.revenue === '' ? null : Number(form.revenue)
  const cost = form.cost === '' ? null : Number(form.cost)
  const margin = revenue !== null && cost !== null ? revenue - cost : null
  const marginPct = margin !== null && revenue ? (margin / revenue) * 100 : null

  const routeParts = splitRoute(normText(form.route))

  function set<K extends keyof typeof EMPTY>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }
  function blur(k: string) {
    setTouched((t) => ({ ...t, [k]: true }))
  }

  const nameErr = touched.driverName && !form.driverName.trim() ? 'ต้องระบุชื่อ พขร.' : null
  const phoneErr =
    touched.driverPhone && form.driverPhone.trim() && !phone
      ? 'เบอร์โทรต้องมี 9–10 หลัก'
      : touched.driverPhone && !form.driverPhone.trim()
        ? 'ต้องระบุเบอร์โทร'
        : null

  const ready = !!form.date && !!form.driverName.trim() && !!phone

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)

    try {
      // ใช้เส้นทางเดียวกับการอัปโหลดไฟล์ทุกประการ กติกาความสะอาดข้อมูล
      // และการกันซ้ำจึงเป็นชุดเดียวกันไม่ว่าข้อมูลจะเข้ามาทางไหน
      const raw: RawRow = {
        date: form.date,
        segment: 'B2B',
        customer: form.customer,
        vehicleType: form.vehicleType,
        plate: form.plate,
        driverName: form.driverName,
        driverPhone: form.driverPhone,
        route: form.route,
        revenue: form.revenue,
        cost: form.cost,
        note: form.note,
      }

      const { rows, invalid } = await cleanManualRow(raw)
      if (invalid.length > 0 || rows.length === 0) {
        setMsg({ kind: 'err', text: invalid[0]?.reason ?? 'ข้อมูลไม่ครบ' })
        return
      }

      const report = await ingestRows(rows, { filename: 'กรอกด้วยมือ' })

      if (report.errors.length > 0) {
        setMsg({ kind: 'err', text: report.errors[0] ?? 'บันทึกไม่สำเร็จ' })
      } else if (report.jobsInserted === 0) {
        setMsg({
          kind: 'err',
          text: 'งานนี้เคยบันทึกไว้แล้ว — วันที่ ลูกค้า ทะเบียน เบอร์ พขร. เส้นทาง และราคา ตรงกันทุกช่อง',
        })
      } else {
        setMsg({
          kind: 'ok',
          text:
            report.driversCreated > 0
              ? 'บันทึกงานแล้ว และสร้างโปรไฟล์ พขร. ใหม่ให้อัตโนมัติ'
              : 'บันทึกงานแล้ว ผูกเข้ากับโปรไฟล์ พขร. ที่มีอยู่',
        })
        // คงวันที่กับลูกค้าไว้ เพราะมักบันทึกหลายเที่ยวของลูกค้าเดิมในวันเดียวกัน
        setForm({ ...EMPTY, date: form.date, customer: form.customer })
        setTouched({})
        void qc.invalidateQueries({ queryKey: ['drivers'] })
        void qc.invalidateQueries({ queryKey: ['pending'] })
        void qc.invalidateQueries({ queryKey: ['pending-count'] })
        void qc.invalidateQueries({ queryKey: ['driver-kpis'] })
        // ไม่ทำแบบนี้จะโชว์ "ยังไม่มีเบอร์นี้ในระบบ" ค้างไปพักหนึ่งหลังเพิ่งสร้าง
        // พขร. ใหม่ เพราะแคชของเช็คก่อนหน้า (ตอนที่ยังไม่มี) ยังไม่หมดอายุ
        void qc.invalidateQueries({ queryKey: ['driver-by-phone'] })
      }
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>บันทึกงาน</h1>
          <p>
            กรอกทีละเที่ยวสำหรับงานที่ไม่ได้มาจากไฟล์ — ระบบจะจับคู่ พขร. จากเบอร์โทรกับชื่อ
            ถ้ายังไม่มีจะสร้างโปรไฟล์ให้อัตโนมัติ
          </p>
        </div>
      </div>

      {!allowed && (
        <div className="note-box err" style={{ marginBottom: 18 }}>
          บัญชีของคุณเป็นสิทธิ์อ่านอย่างเดียว จึงบันทึกงานไม่ได้
        </div>
      )}

      <form className="card card-pad" style={{ maxWidth: 780 }} onSubmit={(e) => void submit(e)}>
        {/* ------------------------------------------------ งาน */}
        <fieldset className="fs">
          <legend>รายละเอียดงาน</legend>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="d">
                วันที่<span className="req">*</span>
              </label>
              <input
                id="d"
                type="date"
                required
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="c">ลูกค้า / ประเภทงาน</label>
              <Combobox
                id="c"
                value={form.customer}
                onChange={(v) => set('customer', v)}
                options={customerOpts}
                placeholder="เลือกหรือพิมพ์ค้นหา"
                allowCreate
                createLabel={(v) => `เพิ่มลูกค้าใหม่: ${v.toUpperCase()}`}
                emptyText="ไม่พบลูกค้ารายนี้"
              />
              <div className="hint">มี {fmtNum(customerOpts.length)} รายในระบบ · พิมพ์ชื่อใหม่เพื่อเพิ่ม</div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="rt">เส้นทาง</label>
            <input
              id="rt"
              type="text"
              placeholder="ต้นทาง - ปลายทาง (เช่น คลังสุวินทวงศ์ - นครปฐม)"
              value={form.route}
              onChange={(e) => set('route', e.target.value)}
            />
            {routeParts.origin ? (
              <div className="hint" style={{ color: 'var(--brand-strong)' }}>
                แยกได้แล้ว — ต้นทาง <strong>{routeParts.origin}</strong> · ปลายทาง{' '}
                <strong>{routeParts.destination}</strong>
              </div>
            ) : (
              <div className="hint">
                คั่นด้วย “ - ” (เว้นวรรคหน้าหลัง) ระบบจะแยกต้นทางกับปลายทางให้เอง
                เพื่อใช้จัดอันดับตามความชำนาญเส้นทาง
              </div>
            )}
          </div>

          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="vt">ประเภทรถ</label>
              <Combobox
                id="vt"
                value={form.vehicleType}
                onChange={(v) => set('vehicleType', v)}
                options={vtOpts}
                placeholder="เลือกหรือพิมพ์ค้นหา"
                allowCreate
                createLabel={(v) => `เพิ่มประเภทรถใหม่: ${v}`}
                emptyText="ไม่พบประเภทรถนี้"
              />
            </div>
            <div className="field">
              <label htmlFor="pl">ทะเบียนรถ</label>
              <input
                id="pl"
                type="text"
                placeholder="เช่น 3ฒฒ8377"
                value={form.plate}
                onChange={(e) => set('plate', e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        {/* ------------------------------------------------ พขร. */}
        <fieldset className="fs">
          <legend>พนักงานขับรถ</legend>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="dn">
                ชื่อ พขร.<span className="req">*</span>
              </label>
              <input
                id="dn"
                type="text"
                required
                value={form.driverName}
                onChange={(e) => set('driverName', e.target.value)}
                onBlur={() => blur('driverName')}
                aria-invalid={!!nameErr}
              />
              {nameErr && <div className="hint err">{nameErr}</div>}
            </div>
            <div className="field">
              <label htmlFor="dp">
                เบอร์โทร พขร.<span className="req">*</span>
              </label>
              <input
                id="dp"
                type="tel"
                inputMode="numeric"
                required
                placeholder="0812345678"
                value={form.driverPhone}
                onChange={(e) => set('driverPhone', e.target.value)}
                onBlur={() => blur('driverPhone')}
                aria-invalid={!!phoneErr}
              />
              {phoneErr ? (
                <div className="hint err">{phoneErr}</div>
              ) : (
                <div className="hint">ใส่ขีดหรือไม่ใส่ก็ได้ ระบบตัดให้เอง</div>
              )}
            </div>
          </div>

          {/* บอกล่วงหน้าว่าจะผูกกับคนเดิมหรือสร้างคนใหม่ ก่อนกดบันทึก */}
          {debPhone && debPhone.length >= 9 && (
            <div
              className={`note-box ${(existing.data?.length ?? 0) > 0 ? 'ok' : ''}`}
              style={{ marginBottom: 14 }}
            >
              {existing.isLoading ? (
                <>
                  <span className="spinner" /> กำลังตรวจ…
                </>
              ) : (existing.data?.length ?? 0) > 0 ? (
                <>
                  <strong>พบเบอร์นี้ในระบบแล้ว</strong>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {(existing.data ?? []).map((d) => (
                      <li key={d.id} style={{ fontSize: 13.5 }}>
                        <Link to={`/drivers/${d.id}`}>{d.full_name}</Link>{' '}
                        <span className="muted">
                          · {d.driver_code} · {fmtNum(d.total_jobs)} เที่ยว
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="hint" style={{ marginTop: 6 }}>
                    ถ้าชื่อที่กรอกใกล้เคียงกับชื่อข้างบน ระบบจะผูกเข้ากับคนเดิม
                    ถ้าต่างกันชัดเจนจะถือว่าเป็นคนละคนที่ใช้เบอร์เดียวกัน
                  </div>
                </>
              ) : (
                <>
                  <strong>ยังไม่มีเบอร์นี้ในระบบ</strong> — จะสร้างโปรไฟล์ พขร. ใหม่ให้อัตโนมัติ
                </>
              )}
            </div>
          )}
        </fieldset>

        {/* ------------------------------------------------ ราคา */}
        <fieldset className="fs">
          <legend>ค่าขนส่ง</legend>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="rv">ราคารับ (บาท)</label>
              <input
                id="rv"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={form.revenue}
                onChange={(e) => set('revenue', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="cs">ราคาจ่าย (บาท)</label>
              <input
                id="cs"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={form.cost}
                onChange={(e) => set('cost', e.target.value)}
              />
            </div>
          </div>

          {margin !== null && (
            <div className="calc" style={{ marginBottom: 14 }}>
              <div className="c-item">
                <span className="c-lbl">ส่วนต่าง</span>
                <span className={`c-val ${margin < 0 ? 'neg' : margin > 0 ? 'pos' : ''}`}>
                  {margin < 0 ? '−' : ''}
                  {fmtMoney(Math.abs(margin))}
                </span>
              </div>
              {marginPct !== null && (
                <div className="c-item">
                  <span className="c-lbl">กำไร</span>
                  <span className={`c-val ${margin < 0 ? 'neg' : margin > 0 ? 'pos' : ''}`}>
                    {marginPct.toFixed(1)}%
                  </span>
                </div>
              )}
              <div className="c-item">
                <span className="c-lbl">ยอดหัก 1% ของราคาจ่าย</span>
                <span className="c-val">{cost !== null ? fmtMoney(Math.round(cost / 100)) : '—'}</span>
              </div>
              {margin < 0 && (
                <div
                  className="c-item"
                  style={{ justifyContent: 'center', color: 'var(--bad)', fontSize: 13 }}
                >
                  ราคาจ่ายสูงกว่าราคารับ — ตรวจอีกครั้งว่ากรอกสลับกันหรือไม่
                </div>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="nt">หมายเหตุ</label>
            <input
              id="nt"
              type="text"
              placeholder="เช่น มีเอกสาร · น้ำหนัก 2,982 กก. · เหมา"
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </div>
        </fieldset>

        {msg && (
          <div className={`note-box ${msg.kind === 'err' ? 'err' : 'ok'}`} style={{ marginBottom: 14 }}>
            {msg.text}
            {msg.kind === 'ok' && (
              <>
                {' '}
                <Link to="/pending">ไปให้คะแนนงานที่ค้าง →</Link>
              </>
            )}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            <span className="req">*</span> จำเป็นต้องกรอก
          </span>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setForm({ ...EMPTY })
                setTouched({})
                setMsg(null)
              }}
            >
              ล้างฟอร์ม
            </button>
            <button className="btn btn-primary" disabled={busy || !allowed || !ready}>
              {busy ? 'กำลังบันทึก…' : 'บันทึกงาน'}
            </button>
          </div>
        </div>
      </form>
    </main>
  )
}
