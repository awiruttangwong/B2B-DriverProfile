import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverPhone } from '../types/database'
import { fmtPhone } from '../lib/format'

const MAX_EXTRA = 2 // เบอร์หลักอยู่ที่ drivers.phone ตำแหน่ง 1 อยู่แล้ว รวมสูงสุด 3 เบอร์

interface Props {
  driverId: string
  /** เบอร์หลัก (drivers.phone) — ใช้กันเพิ่มเบอร์ซ้ำกับเบอร์หลัก */
  primaryPhone: string | null
  phones: DriverPhone[]
}

function translate(msg: string): string {
  if (msg.includes('row-level security') || msg.includes('violates row-level'))
    return 'ไม่มีสิทธิ์ทำรายการนี้ — แก้เบอร์โทรได้เฉพาะ admin, hr หรือ ops'
  if (msg.includes('driver_phones_digits')) return 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก'
  if (msg.includes('duplicate key'))
    return 'มีคนเพิ่มเบอร์ให้ พขร. คนนี้พร้อมกันพอดี — โหลดรายการใหม่แล้ว ลองอีกครั้ง'
  return msg
}

export default function ExtraPhones({ driverId, primaryPhone, phones }: Props) {
  const { can } = useAuth()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const canEdit = can('admin', 'hr', 'ops')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['driver', driverId, 'phones'] })

  const add = useMutation({
    mutationFn: async (phone: string) => {
      const digits = phone.replace(/\D/g, '')
      if (!/^[0-9]{9,10}$/.test(digits)) throw new Error('เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก')
      if (digits === primaryPhone || phones.some((p) => p.phone === digits))
        throw new Error('เบอร์นี้มีอยู่แล้วของ พขร. คนนี้')
      // เลือกช่องที่ว่างจริง ไม่ใช่นับจำนวน — ถ้ามี 2 และ 3 แล้วลบ 2 ออก จะเหลือแถว
      // position 3 แถวเดียว นับจำนวนได้ 1 แล้วเลือก 3 ซ้ำ ชน unique (driver_id, position)
      const used = new Set(phones.map((p) => p.position))
      const position = !used.has(2) ? 2 : !used.has(3) ? 3 : null
      if (position === null) throw new Error('เพิ่มได้สูงสุด 3 เบอร์')
      const { data, error } = await supabase
        .from('driver_phones')
        .insert({ driver_id: driverId, phone: digits, position })
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('row-level security')
    },
    onSuccess: () => {
      setAdding(false)
      setValue('')
      refresh()
    },
    onError: (e: Error) => {
      setErr(translate(e.message))
      // ชนกับการเพิ่มพร้อมกันจากอีกเครื่อง — ดึงรายการล่าสุดมาให้เห็นช่องที่ว่างจริง
      if (e.message.includes('duplicate key')) refresh()
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('driver_phones').delete().eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('row-level security')
    },
    onSuccess: () => {
      setRemoving(null)
      refresh()
    },
    onError: (e: Error) => {
      setRemoving(null)
      setErr(translate(e.message))
    },
  })

  function submitAdd(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    add.mutate(value)
  }

  if (phones.length === 0 && !adding && !canEdit) return null

  return (
    <div className="extra-phones">
      {phones.map((p) => (
        <div key={p.id} className="extra-phones-row">
          <a href={`tel:${p.phone}`} className="phone-link mono" title="กดเพื่อโทรออก">
            {fmtPhone(p.phone)}
          </a>
          {canEdit &&
            (removing === p.id ? (
              <span className="extra-phones-confirm">
                <button
                  type="button"
                  className="doc-slot-link danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(p.id)}
                >
                  {remove.isPending ? 'กำลังลบ…' : 'ยืนยันลบ'}
                </button>
                ·
                <button
                  type="button"
                  className="doc-slot-link"
                  disabled={remove.isPending}
                  onClick={() => setRemoving(null)}
                >
                  ยกเลิก
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="doc-slot-link danger extra-phones-remove"
                onClick={() => setRemoving(p.id)}
              >
                ลบ
              </button>
            ))}
        </div>
      ))}

      {canEdit && phones.length < MAX_EXTRA && (
        <div className="extra-phones-row">
          {adding ? (
            <form onSubmit={submitAdd} className="extra-phones-form">
              <input
                type="tel"
                inputMode="numeric"
                autoFocus
                placeholder="เบอร์ใหม่"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={add.isPending}
                className="extra-phones-input"
              />
              <button type="submit" className="doc-slot-link" disabled={add.isPending}>
                {add.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
              ·
              <button
                type="button"
                className="doc-slot-link"
                disabled={add.isPending}
                onClick={() => {
                  setAdding(false)
                  setValue('')
                  setErr(null)
                }}
              >
                ยกเลิก
              </button>
            </form>
          ) : (
            <button type="button" className="doc-slot-link" onClick={() => setAdding(true)}>
              + เพิ่มเบอร์
            </button>
          )}
        </div>
      )}

      {err && <div className="doc-slot-err">{err}</div>}
    </div>
  )
}
