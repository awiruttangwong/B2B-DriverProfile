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
 *   3. งานรอให้คะแนนไม่ใช่ "สถิติ" แต่เป็น "งานค้างที่ต้องทำ" คนละบทบาทกัน
 *      จึงแยกออกมาเป็นบล็อกที่มีปุ่มให้กดไปทำต่อ
 *
 * รูปแบบที่ใช้: อัตราส่วนเทียบเพดานควรเป็น meter ไม่ใช่ตัวเลขเดี่ยว
 * และตัวเลขนำของหน้ามีได้หนึ่งเดียว
 */

interface Props {
  total: number | undefined
  regular: number | undefined
  recent: number | undefined
  totalJobs: number | undefined
  pending: number | undefined
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
  totalJobs,
  pending,
  loading,
}: Props) {
  if (loading || total === undefined) {
    return (
      <div className="card readiness" style={{ marginBottom: 18 }}>
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
    )
  }

  const jobs = totalJobs ?? 0
  const waiting = pending ?? 0
  const rated = Math.max(0, jobs - waiting)

  return (
    <div className="card readiness" style={{ marginBottom: 18 }}>
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
          สองแถบนี้วัดจากรายชื่อทั้งหมด — ส่วนที่เหลือคือคนที่เคยวิ่งไม่กี่เที่ยวหรือหายไปนานแล้ว
        </p>
      </section>

      {/* ---------------------------------------- ความคืบหน้าการให้คะแนน */}
      <section>
        <Meter
          label="เที่ยวที่ให้คะแนนแล้ว"
          value={rated}
          of={jobs}
          tone={rated === 0 ? 'warn' : undefined}
        />

        <p className="coverage-note">
          {rated === 0 ? (
            <>
              ยังไม่มีการให้คะแนนเลยสักเที่ยว การจัดอันดับตอนนี้จึงตัดสินด้วยประสบการณ์อย่างเดียว
              คะแนนคุณภาพยังใช้ค่ากลางเท่ากันทุกคน
            </>
          ) : (
            <>
              เหลืออีก {fmtNum(waiting)} เที่ยวที่ยังไม่มีใครให้คะแนน
              ยิ่งค้างมาก การจัดอันดับยิ่งอาศัยประสบการณ์มากกว่าคุณภาพ
            </>
          )}
        </p>

        <div style={{ marginTop: 14 }}>
          <Link to="/pending" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
            <IconStar size={14} />
            {rated === 0 ? 'เริ่มให้คะแนนงานแรก' : 'ไปให้คะแนนงานที่ค้าง'}
          </Link>
        </div>
      </section>
    </div>
  )
}
