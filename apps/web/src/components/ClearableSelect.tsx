export interface SelectOption {
  value: string
  label: string
}

interface Props {
  id: string
  value: string
  onChange: (v: string) => void
  options: SelectOption[]
  /** ค่าที่หมายถึง "ไม่ได้กรอง" — ปุ่มล้างจะโผล่ก็ต่อเมื่อค่าปัจจุบันไม่ใช่ค่านี้ */
  clearLabel: string
}

/**
 * <select> ที่มีปุ่มล้าง (×) เหมือนช่องค้นหา/Combobox ที่อื่นในระบบ — เดิมตัวกรอง
 * แบบ select เปล่า ๆ ไม่มีทางล้างทีละช่อง ต้องไปกดปุ่ม "ล้างตัวกรองทั้งหมด" ที่โผล่
 * เฉพาะตอนหน้าว่างเท่านั้น ทำให้ผู้ใช้รู้สึกว่าตัวกรองชุดนี้ไม่สอดคล้องกับที่อื่น
 */
export default function ClearableSelect({ id, value, onChange, options, clearLabel }: Props) {
  const hasClear = value !== ''
  return (
    <div className={`select-clear${hasClear ? ' has-clear' : ''}`}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="select-clear-arrow" aria-hidden="true">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
      {hasClear && (
        <button
          type="button"
          className="combo-clear"
          tabIndex={-1}
          aria-label={clearLabel}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  )
}
