import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { RatingCriteria } from '../types/database'

const MIN_REASON = 20

const QUICK_TAGS = [
  'ตรงเวลา',
  'ขับนิ่ม',
  'ดูแลสินค้าดี',
  'สื่อสารดี',
  'เอกสารครบ',
  'รายงานช้า',
  'มาสาย',
  'ติดต่อยาก',
  'สินค้าเสียหาย',
]

interface Props {
  driverId: string
  driverName: string
  assignmentId: string | null
  jobLabel?: string
  onClose: () => void
}

export default function RatingDialog({
  driverId,
  driverName,
  assignmentId,
  jobLabel,
  onClose,
}: Props) {
  const { session } = useAuth()
  const qc = useQueryClient()

  const [scores, setScores] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [assignAgain, setAssignAgain] = useState<boolean | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const { data: criteria = [] } = useQuery({
    queryKey: ['rating_criteria'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rating_criteria')
        .select('*')
        .eq('is_active', true)
        .order('display_order')
      if (error) throw error
      return data as RatingCriteria[]
    },
    staleTime: 30 * 60_000,
  })

  const allScored = criteria.length > 0 && criteria.every((c) => scores[c.code])
  const reasonLen = reason.trim().length
  const canSubmit = allScored && reasonLen >= MIN_REASON

  // แสดงคะแนนรวมสด ๆ ให้ผู้ให้คะแนนเห็นผลของน้ำหนักแต่ละเกณฑ์
  const preview =
    allScored && criteria.length
      ? criteria.reduce((sum, c) => sum + (scores[c.code] ?? 0) * Number(c.weight), 0) /
        criteria.reduce((sum, c) => sum + Number(c.weight), 0)
      : null

  const submit = useMutation({
    mutationFn: async () => {
      if (!session?.user) throw new Error('ยังไม่ได้เข้าสู่ระบบ')

      // ค่า overall_score จะถูกคำนวณใหม่โดย trigger หลังบันทึกคะแนนรายเกณฑ์
      // ค่าที่ส่งไปตรงนี้เป็นค่าเริ่มต้นเพื่อผ่าน NOT NULL เท่านั้น
      const { data: rating, error: e1 } = await supabase
        .from('driver_ratings')
        .insert({
          driver_id: driverId,
          assignment_id: assignmentId,
          rater_id: session.user.id,
          overall_score: preview ?? 3,
          reason: reason.trim(),
          tags,
          assign_again: assignAgain,
        })
        .select('id')
        .single()

      if (e1) throw e1

      const rows = criteria
        .filter((c) => scores[c.code])
        .map((c) => ({
          rating_id: rating.id as string,
          criteria_id: c.id,
          score: scores[c.code] as number,
        }))

      const { error: e2 } = await supabase.from('rating_scores').insert(rows)
      if (e2) throw e2
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['driver'] })
      void qc.invalidateQueries({ queryKey: ['drivers'] })
      void qc.invalidateQueries({ queryKey: ['pending'] })
      // ไม่ทำแบบนี้ตัวเลขค้างบนเมนู "รอให้คะแนน" จะไม่ลดจนกว่าแคชจะหมดอายุเอง (2 นาที)
      void qc.invalidateQueries({ queryKey: ['pending-count'] })
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
      <div className="dialog" role="dialog" aria-modal="true" aria-label="ให้คะแนน พขร.">
        <div className="card-head">
          <div>
            <h2>ให้คะแนน · {driverName}</h2>
            {jobLabel && (
              <div className="muted" style={{ fontSize: 13 }}>
                {jobLabel}
              </div>
            )}
          </div>
          <button className="btn btn-sm btn-cancel" onClick={onClose}>
            ปิด
          </button>
        </div>

        <div className="card-pad">
          {!assignmentId && (
            <div className="note-box" style={{ marginBottom: 16 }}>
              คะแนนนี้ไม่ได้ผูกกับงานใดงานหนึ่ง จะถูกบันทึกไว้แต่มีน้ำหนักน้อยกว่า
              คะแนนที่ให้จากงานจริง ถ้าเป็นไปได้ให้เข้าไปให้คะแนนจากรายการงานแทน
            </div>
          )}

          {criteria.map((c) => (
            <div key={c.id} style={{ marginBottom: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <label style={{ marginBottom: 0 }}>
                    {c.label_th}{' '}
                    <span className="mono muted">{Math.round(Number(c.weight) * 100)}%</span>
                  </label>
                  {c.description && (
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
                      {c.description}
                    </div>
                  )}
                </div>
                <Stars
                  value={scores[c.code] ?? 0}
                  onChange={(v) => setScores((s) => ({ ...s, [c.code]: v }))}
                />
              </div>
            </div>
          ))}

          {preview !== null && (
            <div className="note-box ok" style={{ marginBottom: 16 }}>
              คะแนนรวมถ่วงน้ำหนัก <strong className="num">{preview.toFixed(2)}</strong> / 5.00 —
              ระบบคำนวณให้เอง ไม่ต้องกรอกเอง
            </div>
          )}

          <div className="field">
            <label htmlFor="reason">เหตุผล (บังคับ)</label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เล่าสิ่งที่เกิดขึ้นจริงในงานนี้ เช่น ถึงก่อนเวลานัด 40 นาที คุมอุณหภูมิได้นิ่ง แต่โทรกลับช้าตอนติดด่าน"
            />
            <div className={`hint ${reasonLen > 0 && reasonLen < MIN_REASON ? 'err' : ''}`}>
              {reasonLen < MIN_REASON
                ? `อีก ${MIN_REASON - reasonLen} ตัวอักษร — เหตุผลคือส่วนที่มีค่าที่สุดของระบบ ตัวเลขอย่างเดียวบอกไม่ได้ว่าทำไม`
                : `${reasonLen} ตัวอักษร`}
            </div>
          </div>

          <div className="field">
            <label>แท็กสั้น ๆ</label>
            <div className="row" style={{ gap: 6 }}>
              {QUICK_TAGS.map((t) => {
                const on = tags.includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    className={`badge ${on ? 'ok' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="field">
            <label>จะให้งานคนนี้อีกไหม</label>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${assignAgain === true ? 'btn-primary' : ''}`}
                onClick={() => setAssignAgain(assignAgain === true ? null : true)}
              >
                ให้อีก
              </button>
              <button
                type="button"
                className={`btn btn-sm ${assignAgain === false ? 'btn-primary' : ''}`}
                onClick={() => setAssignAgain(assignAgain === false ? null : false)}
              >
                ไม่ให้แล้ว
              </button>
            </div>
          </div>

          {err && (
            <div className="note-box err" style={{ marginBottom: 14 }}>
              {err}
            </div>
          )}

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-cancel" onClick={onClose}>
              ยกเลิก
            </button>
            <button
              className="btn btn-primary"
              disabled={!canSubmit || submit.isPending}
              onClick={() => {
                setErr(null)
                submit.mutate()
              }}
            >
              {submit.isPending ? 'กำลังบันทึก…' : 'บันทึกคะแนน'}
            </button>
          </div>

          <p className="hint" style={{ marginTop: 10 }}>
            แก้ไขได้ภายใน 24 ชั่วโมง หลังจากนั้นระบบจะล็อก และลบไม่ได้
          </p>
        </div>
      </div>
    </div>
  )
}

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="stars" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ดาว`}
          className={`star ${n <= value ? 'on' : ''}`}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function translate(msg: string): string {
  if (msg.includes('driver_ratings_one_per_job'))
    return 'คุณให้คะแนนงานนี้ไปแล้ว หนึ่งงานให้คะแนนได้คนละหนึ่งครั้ง'
  if (msg.includes('driver_ratings_reason_len'))
    return `เหตุผลสั้นเกินไป ต้องอย่างน้อย ${MIN_REASON} ตัวอักษร`
  if (msg.includes('row-level security') || msg.includes('violates row-level'))
    return 'ไม่มีสิทธิ์ให้คะแนนงานนี้ — ให้คะแนนได้เฉพาะงานที่จบแล้วและคุณเกี่ยวข้องด้วย'
  return msg
}
