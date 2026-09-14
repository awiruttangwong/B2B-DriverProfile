import { useState } from 'react'
import { IconCalendar, IconChevronDown, IconChevronLeft, IconChevronRight } from './icons'

/**
 * ตัวเลือกวันเวลาแทน <input type="datetime-local">
 *
 * ทำเองเพราะตัวของเบราว์เซอร์ (1) ปรับหน้าตาให้เข้าธีมไม่ได้ ทั้งโหมดสว่างและมืด
 * (2) แสดงปีเป็น ค.ศ. ขณะที่ทั้งระบบแสดงเป็น พ.ศ. และ (3) หน้าตาต่างกันไปทุกเบราว์เซอร์
 *
 * กางลงในตัวฟอร์มแทนการลอยเป็นป๊อปอัป — ช่องนี้อยู่ใกล้ท้ายกล่อง dialog ป๊อปอัป
 * ที่ลอยลงล่างจะล้นขอบกล่อง และบนมือถือการกางในตัวอ่านง่ายกว่า
 */

const WEEKDAYS = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา']

const pad = (n: number) => String(n).padStart(2, '0')

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  )
}

interface Props {
  id?: string
  value: Date
  onChange: (d: Date) => void
  /** วันหลังจากนี้กดเลือกไม่ได้ — ใช้กันลงวันในอนาคต */
  max?: Date
}

export default function DateTimePicker({ id, value, onChange, max }: Props) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1))

  // เก็บข้อความชั่วโมง/นาทีแยกจาก value เพราะระหว่างพิมพ์ค่าอาจยังไม่ครบ (เช่นพิมพ์ "1"
  // จะพิมพ์ต่อเป็น "14") ถ้าผูกกับ value ตรง ๆ แล้วเติมศูนย์ทุกครั้งที่พิมพ์ ช่องจะกลาย
  // เป็น "01" ทันทีแล้วพิมพ์ต่อไม่ได้ — เติมศูนย์ตอนออกจากช่องแทน
  const [hh, setHh] = useState(pad(value.getHours()))
  const [mm, setMm] = useState(pad(value.getMinutes()))

  const today = new Date()
  const maxDay = max ? new Date(max.getFullYear(), max.getMonth(), max.getDate()) : null
  const canGoNext =
    !maxDay || new Date(view.getFullYear(), view.getMonth() + 1, 1) <= maxDay

  // 6 สัปดาห์เต็มเสมอ (42 ช่อง) — ความสูงปฏิทินคงที่ทุกเดือน ไม่กระโดดตอนเปลี่ยนเดือน
  const offset = (view.getDay() + 6) % 7
  const cells = Array.from(
    { length: 42 },
    (_, i) => new Date(view.getFullYear(), view.getMonth(), 1 - offset + i),
  )

  const pickDay = (d: Date) => {
    onChange(new Date(d.getFullYear(), d.getMonth(), d.getDate(), value.getHours(), value.getMinutes()))
    if (d.getMonth() !== view.getMonth()) setView(new Date(d.getFullYear(), d.getMonth(), 1))
  }

  const setTimePart = (part: 'h' | 'm', raw: string) => {
    const text = raw.replace(/\D/g, '').slice(0, 2)
    if (part === 'h') setHh(text)
    else setMm(text)
    if (text === '') return
    const n = Number(text)
    if (part === 'h' && n <= 23) {
      onChange(new Date(value.getFullYear(), value.getMonth(), value.getDate(), n, value.getMinutes()))
    }
    if (part === 'm' && n <= 59) {
      onChange(new Date(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), n))
    }
  }

  const now = () => {
    const n = new Date()
    onChange(n)
    setHh(pad(n.getHours()))
    setMm(pad(n.getMinutes()))
    setView(new Date(n.getFullYear(), n.getMonth(), 1))
  }

  const dateLabel = value.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="dtp">
      <button
        id={id}
        type="button"
        className="dtp-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconCalendar size={16} />
        <span>
          {dateLabel} <span className="muted">·</span>{' '}
          <span className="num">
            {pad(value.getHours())}:{pad(value.getMinutes())}
          </span>
        </span>
        <span className="dtp-chevron">
          <IconChevronDown size={16} />
        </span>
      </button>

      {open && (
        <div
          className="dtp-panel"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        >
          <div className="dtp-head">
            <button
              type="button"
              className="dtp-nav"
              aria-label="เดือนก่อนหน้า"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            >
              <IconChevronLeft size={16} />
            </button>
            <span className="dtp-title">
              {view.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              className="dtp-nav"
              aria-label="เดือนถัดไป"
              disabled={!canGoNext}
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            >
              <IconChevronRight size={16} />
            </button>
          </div>

          <div className="dtp-grid" role="grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="dtp-wd" aria-hidden="true">
                {w}
              </span>
            ))}
            {cells.map((d) => {
              const future = !!maxDay && d > maxDay
              const cls = [
                'dtp-day',
                d.getMonth() !== view.getMonth() && 'is-other',
                sameDay(d, today) && 'is-today',
                sameDay(d, value) && 'is-selected',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  className={cls}
                  disabled={future}
                  aria-pressed={sameDay(d, value)}
                  aria-label={d.toLocaleDateString('th-TH', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                  onClick={() => pickDay(d)}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          <div className="dtp-foot">
            <span className="dtp-time-label">เวลา</span>
            <div className="dtp-time">
              {/* ขนาดกำหนดแบบ inline โดยตั้งใจ — กฎ input ส่วนกลางใช้ :not() ซ้อน 7 ชั้น
                  ความเจาะจงสูงกว่า class ธรรมดา จะทับความกว้าง/padding ที่เขียนใน CSS */}
              <input
                type="text"
                inputMode="numeric"
                aria-label="ชั่วโมง"
                value={hh}
                onChange={(e) => setTimePart('h', e.target.value)}
                onBlur={() => setHh(pad(value.getHours()))}
                style={{ width: 50, padding: '6px 4px', textAlign: 'center' }}
              />
              <span aria-hidden="true">:</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label="นาที"
                value={mm}
                onChange={(e) => setTimePart('m', e.target.value)}
                onBlur={() => setMm(pad(value.getMinutes()))}
                style={{ width: 50, padding: '6px 4px', textAlign: 'center' }}
              />
              <span className="muted" style={{ fontSize: 12.5 }}>
                น.
              </span>
            </div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={now}>
              ตอนนี้
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              style={{ marginLeft: 'auto' }}
              onClick={() => setOpen(false)}
            >
              เสร็จ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
