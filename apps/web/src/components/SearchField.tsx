import { useRef } from 'react'
import { IconSearch } from './icons'

interface Props {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

/**
 * ช่องค้นหาไอคอนแว่นขยาย + ปุ่มล้าง (×) — ดึงมาจากช่องค้นหาในหน้ารายชื่อ พขร.
 * (เดิม Drivers.tsx มีคอมโพเนนต์ค้นหาของตัวเองชื่อ DriverSearchField ซึ่งฝังปุ่มล้างแบบ
 * นี้ไว้ข้างในพร้อมส่วนคำแนะนำอัตโนมัติ) แยกมาเป็นคอมโพเนนต์กลางเฉพาะส่วนช่องค้นหา+ปุ่มล้าง
 * ให้หน้าอื่นที่แค่ต้องการกรองตารางที่เห็นอยู่แล้ว (ไม่ต้องมีทางลัดกระโดดไปโปรไฟล์) ใช้ร่วมกัน
 * แทนที่จะประกอบขึ้นมาใหม่เองทีละหน้าแล้วเผลอพลาดรายละเอียดไป — ตอนแรกหน้าพักงาน/แบล็คลิสต์
 * ประกอบเองแล้วพลาดสองจุด: (1) ใช้ type="search" แทน "text" ทำให้ปุ่มล้าง (×) ของเบราว์เซอร์
 * เอง (Chrome เป็นต้น) โผล่ซ้อนทับข้อความเพราะไม่ได้เผื่อ padding-right ไว้ให้ ดูเพี้ยนตอนพิมพ์
 * ค้นหาแล้วมีค่า (2) ไม่มีปุ่มล้างของแอปเองเลย ต้องลบด้วยมือหรือกด backspace ต่างจากช่องค้นหา
 * ทุกที่อื่นในระบบที่กดปุ่มเดียวล้างได้ทันที
 *
 * type="text" ไม่ใช่ "search" ด้วยเหตุผลเดียวกับ DriverSearchField ต้นแบบ: เบราว์เซอร์แปะปุ่ม
 * ล้างค่า (×) ในตัวให้ input type=search ที่มีค่าอยู่แล้วเสมอ ซ้อนทับปุ่ม .combo-clear ที่วาด
 * เองด้านล่าง กลายเป็นมี × สองอันซ้อนกัน
 */
export default function SearchField({ id, value, onChange, placeholder }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={`search-field${value ? ' has-clear' : ''}`}>
      <span
        style={{
          position: 'absolute',
          left: 11,
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--muted)',
          display: 'flex',
        }}
      >
        <IconSearch size={16} />
      </span>
      <input
        id={id}
        ref={inputRef}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ paddingLeft: 34 }}
      />
      {value && (
        <button
          type="button"
          className="combo-clear"
          tabIndex={-1}
          aria-label="ล้างคำค้นหา"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('')
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
    </div>
  )
}
