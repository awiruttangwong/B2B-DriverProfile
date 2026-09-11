import { Link } from 'react-router-dom'
import { fmtNum } from '../lib/format'
import { IconStar } from './icons'

/**
 * ภาพรวมความพร้อมของข้อมูล
 *
 * ทำไมไม่ใช้การ์ดตัวเลข 4 ใบเรียงกัน:
 *   1. ตัวเลขสามตัวแรกเป็นเซตซ้อนกัน — "วิ่งประจำ" กับ "วิ่งใน 30 วัน" เป็นส่วนย่อย
 *      ของ "พขร. ในระบบ" การวางเรียงกันสี่ใบเท่ากันทำให้ดูเหมือนเป็นของคนละเรื่อง
 *      ที่ระดับเดียวกัน ซึ่งไม่จริง
 *   2. เลข 114 ลอย ๆ ไม่บอกอะไร แต่ "114 จาก 1,289 = 8.8%" บอกทันทีว่า
 *      คนที่ใช้งานได้จริงมีน้อยมากเมื่อเทียบกับรายชื่อทั้งหมด
 *   3. คนที่รอประเมินไม่ใช่ "สถิติ" แต่เป็น "งานค้างที่ต้องทำ" คนละบทบาทกัน
 *      จึงแยกออกมาเป็นบล็อกที่มีปุ่มให้กดไปทำต่อ
 *
 * รูปแบบที่ใช้: อัตราส่วนเทียบเพดานควรเป็น meter ไม่ใช่ตัวเลขเดี่ยว
 * และตัวเลขนำของหน้ามีได้หนึ่งเดียว
 */

interface Props {
  total: number | undefined
  regular: number | undefined
  recent: number | undefined
  /** คนสถานะ active/probation ที่ยังไม่ได้ประเมิน */
  pending: number | undefined
  /** คนสถานะ active/probation ทั้งหมด — เป็นตัวหารของแถบความคืบหน้า */
  scopeAll: number | undefined
  loading?: boolean
}

function Meter({
  label,
  sub,
  value,
  of,
  tone,
}: {
  label: string
  sub?: string
  value: number
  of: number
  tone?: 'warn'
}) {
  const pct = of > 0 ? (value / of) * 100 : 0
  return (
    <div>
      <div className="meter-head">
        <span className="meter-lbl">
          {label} {sub && <small>{sub}</small>}
        </span>
        <span className="meter-val">
          {fmtNum(value)}
          <span className="pct">{pct.toFixed(1)}%</span>
        </span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={of}
        aria-label={`${label} ${fmtNum(value)} จาก ${fmtNum(of)}`}
      >
        <i className={tone === 'warn' ? 'warn' : ''} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  )
}

export default function ReadinessPanel({
  total,
  regular,
  recent,
  pending,
  scopeAll,
  loading,
}: Props) {
  if (loading || total === undefined) {
    return (
      <div className="card readiness" style={{ marginBottom: 18 }}>
        <div className="readiness-grid">
          <section>
            <div className="sk" style={{ width: 150, height: 46 }} />
            <div className="sk" style={{ width: 100, height: 12, marginTop: 10 }} />
            <div className="sk" style={{ width: '100%', height: 40, marginTop: 24 }} />
          </section>
          <section>
            <div className="sk" style={{ width: 120, height: 14 }} />
            <div className="sk" style={{ width: '100%', height: 40, marginTop: 16 }} />
          </section>
        </div>
      </div>
    )
  }

  const waiting = pending ?? 0
  const scope = scopeAll ?? 0
  const reviewed = Math.max(0, scope - waiting)

  return (
    <div className="card readiness" style={{ marginBottom: 18 }}>
      <div className="readiness-grid">
        {/* ---------------------------------------- รายชื่อ พขร. */}
        <section>
          <div className="hero-fig">{fmtNum(total)}</div>
          <div className="hero-lbl">พขร. ที่ใช้งานอยู่ในระบบ</div>

          <div className="meters">
            <Meter
              label="วิ่งประจำ"
              sub="ตั้งแต่ 10 เที่ยวขึ้นไป"
              value={regular ?? 0}
              of={total}
            />
            <Meter
              label="วิ่งงานใน 30 วันล่าสุด"
              sub="พร้อมรับงานตอนนี้"
              value={recent ?? 0}
              of={total}
            />
          </div>

          <p className="coverage-note">
            พขร. ที่วิ่งต่ำกว่า 10 เที่ยวหรือไม่ได้วิ่งเกิน 30 วันแล้ว ยังประเมินได้ตามปกติ
            แถบนี้เป็นเพียงสถิติแบ่งกลุ่มตามกิจกรรม
          </p>
        </section>

        {/* ---------------------------------------- ความคืบหน้าการประเมิน */}
        <section>
          <Meter
            label="ประเมินแล้ว"
            sub="เฉพาะคนที่สถานะยังใช้งานอยู่"
            value={reviewed}
            of={scope}
            tone={reviewed === 0 ? 'warn' : undefined}
          />

          <p className="coverage-note">
            {reviewed === 0 ? (
              <>
                ยังไม่มีการประเมิน พขร. แม้แต่คนเดียว การจัดอันดับในขณะนี้จึงอ้างอิงจากประสบการณ์ตาม
                จำนวนเที่ยววิ่งเท่านั้น ยังไม่มีคะแนนประเมินมาช่วยแยกแยะคุณภาพของพนักงานขับรถแต่ละคน
              </>
            ) : (
              <>
                เหลืออีก {fmtNum(waiting)} คนที่ยังไม่ได้รับการประเมิน
                ยิ่งค้างมาก การจัดอันดับยิ่งอ้างอิงจากประสบการณ์ตามจำนวนเที่ยววิ่งมากกว่าคุณภาพ
              </>
            )}
          </p>

          <div style={{ marginTop: 14 }}>
            <Link to="/pending" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              <IconStar size={14} />
              {reviewed === 0 ? 'เริ่มประเมิน' : 'ไปประเมินคนที่ค้าง'}
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
