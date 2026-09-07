import { useEffect, useId, useMemo, useRef, useState } from 'react'

export interface ComboOption {
  value: string
  label: string
  hint?: string
}

interface Props {
  id?: string
  value: string
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  /** อนุญาตให้พิมพ์ค่าที่ยังไม่มีในรายการ แล้วสร้างใหม่ */
  allowCreate?: boolean
  createLabel?: (v: string) => string
  disabled?: boolean
  emptyText?: string
}

/**
 * ช่องเลือกที่ค้นหาได้
 *
 * ทำไมไม่ใช้ <datalist> ของเบราว์เซอร์: หน้าตาต่างกันคนละอย่างในแต่ละเบราว์เซอร์
 * กำหนดสไตล์ไม่ได้ ไม่มีสัญญาณบอกว่ากดแล้วมีรายการให้เลือก และบางเบราว์เซอร์
 * ต้องพิมพ์ก่อนรายการถึงจะโผล่ ผู้ใช้จึงไม่รู้ว่ามีตัวเลือกอยู่
 *
 * ทำไมไม่ใช้ <select>: ลูกค้ามี 69 ราย เลื่อนหาทีละอันช้า และพิมพ์ค้นไม่ได้
 *
 * รองรับคีย์บอร์ดครบ: ลูกศรขึ้นลงเลื่อน · Enter เลือก · Esc ปิด · Home/End ไปหัวท้าย
 */
export default function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  allowCreate = false,
  createLabel = (v) => `เพิ่มใหม่: ${v}`,
  disabled,
  emptyText = 'ไม่พบรายการที่ตรงกัน',
}: Props) {
  const autoId = useId()
  const inputId = id ?? autoId
  const listId = `${inputId}-list`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // กันไม่ให้การคืนโฟกัสหลังเลือกเสร็จ ไปเปิดรายการขึ้นมาใหม่ทันที
  const justPicked = useRef(false)

  // ตอนปิดอยู่ให้โชว์ค่าที่เลือกจริง ตอนเปิดให้โชว์สิ่งที่กำลังพิมพ์ค้น
  const shown = open ? query : value

  const filtered = useMemo(() => {
    const q = (open ? query : '').trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.hint ?? '').toLowerCase().includes(q),
    )
  }, [options, query, open])

  const typed = query.trim()
  const exact = options.some((o) => o.value.toLowerCase() === typed.toLowerCase())
  const showCreate = allowCreate && typed.length > 0 && !exact
  const rows = showCreate ? filtered.length + 1 : filtered.length

  useEffect(() => {
    if (active >= rows) setActive(Math.max(0, rows - 1))
  }, [rows, active])

  // ปิดเมื่อคลิกนอกกล่อง
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // เลื่อนรายการที่กำลังเลือกให้อยู่ในสายตา
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: 'nearest',
    })
  }, [active, open])

  /**
   * เปิดรายการ — ห้ามล้างคำค้นตรงนี้
   *
   * เดิมเขียน setQuery('') ไว้ในนี้ แล้วเรียกจาก onFocus ผลคือทุกครั้งที่ช่องได้โฟกัส
   * สิ่งที่ผู้ใช้พิมพ์ค้างไว้จะถูกลบทิ้ง รายการเด้งกลับไปแสดงทั้งหมด
   * แล้วการกด Enter จะไปเลือกตัวเลือกผิดตัว
   */
  function openList() {
    if (disabled) return
    setActive(0)
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  function pick(i: number) {
    if (showCreate && i === filtered.length) {
      onChange(typed)
    } else {
      const o = filtered[i]
      if (!o) return
      onChange(o.value)
    }
    close()
    justPicked.current = true
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault()
      openList()
      return
    }
    if (!open) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % Math.max(rows, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a - 1 + Math.max(rows, 1)) % Math.max(rows, 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(0, rows - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rows > 0) pick(active)
      else if (allowCreate && typed) {
        onChange(typed)
        close()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'Tab') {
      close()
    }
  }

  return (
    <div className="combo" ref={wrapRef}>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows > 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={open && !query && value ? value : placeholder}
        value={shown}
        onChange={(e) => {
          if (!open) setOpen(true)
          setQuery(e.target.value)
          setActive(0)
        }}
        onFocus={() => {
          if (justPicked.current) {
            justPicked.current = false
            return
          }
          openList()
        }}
        onKeyDown={onKeyDown}
      />

      <button
        type="button"
        className="combo-toggle"
        tabIndex={-1}
        aria-label={open ? 'ปิดรายการ' : 'เปิดรายการ'}
        disabled={disabled}
        onClick={() => {
          if (open) {
            close()
          } else {
            justPicked.current = true // กัน onFocus ยิงซ้ำ
            inputRef.current?.focus()
            openList()
          }
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

      {open && (
        <ul className="combo-list" id={listId} role="listbox" ref={listRef}>
          {rows === 0 && <li className="combo-empty">{emptyText}</li>}

          {filtered.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              className="combo-item"
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(i)
              }}
            >
              <span className="combo-label">{o.label}</span>
              {/* ไม่ต้องโชว์คำอธิบายถ้าซ้ำกับชื่อ — ข้อมูลที่นำเข้ามาบางส่วน name เท่ากับ code */}
              {o.hint && o.hint !== o.label && <span className="combo-hint">{o.hint}</span>}
              {o.value === value && (
                <span className="combo-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </li>
          ))}

          {showCreate && (
            <li
              id={`${listId}-${filtered.length}`}
              role="option"
              aria-selected={false}
              data-active={active === filtered.length}
              className="combo-item combo-create"
              onMouseEnter={() => setActive(filtered.length)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(filtered.length)
              }}
            >
              <span className="combo-label">{createLabel(typed)}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
