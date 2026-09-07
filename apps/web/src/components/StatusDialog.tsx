import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { DriverStatus } from '../types/database'
import { STATUS_LABEL } from '../lib/format'

const MIN_REASON = 10

/** สถานะที่ทำให้ พขร. หายจากหน้าหาคนสำหรับงาน จึงต้องกรอกเหตุผล */
export const BLOCKING: DriverStatus[] = ['inactive', 'blacklisted']

const OPTIONS: {
  v: DriverStatus
  desc: string
  tone: 'ok' | 'warn' | 'bad'
}[] = [
  {
    v: 'active',
    desc: 'รับงานได้ตามปกติ และขึ้นในหน้าหาคนสำหรับงาน',
    tone: 'ok',
  },
  {
    v: 'probation',
    desc: 'ยังรับงานได้และยังขึ้นในการจัดอันดับ แต่ทำเครื่องหมายไว้ว่าต้องจับตา',
    tone: 'warn',
  },
  {
    v: 'inactive',
    desc: 'พักงานชั่วคราว จะไม่ขึ้นในหน้าหาคนสำหรับงาน แต่ประวัติงานเดิมยังอยู่ครบ',
    tone: 'warn',
  },
  {
    v: 'blacklisted',
    desc: 'ห้ามใช้งานถาวร จะไม่ขึ้นในการจัดอันดับทุกกรณี',
    tone: 'bad',
  },
]

interface Props {
  driverId: string
  driverName: string
  current: DriverStatus
  currentReason: string | null
  onClose: () => void
}

export default function StatusDialog({
  driverId,
  driverName,
  current,
  currentReason,
  onClose,
}: Props) {
  const qc = useQueryClient()
  const [next, setNext] = useState<DriverStatus>(current)
  const [reason, setReason] = useState(currentReason ?? '')
  const [err, setErr] = useState<string | null>(null)

  const needsReason = BLOCKING.includes(next)
  const reasonLen = reason.trim().length
  const changed = next !== current
  const canSave = changed && (!needsReason || reasonLen >= MIN_REASON)

  const save = useMutation({
    mutationFn: async () => {
      // ทริกเกอร์ในฐานข้อมูลจะบันทึกประวัติการเปลี่ยนให้เอง
      // แอปจึงเขียนแค่ตาราง drivers ตารางเดียว
      const { error } = await supabase
        .from('drivers')
        .update({
          status: next,
          status_reason: needsReason ? reason.trim() : null,
        })
        .eq('id', driverId)
      if (error) throw error
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['driver'] })
      void qc.invalidateQueries({ queryKey: ['drivers'] })
      void qc.invalidateQueries({ queryKey: ['driver-kpis'] })
      void qc.invalidateQueries({ queryKey: ['fit'] })
      onClose()
    },
    onError: (e: Error) => setErr(translate(e.message)),
  })

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`เปลี่ยนสถานะของ ${driverName}`}
        style={{ maxWidth: 540 }}
      >
        <div className="card-head">
          <div>
            <h2>เปลี่ยนสถานะ</h2>
            <div className="muted" style={{ fontSize: 13 }}>
              {driverName}
            </div>
          </div>
          <button className="btn btn-sm" onClick={onClose}>
            ปิด
          </button>
        </div>

        <div className="card-pad">
          <div role="radiogroup" aria-label="สถานะ" style={{ display: 'grid', gap: 8 }}>
            {OPTIONS.map((o) => {
              const on = next === o.v
              return (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setNext(o.v)}
                  style={{
                    textAlign: 'left',
                    display: 'flex',
                    gap: 11,
                    alignItems: 'flex-start',
                    padding: '11px 13px',
                    borderRadius: 'var(--r)',
                    border: `1px solid ${on ? 'var(--brand)' : 'var(--line)'}`,
                    background: on ? 'var(--brand-soft)' : 'var(--surface)',
                    cursor: 'pointer',
                    width: '100%',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: `2px solid ${on ? 'var(--brand)' : 'var(--line-strong)'}`,
                      background: on
                        ? 'radial-gradient(circle, var(--brand) 0 4px, transparent 5px)'
                        : 'transparent',
                      marginTop: 3,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="row" style={{ gap: 7, marginBottom: 1 }}>
                      <span className={`badge ${o.tone}`}>{STATUS_LABEL[o.v] ?? o.v}</span>
                      {o.v === current && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          สถานะปัจจุบัน
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13,
                        color: 'var(--ink-2)',
                        lineHeight: 1.55,
                      }}
                    >
                      {o.desc}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {needsReason && (
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="sr">เหตุผล (บังคับ)</label>
              <textarea
                id="sr"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{ minHeight: 76 }}
                placeholder="เช่น ทำสินค้าเสียหาย 3 ครั้งใน 2 เดือน ลูกค้า OFM ขอไม่ให้ส่งคนนี้อีก"
              />
              <div className={`hint ${reasonLen > 0 && reasonLen < MIN_REASON ? 'err' : ''}`}>
                {reasonLen < MIN_REASON
                  ? `อีก ${MIN_REASON - reasonLen} ตัวอักษร — สถานะนี้ตัดคนออกจากการรับงาน ต้องอธิบายได้ว่าทำไม`
                  : `${reasonLen} ตัวอักษร`}
              </div>
            </div>
          )}

          {changed && needsReason && (
            <div className="note-box warn" style={{ marginTop: 14 }}>
              หลังบันทึก <strong>{driverName}</strong> จะไม่ปรากฏในหน้า “หาคนสำหรับงาน” อีก
              ประวัติงานและคะแนนเดิมยังอยู่ครบ และเปลี่ยนกลับได้ทุกเมื่อ
            </div>
          )}

          {err && (
            <div className="note-box err" style={{ marginTop: 14 }}>
              {err}
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
            <button className="btn" onClick={onClose}>
              ยกเลิก
            </button>
            <button
              className="btn btn-primary"
              disabled={!canSave || save.isPending}
              onClick={() => {
                setErr(null)
                save.mutate()
              }}
            >
              {save.isPending ? 'กำลังบันทึก…' : 'บันทึกสถานะ'}
            </button>
          </div>

          <p className="hint" style={{ marginTop: 10 }}>
            ทุกการเปลี่ยนสถานะถูกบันทึกไว้ว่าใครเปลี่ยน เมื่อไร และเพราะอะไร ลบไม่ได้
          </p>
        </div>
      </div>
    </div>
  )
}

function translate(msg: string): string {
  if (msg.includes('drivers_status_reason_required'))
    return `สถานะนี้ต้องมีเหตุผลอย่างน้อย ${MIN_REASON} ตัวอักษร`
  if (msg.includes('row-level security') || msg.includes('violates row-level'))
    return 'ไม่มีสิทธิ์เปลี่ยนสถานะ — ต้องเป็น ops, hr หรือ admin'
  return msg
}
