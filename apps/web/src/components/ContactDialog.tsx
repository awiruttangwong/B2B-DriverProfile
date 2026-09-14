import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { ContactOutcome, DriverContact } from '../types/database'
import { CONTACT_OUTCOME_LABEL, fmtPhone } from '../lib/format'
import { IconPhone } from './icons'
import DateTimePicker from './DateTimePicker'

const OUTCOMES = Object.keys(CONTACT_OUTCOME_LABEL) as ContactOutcome[]

interface Props {
  driverId: string
  driverName: string
  phone: string | null
  /** ส่งมา = แก้ไขรายการเดิม (มีปุ่มลบ) / ไม่ส่ง = บันทึกการโทรครั้งใหม่ */
  existing?: DriverContact
  onClose: () => void
}

export default function ContactDialog({ driverId, driverName, phone, existing, onClose }: Props) {
  const qc = useQueryClient()
  const [outcome, setOutcome] = useState<ContactOutcome | null>(existing?.outcome ?? null)
  const [note, setNote] = useState(existing?.note ?? '')
  const [calledAt, setCalledAt] = useState(() =>
    existing ? new Date(existing.called_at) : new Date(),
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['driver', driverId, 'contacts'] })
    void qc.invalidateQueries({ queryKey: ['activity-log'] })
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!outcome) throw new Error('เลือกผลการโทรก่อนบันทึก')
      // ปฏิทินกันเลือกวันในอนาคตไว้แล้ว แต่วันนี้ยังพิมพ์เวลาที่ยังมาไม่ถึงได้ — เผื่อนาฬิกา
      // เครื่องคลาดเคลื่อนเล็กน้อย เกินกว่านี้คือลงเวลาผิดแน่นอน
      if (calledAt.getTime() > Date.now() + 5 * 60_000) {
        throw new Error('วันเวลาที่โทรอยู่ในอนาคต ตรวจสอบเวลาอีกครั้ง')
      }
      const payload = { outcome, note: note.trim() || null, called_at: calledAt.toISOString() }

      // .select() หลังเขียนเสมอ — RLS ที่ปฏิเสธการแก้ไขไม่ส่ง error กลับมา แค่แก้ได้
      // 0 แถวแบบเงียบ ๆ ถ้าไม่เช็คจำนวนแถว หน้าจอจะปิดไปเหมือนบันทึกสำเร็จทั้งที่ไม่มี
      // อะไรเปลี่ยนเลย (เช่นคนที่ถูกลดสิทธิ์แต่ยังเปิดหน้าเดิมค้างไว้)
      const { data, error } = existing
        ? await supabase.from('driver_contacts').update(payload).eq('id', existing.id).select('id')
        : await supabase
            .from('driver_contacts')
            .insert({ ...payload, driver_id: driverId })
            .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('row-level security')
    },
    onSuccess: () => {
      refresh()
      onClose()
    },
    onError: (e: Error) => setErr(translate(e.message)),
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!existing) return
      const { data, error } = await supabase
        .from('driver_contacts')
        .delete()
        .eq('id', existing.id)
        .select('id')
      if (error) throw error
      if (!data?.length) throw new Error('row-level security')
    },
    onSuccess: () => {
      refresh()
      onClose()
    },
    onError: (e: Error) => {
      setConfirmDelete(false)
      setErr(translate(e.message))
    },
  })

  const busy = save.isPending || remove.isPending

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? 'แก้ไขบันทึกการโทร' : 'บันทึกการโทร'}
        style={{ maxWidth: 520 }}
      >
        <div className="card-head">
          <div>
            <h2>{existing ? 'แก้ไขบันทึกการโทร' : 'บันทึกการโทร'}</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              {driverName}
            </div>
          </div>
          <button className="btn btn-sm btn-cancel" onClick={onClose} disabled={busy}>
            ปิด
          </button>
        </div>

        <div className="card-pad">
          {phone && (
            <div className="contact-dial">
              <span className="mono">{fmtPhone(phone)}</span>
              <a className="btn btn-sm" href={`tel:${phone}`}>
                <IconPhone size={14} />
                โทรออก
              </a>
            </div>
          )}

          <div className="field">
            <label id="outcome-label">ผลการโทร</label>
            <div
              className="row"
              role="radiogroup"
              aria-labelledby="outcome-label"
              style={{ gap: 8 }}
            >
              {OUTCOMES.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={outcome === o}
                  className={`btn btn-sm ${outcome === o ? 'btn-primary' : ''}`}
                  onClick={() => setOutcome(o)}
                >
                  {CONTACT_OUTCOME_LABEL[o]}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="contact-note">หมายเหตุ (ไม่บังคับ)</label>
            <textarea
              id="contact-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ minHeight: 64 }}
            />
          </div>

          <div className="field">
            <label htmlFor="contact-at">วันเวลาที่โทร</label>
            <DateTimePicker id="contact-at" value={calledAt} onChange={setCalledAt} max={new Date()} />
          </div>

          {err && (
            <div className="note-box err" style={{ marginBottom: 14 }}>
              {err}
            </div>
          )}

          <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              {existing &&
                (confirmDelete ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      onClick={() => {
                        setErr(null)
                        remove.mutate()
                      }}
                    >
                      {remove.isPending ? 'กำลังลบ…' : 'ยืนยันลบ'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      ไม่ลบ
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-cancel"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    ลบรายการนี้
                  </button>
                ))}
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-cancel" onClick={onClose} disabled={busy}>
                ยกเลิก
              </button>
              <button
                className="btn btn-primary"
                disabled={!outcome || busy}
                onClick={() => {
                  setErr(null)
                  save.mutate()
                }}
              >
                {save.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function translate(msg: string): string {
  if (msg.includes('row-level security') || msg.includes('violates row-level'))
    return 'ไม่มีสิทธิ์ทำรายการนี้ — บันทึกการโทรได้เฉพาะ ops, hr หรือ admin และแก้/ลบได้เฉพาะรายการของตัวเอง'
  if (msg.includes('driver_contacts_outcome_check')) return 'ผลการโทรไม่ถูกต้อง'
  return msg
}
