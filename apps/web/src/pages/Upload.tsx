import { useMemo, useState, type ChangeEvent } from 'react'
import { useAuth } from '../lib/auth'
import {
  cleanSheets,
  ingestRows,
  isUsableRow,
  type CleanResult,
  type CleanRow,
  type IngestReport,
  type SourceSheet,
} from '../lib/ingest'
import {
  FIELD_LABEL,
  PROFILE_LABEL,
  REQUIRED_FIELDS,
  scanSheets,
  type Field,
  type SheetScan,
} from '../lib/sourceProfiles'
import { fmtDateShort, fmtMoney, fmtNum } from '../lib/format'

type Stage = 'idle' | 'reading' | 'preview' | 'importing' | 'done'

/** คอลัมน์ที่อยากให้ผู้ใช้เห็นว่าจับคู่ได้หรือไม่ ไม่ต้องโชว์ครบทุกฟิลด์ */
const SHOWN_FIELDS: Field[] = [
  'date',
  'driverName',
  'driverPhone',
  'seq',
  'customer',
  'vehicleType',
  'plate',
  'route',
  'revenue',
  'cost',
  'note',
]

export default function Upload() {
  const { can } = useAuth()
  const [stage, setStage] = useState<Stage>('idle')
  const [filename, setFilename] = useState('')
  const [scans, setScans] = useState<SheetScan[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [clean, setClean] = useState<CleanResult | null>(null)
  const [progress, setProgress] = useState({ pct: 0, label: '' })
  const [report, setReport] = useState<IngestReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const allowed = can('admin', 'hr', 'ops')

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setStage('reading')
    setError(null)
    setReport(null)
    setClean(null)

    try {
      // โหลด SheetJS ตอนใช้จริงเท่านั้น ไม่ถ่วงหน้าแรก
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      // cellDates: false + raw: true ทำให้วันที่มาเป็นเลข serial ของ Excel
      // และตัวเลขมาเป็น number ซึ่งแปลงได้โดยไม่ผ่านเขตเวลาและไม่ผ่านรูปแบบการแสดงผล
      // ถ้าปล่อยให้เป็นสตริงตามรูปแบบในไฟล์ วันที่จะเลื่อนไป 1 วันในเขตเวลา UTC+7
      const wb = XLSX.read(buf, { cellDates: false })
      if (wb.SheetNames.length === 0) throw new Error('ไม่พบชีตในไฟล์นี้')

      // อ่านเป็นตารางดิบ (array of array) ไม่ใช่ object เพราะต้องหาแถวหัวตารางเอง
      // และหัวตารางซ้ำกันในไฟล์จริง ถ้าให้ SheetJS แปลงเป็น object คอลัมน์จะหาย
      const found = scanSheets(
        wb.SheetNames,
        (name) => {
          const ws = wb.Sheets[name]
          if (!ws) return []
          return XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            defval: null,
            raw: true,
            blankrows: true,
          })
        },
        isUsableRow,
      )

      const usable = found.filter((s) => s.status === 'ok')
      if (usable.length === 0) {
        const detail = found.map((s) => `${s.name}: ${s.reason ?? 'ไม่ทราบสาเหตุ'}`).join(' · ')
        throw new Error(
          `ไม่มีชีตไหนในไฟล์นี้ที่นำเข้าได้ — ต้องมีคอลัมน์ ` +
            `${REQUIRED_FIELDS.map((f) => FIELD_LABEL[f]).join(' · ')} อย่างน้อย (${detail})`,
        )
      }

      const initial = new Set(usable.map((s) => s.name))
      setFilename(file.name)
      setScans(found)
      setPicked(initial)
      setStage('preview')
      // ทำความสะอาดต่อทันที ผู้ใช้จะได้เห็นตัวเลขจริงโดยไม่ต้องกดอีกปุ่ม
      void recompute(initial, found)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('idle')
    } finally {
      e.target.value = ''
    }
  }

  /**
   * ทำความสะอาดใหม่ทุกครั้งที่เปลี่ยนชีตที่เลือก เพราะการนับเที่ยวซ้ำขึ้นกับชุดชีต
   *
   * รับ scanList เข้ามาได้ เพราะตอนเรียกครั้งแรกหลังอ่านไฟล์เสร็จ state ยังไม่ถูกอัปเดต
   */
  async function recompute(next: Set<string>, scanList: SheetScan[] = scans) {
    setBusy(true)
    setClean(null)
    try {
      const sheets: SourceSheet[] = scanList
        .filter((s) => next.has(s.name) && s.status === 'ok')
        .map((s) => ({ name: s.name, columns: s.columns, rows: s.rows }))
      setClean(sheets.length ? await cleanSheets(sheets) : null)
    } finally {
      setBusy(false)
    }
  }

  function toggle(name: string) {
    const next = new Set(picked)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setPicked(next)
    void recompute(next)
  }

  async function runImport() {
    const rows = clean?.rows
    if (!rows?.length) return
    setStage('importing')
    setProgress({ pct: 0, label: 'เริ่มนำเข้า' })
    try {
      const r = await ingestRows(rows, {
        filename,
        sheetName: [...picked].join(', '),
        onProgress: (pct, label) => setProgress({ pct, label }),
      })
      setReport(r)
      setStage('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('preview')
    }
  }

  // ตัวเลขสรุปคำนวณจากผลการทำความสะอาดจริง ไม่ใช่ประมาณจากจำนวนแถว
  const summary = useMemo(() => {
    const rows = clean?.rows ?? []
    if (rows.length === 0) return null
    let from = rows[0]!.date
    let to = rows[0]!.date
    const drivers = new Set<string>()
    const customers = new Set<string>()
    for (const r of rows) {
      if (r.date < from) from = r.date
      if (r.date > to) to = r.date
      drivers.add(`${r.driverPhone}|${r.driverName}`)
      if (r.customer) customers.add(r.customer)
    }
    return { from, to, drivers: drivers.size, customers: customers.size }
  }, [clean])

  const rows: CleanRow[] = clean?.rows ?? []

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>อัปโหลดไฟล์ข้อมูลงาน</h1>
          <p>
            ระบบอ่านหัวตารางเองทั้งแบบ ALLMANUAL, EXPRESS และ MASTER
            ไฟล์ที่มีหลายชีตจะถูกสแกนทีละชีตแล้วให้เลือกว่าจะนำเข้าชีตไหน
            เที่ยวที่เคยนำเข้าไปแล้วจะถูกข้ามอัตโนมัติ อัปโหลดไฟล์เดิมซ้ำจึงไม่ทำให้ข้อมูลซ้ำ
          </p>
        </div>
      </div>

      {!allowed && (
        <div className="note-box err" style={{ marginBottom: 18 }}>
          บัญชีของคุณเป็นสิทธิ์อ่านอย่างเดียว จึงอัปโหลดไม่ได้ — ให้ผู้ดูแลเลื่อนสิทธิ์เป็น ops ก่อน
        </div>
      )}

      {error && (
        <div className="note-box err" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}

      {/* -------------------------------------------------- เลือกไฟล์ */}
      {(stage === 'idle' || stage === 'reading') && (
        <div className="card card-pad">
          <label htmlFor="file">เลือกไฟล์ .xlsx หรือ .xls</label>
          <input
            id="file"
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!allowed || stage === 'reading'}
            onChange={(e) => void onPick(e)}
            style={{ padding: 8 }}
          />
          {stage === 'reading' && (
            <p className="hint">
              <span className="spinner" /> กำลังอ่านและสแกนทุกชีต…
            </p>
          )}
          <div className="note-box" style={{ marginTop: 16 }}>
            <strong>ต้องมีอย่างน้อย</strong> —{' '}
            {REQUIRED_FIELDS.map((f) => FIELD_LABEL[f]).join(' · ')}
            <br />
            คอลัมน์อื่นระบบจะอ่านให้ถ้ามี และรับได้หลายชื่อ เช่น ราคารับ/ราคาวางบิล ·
            ราคาจ่าย/ค่าเที่ยว พขร. · เส้นทาง (Route)/เส้นทาง / ดรอป / จำนวนลัง ·
            ชื่อพขร/ชื่อ พขร.
          </div>
        </div>
      )}

      {/* -------------------------------------------------- เลือกชีต + ตรวจ */}
      {stage === 'preview' && (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h2>ชีตในไฟล์นี้</h2>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {filename}
              </span>
            </div>
            <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>นำเข้า</th>
                    <th>ชีต</th>
                    <th>รูปแบบ</th>
                    <th className="right">แถวทั้งหมด</th>
                    <th className="right">แถวที่ใช้ได้</th>
                    <th>คอลัมน์ที่จับคู่ได้</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => (
                    <tr key={s.name} style={s.status === 'ok' ? undefined : { opacity: 0.62 }}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`นำเข้าชีต ${s.name}`}
                          checked={picked.has(s.name)}
                          disabled={s.status !== 'ok' || busy}
                          onChange={() => toggle(s.name)}
                        />
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{s.name}</div>
                        {s.reason && (
                          <div className="muted" style={{ fontSize: 11.5 }}>
                            {s.reason}
                          </div>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            s.status === 'ok' ? 'ok' : s.status === 'empty' ? 'warn' : ''
                          }`}
                        >
                          {s.status === 'unreadable' ? 'อ่านไม่ได้' : PROFILE_LABEL[s.profile]}
                        </span>
                        {s.headerRow > 0 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            หัวตารางแถวที่ {s.headerRow + 1}
                          </div>
                        )}
                      </td>
                      <td className="right num">{fmtNum(s.totalRows)}</td>
                      <td className="right num">{fmtNum(s.usableRows)}</td>
                      <td style={{ fontSize: 11.5, lineHeight: 1.7, minWidth: 240 }}>
                        {s.status === 'unreadable'
                          ? '—'
                          : SHOWN_FIELDS.filter((f) => s.columns[f] !== undefined)
                              .map((f) => FIELD_LABEL[f])
                              .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-pad">
              <p className="hint" style={{ margin: 0 }}>
                ชีตที่เนื้อหาทับกันเลือกพร้อมกันได้ — ระบบจะรวมเป็นเที่ยวเดียว ไม่นับซ้ำ
              </p>
            </div>
          </div>

          {busy && (
            <div className="card card-pad" style={{ marginBottom: 18 }}>
              <span className="spinner" /> กำลังทำความสะอาดข้อมูล…
            </div>
          )}

          {!busy && !clean && picked.size > 0 && (
            <div className="card card-pad" style={{ marginBottom: 18 }}>
              <button className="btn btn-primary" onClick={() => void recompute(picked)}>
                ตรวจสอบ {picked.size} ชีตที่เลือก
              </button>
            </div>
          )}

          {clean && summary && (
            <>
              <div className="card" style={{ marginBottom: 18 }}>
                <div className="card-head">
                  <h2>ตรวจสอบก่อนนำเข้า</h2>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {[...picked].join(' + ')}
                  </span>
                </div>
                <div className="stats">
                  <div className="stat">
                    <div className="v num">{fmtNum(rows.length)}</div>
                    <div className="l">เที่ยวที่พร้อมนำเข้า</div>
                  </div>
                  <div className="stat">
                    <div className="v num">{fmtNum(summary.drivers)}</div>
                    {/* นับคู่ ชื่อ+เบอร์ ที่ต่างกัน ไม่ใช่จำนวนคน — ชื่อที่สะกดคล้ายกันบนเบอร์
                        เดียวกันจะถูกรวมเป็นคนเดียวตอนนำเข้า ตัวเลขจริงจึงน้อยกว่านี้ */}
                    <div className="l">ชื่อ+เบอร์ ที่ต่างกัน</div>
                  </div>
                  <div className="stat">
                    <div className="v num">{fmtNum(summary.customers)}</div>
                    <div className="l">ลูกค้าในไฟล์</div>
                  </div>
                  <div className="stat">
                    <div className="v" style={{ fontSize: 14 }}>
                      {fmtDateShort(summary.from)} – {fmtDateShort(summary.to)}
                    </div>
                    <div className="l">ช่วงวันที่</div>
                  </div>
                </div>

                <div className="card-pad">
                  <table style={{ minWidth: 0 }}>
                    <tbody>
                      <Row
                        label="แถวที่บันทึกซ้ำ (ชีตเดียวกันหรือข้ามชีต) — นับเป็นเที่ยวเดียว"
                        value={fmtNum(clean.collapsedAcrossSheets)}
                      />
                      <Row
                        label="เที่ยวซ้ำเส้นทาง/ราคาเดิมในวันเดียวกัน — แยกด้วยลำดับงาน"
                        value={fmtNum(clean.repeatTrips)}
                      />
                      <Row
                        label="ลำดับงานเดียวกันแต่ราคาต่างกัน — น่าจะเป็นค่าใช้จ่ายเพิ่มของงานเดิม"
                        value={fmtNum(clean.surchargeLines.length)}
                      />
                      <Row
                        label="แถวที่ข้ามเพราะข้อมูลไม่ครบ"
                        value={fmtNum(clean.invalid.length)}
                      />
                    </tbody>
                  </table>

                  {clean.surchargeLines.length > 0 && (
                    <div className="note-box" style={{ marginTop: 12 }}>
                      <strong>
                        {fmtNum(clean.surchargeLines.length)} งาน
                        มีมากกว่าหนึ่งบรรทัดในลำดับงานเดียวกัน
                      </strong>{' '}
                      ส่วนใหญ่คือค่าเสียเวลา ค่าค้างคืน หรือค่าล่วงเวลา ที่ถูกแยกเป็นอีกบรรทัด
                      ไม่ใช่อีกเที่ยว — ระบบยังนับเป็นคนละเที่ยวอยู่ เพราะแยกจาก
                      &ldquo;ราคาถูกแก้ย้อนหลัง&rdquo; ไม่ได้แน่นอน ถ้าอยากให้จำนวนเที่ยวตรงเป๊ะ
                      ให้รวมยอดในไฟล์ต้นทางเป็นบรรทัดเดียวก่อนอัปโหลด
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>ดูรายการ</summary>
                        <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
                          {clean.surchargeLines.slice(0, 30).map((v) => (
                            <li key={`${v.date}-${v.driverName}-${v.seq}`}>
                              {fmtDateShort(v.date)} · {v.driverName} · ลำดับงาน {v.seq} —{' '}
                              {v.rows} บรรทัด
                            </li>
                          ))}
                          {clean.surchargeLines.length > 30 && (
                            <li>… และอีก {fmtNum(clean.surchargeLines.length - 30)} งาน</li>
                          )}
                        </ul>
                      </details>
                    </div>
                  )}

                  {clean.invalid.length > 0 && (
                    <div className="note-box" style={{ marginTop: 12 }}>
                      <strong>ข้าม {fmtNum(clean.invalid.length)} แถว</strong> เพราะขาดวันที่ ชื่อ
                      หรือเบอร์โทร พขร. — แถวเหล่านี้จะไม่ถูกนำเข้า ส่วนที่เหลือนำเข้าได้ตามปกติ
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>ดูรายละเอียด</summary>
                        <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
                          {clean.invalid.slice(0, 40).map((v, i) => (
                            <li key={`${v.sheet}-${v.rowNo}-${i}`}>
                              {v.sheet} แถวที่ {v.rowNo}: {v.reason}
                            </li>
                          ))}
                          {clean.invalid.length > 40 && (
                            <li>… และอีก {fmtNum(clean.invalid.length - 40)} แถว</li>
                          )}
                        </ul>
                      </details>
                    </div>
                  )}
                </div>

                <div className="card-pad row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={() => setStage('idle')}>
                    เลือกไฟล์อื่น
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={!allowed || rows.length === 0}
                    onClick={() => void runImport()}
                  >
                    นำเข้า {fmtNum(rows.length)} เที่ยว
                  </button>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3>ตัวอย่าง 10 แถวแรกหลังทำความสะอาด</h3>
                </div>
                <div className="tablewrap" style={{ border: 0, borderRadius: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>วันที่</th>
                        <th>ลำดับ</th>
                        <th>ลูกค้า</th>
                        <th>พขร.</th>
                        <th>เบอร์ (จัดรูปแล้ว)</th>
                        <th>รถ</th>
                        <th>ต้นทาง → ปลายทาง</th>
                        <th className="right">ค่าจ้าง</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 10).map((r) => (
                        <tr key={r.hash}>
                          <td className="nowrap mono" style={{ fontSize: 12 }}>
                            {fmtDateShort(r.date)}
                          </td>
                          <td className="mono muted" style={{ fontSize: 11.5 }}>
                            {r.seq ?? '—'}
                            {r.occurrence > 1 && (
                              <span className="badge warn" style={{ marginLeft: 4 }}>
                                เที่ยวที่ {r.occurrence}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className="badge">{r.customer ?? '—'}</span>
                          </td>
                          <td>{r.driverName}</td>
                          <td className="mono nowrap">{r.driverPhone}</td>
                          <td className="mono" style={{ fontSize: 11.5 }}>
                            {r.vehicleType ?? '—'}
                            {r.plate && (
                              <div className="muted" style={{ fontSize: 10.5 }}>
                                {r.plate}
                              </div>
                            )}
                          </td>
                          <td style={{ fontSize: 13, minWidth: 200 }}>
                            {r.origin ? (
                              <>
                                {r.origin} <span className="muted">→</span> {r.destination}
                              </>
                            ) : (
                              <span className="muted">{r.route ?? '—'}</span>
                            )}
                          </td>
                          <td className="right num">{fmtMoney(r.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* -------------------------------------------------- กำลังนำเข้า */}
      {stage === 'importing' && (
        <div className="card card-pad">
          <h2 style={{ marginBottom: 12 }}>กำลังนำเข้า…</h2>
          <div className="progress" style={{ marginBottom: 8 }}>
            <i style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            {progress.label} · {progress.pct}%
          </p>
          <p className="hint">อย่าปิดหน้านี้จนกว่าจะเสร็จ</p>
        </div>
      )}

      {/* -------------------------------------------------- ผลลัพธ์ */}
      {stage === 'done' && report && (
        <div className="card">
          <div className="card-head">
            <h2>นำเข้าเสร็จแล้ว</h2>
            <button className="btn btn-sm" onClick={() => setStage('idle')}>
              อัปโหลดไฟล์อื่น
            </button>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="v num" style={{ color: 'var(--accent)' }}>
                {fmtNum(report.jobsInserted)}
              </div>
              <div className="l">เที่ยวที่เพิ่มใหม่</div>
            </div>
            <div className="stat">
              <div className="v num">{fmtNum(report.driversCreated)}</div>
              <div className="l">พขร. หน้าใหม่</div>
            </div>
            <div className="stat">
              <div className="v num">{fmtNum(report.driversMatched)}</div>
              <div className="l">พขร. ที่มีอยู่แล้ว</div>
            </div>
            <div className="stat">
              <div className="v num">{fmtNum(report.alreadyInDb)}</div>
              <div className="l">ข้ามเพราะนำเข้าไปแล้ว</div>
            </div>
          </div>

          <div className="card-pad">
            <table style={{ minWidth: 0 }}>
              <tbody>
                <Row label="เที่ยวที่ตรวจทั้งหมด" value={fmtNum(report.totalRows)} />
                <Row label="เคยนำเข้าไปแล้วก่อนหน้านี้" value={fmtNum(report.alreadyInDb)} />
                <Row label="ลูกค้าที่เพิ่มใหม่" value={fmtNum(report.customersCreated)} />
                <Row label="ประเภทรถที่เพิ่มใหม่" value={fmtNum(report.vehicleTypesCreated)} />
                <Row label="ทะเบียนรถที่เพิ่มใหม่" value={fmtNum(report.vehiclesCreated)} />
              </tbody>
            </table>

            {report.revised.length > 0 && (
              <div className="note-box warn" style={{ marginTop: 14 }}>
                <strong>
                  ตรวจพบ {fmtNum(report.revised.length)} เที่ยว
                  ที่อาจเป็นงานเดิมในระบบที่ถูกแก้ข้อมูลในไฟล์ต้นทาง
                </strong>
                <br />
                ระบบระบุตัวเที่ยวจาก วันที่ · ลูกค้า · ทะเบียน · เบอร์ พขร. · เส้นทาง · ราคา
                ถ้าย้อนกลับไปแก้ช่องใดช่องหนึ่ง เที่ยวนั้นจะถูกนับเป็นเที่ยวใหม่
                ส่วนเที่ยวเดิมยังค้างอยู่ — กลายเป็นสองเที่ยวจากงานเดียว
                รายการด้านล่างจึงควรเปิดดูแล้วลบเที่ยวเก่าทิ้งถ้าซ้ำจริง
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer' }}>ดูรายการ</summary>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
                    {report.revised.slice(0, 30).map((v) => (
                      <li key={v.existingJobId}>
                        {fmtDateShort(v.date)} · {v.driverName} · {v.route ?? '—'} — ต่างที่{' '}
                        {v.changed.join(', ')}
                      </li>
                    ))}
                    {report.revised.length > 30 && (
                      <li>… และอีก {fmtNum(report.revised.length - 30)} เที่ยว</li>
                    )}
                  </ul>
                </details>
              </div>
            )}

            {report.errors.length > 0 ? (
              <div className="note-box err" style={{ marginTop: 14 }}>
                <strong>มีข้อผิดพลาดบางส่วน</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                  {report.errors.slice(0, 8).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="note-box ok" style={{ marginTop: 14 }}>
                ไม่มีข้อผิดพลาด — เปิดหน้ารายชื่อ พขร.
                เพื่อดูข้อมูลที่เพิ่งนำเข้าได้เลย
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ border: 0, padding: '4px 0', color: 'var(--muted)' }}>{label}</td>
      <td className="right num" style={{ border: 0, padding: '4px 0', fontWeight: 500 }}>
        {value}
      </td>
    </tr>
  )
}
