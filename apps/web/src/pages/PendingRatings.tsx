import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { DriverDirectoryRow, DriverPendingReviewRow } from '../types/database'
import { fmtDateShort, fmtNum, fmtPhone, fmtScore, safeSearchTerm } from '../lib/format'
import { JOB_RANGE_OPTIONS } from '../lib/jobRanges'
import ClearableSelect from '../components/ClearableSelect'
import RatingDialog from '../components/RatingDialog'
import SkeletonRows from '../components/SkeletonRows'

const PAGE = 40

interface TargetDriver {
  id: string
  full_name: string
}

/**
 * ตัวกรองคิวรอประเมิน — แยกเป็นสองแกนที่ตอบคนละคำถาม
 *
 *   จำนวนเที่ยว   = คนนี้วิ่งมามากแค่ไหน (ประสบการณ์) — ใช้ตัวเลือกชุดเดียวกับ
 *                    หน้ารายชื่อ พขร. (JOB_RANGE_OPTIONS) เพื่อให้ผู้ใช้เจอตัวเลือก
 *                    เดิมทุกหน้า และเป็นช่วงปิด (เช่น "10-20 เที่ยว") ไม่ใช่ขั้นต่ำ
 *                    เปิดปลาย เพราะคิวรอประเมินส่วนใหญ่เป็นคนวิ่งน้อย ถ้าใช้ขั้นต่ำ
 *                    เปิดปลายหลายระดับ (เกิน 10/20/50/100) จะได้ผลลัพธ์ว่างซ้ำกัน
 *                    แทบทุกระดับ กดเลือกอันไหนก็ดูเหมือนไม่มีอะไรเปลี่ยน
 *   วิ่งงานล่าสุด = คนนี้ยังทำงานอยู่ไหม (ความสด)
 *
 * ต้องเลือกพร้อมกันได้ เพราะรายการที่มีค่าที่สุดของหน้านี้เกิดจากการรวมสองแกน
 * เช่น "10-20 เที่ยว + ยังวิ่งอยู่ใน 30 วัน" คือคนวิ่งพอมีประสบการณ์ที่กำลังทำงาน
 * อยู่แต่ยังไม่มีใครรู้ฝีมือ ถ้ายุบเป็นรายการเดียวจะเลือกแบบนี้ไม่ได้เลย
 *
 * ไม่มีตัวเลือก "วิ่งใน 7 วัน" เพราะข้อมูลงานมาจากการอัปโหลดไฟล์เป็นรอบ ไม่ใช่
 * ข้อมูลสด (งานล่าสุดในระบบเก่ากว่าวันนี้ 9 วันตอนที่วัด) ตัวกรองช่วงสั้นกว่านั้น
 * จะวัด "เราอัปโหลดไฟล์ล่าสุดเมื่อไร" แทนที่จะวัด "ใครยังวิ่งอยู่" แล้วขึ้นหน้าว่าง
 *
 * ค่าเริ่มต้นของช่อง "วิ่งงานล่าสุด" คือ "ไม่จำกัด" ให้ตรงกับตัวเลขบนเมนูและหน้ารายชื่อ
 * พขร. — ทั้งสามจุดนับจากสถานะ active/probation ล้วน ๆ ไม่กรองด้วยวันที่อีกชั้น
 * เพราะสถานะคือสิ่งที่คนตัดสินใจปิดเองอยู่แล้วเมื่อเลิกใช้งานจริง ต้องอิงเงื่อนไข
 * เดียวกันเสมอ ไม่งั้นตัวเลขจะไม่ตรงกันข้ามหน้า
 */
const DAY_OPTIONS = [
  { value: '', label: 'ไม่จำกัด' },
  { value: '30', label: 'ใน 30 วันล่าสุด' },
  { value: '90', label: 'ใน 90 วันล่าสุด' },
  { value: '180', label: 'ใน 180 วันล่าสุด' },
]

export default function PendingRatings() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  // อ่านจาก URL ครั้งเดียวตอนเมาท์ แล้วเขียนกลับออกไปทางเดียวใน effect ท้ายบล็อกนี้
  // (เหตุผลเดียวกับหน้ารายชื่อ พขร.) กดย้อนกลับจากโปรไฟล์คนที่กดประเมิน/กดจากผลค้นหา
  // จึงเห็นตัวกรอง+หน้าเดิม แทนที่จะรีเซ็ตเป็นค่าเริ่มต้นทุกครั้ง
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('page'))
    return Number.isFinite(p) && p > 0 ? p - 1 : 0
  })
  const [target, setTarget] = useState<TargetDriver | null>(null)
  const [q, setQ] = useState(() => searchParams.get('q') ?? '')

  // ค่าเริ่มต้น = ไม่จำกัด (ตรงกับตัวเลขบนเมนูและหน้ารายชื่อ พขร. ซึ่งนับจากสถานะ
  // active/probation ล้วน ๆ แล้ว) ไม่ผูกกับจำนวนเที่ยวเลย เพราะคนที่เพิ่งเริ่มวิ่ง
  // แล้วยังไม่มีใครรู้ฝีมือควรถูกเห็นตั้งแต่แรกเหมือนกับคนที่วิ่งมานาน
  const [jobRange, setJobRange] = useState(() => {
    const v = searchParams.get('jobs') ?? ''
    return JOB_RANGE_OPTIONS.some((o) => o.value === v) ? v : ''
  })
  const [maxDays, setMaxDays] = useState(() => {
    const v = searchParams.get('days') ?? ''
    return DAY_OPTIONS.some((o) => o.value === v) ? v : ''
  })

  useEffect(() => {
    setSearchParams(
      (sp) => {
        const next = new URLSearchParams(sp)
        const setOrDelete = (k: string, v: string, isDefault: boolean) => {
          if (isDefault) next.delete(k)
          else next.set(k, v)
        }
        setOrDelete('q', q, !q)
        setOrDelete('jobs', jobRange, !jobRange)
        setOrDelete('days', maxDays, !maxDays)
        setOrDelete('page', String(page + 1), page === 0)
        return next
      },
      { replace: true },
    )
  }, [q, jobRange, maxDays, page, setSearchParams])

  const { data, isLoading, error } = useQuery({
    queryKey: ['pending', page, jobRange, maxDays],
    queryFn: async () => {
      let query = supabase
        .from('drivers_pending_review')
        .select('*', { count: 'exact' })
        .order('total_jobs', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1)

      const range = JOB_RANGE_OPTIONS.find((o) => o.value === jobRange)
      if (range?.min !== undefined) query = query.gte('total_jobs', range.min)
      if (range?.max !== undefined) query = query.lte('total_jobs', range.max)
      if (maxDays) query = query.lte('days_since_last_job', Number(maxDays))

      const { data, error, count } = await query
      if (error) throw error
      return { rows: (data ?? []) as DriverPendingReviewRow[], count: count ?? 0 }
    },
  })

  const pages = Math.ceil((data?.count ?? 0) / PAGE)

  const pick = (which: 'jobs' | 'days', value: string) => {
    if (which === 'jobs') setJobRange(value)
    else setMaxDays(value)
    setPage(0)
  }

  // สรุปเงื่อนไขที่ใช้อยู่เป็นคำพูด ไม่ให้ผู้ใช้ต้องเดาว่าตัวเลขที่เห็นมาจากเงื่อนไขไหน
  const activeLabel =
    [
      JOB_RANGE_OPTIONS.find((o) => o.value === jobRange && o.value)?.label,
      DAY_OPTIONS.find((o) => o.value === maxDays && o.value)?.label,
    ]
      .filter(Boolean)
      .join(' · ') || 'ทั้งหมด'

  // ค้นหาคนขับคนไหนก็ได้เพื่อประเมิน (ใช้ตอนต้องการประเมินซ้ำคนที่เคยประเมินไปแล้ว)
  const term = safeSearchTerm(q)
  const search = useQuery({
    queryKey: ['pending-search', term],
    enabled: term.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('driver_directory')
        .select('id, driver_code, full_name, phone, rating_count, adjusted_score')
        .or(`full_name.ilike.%${term}%,driver_code.ilike.%${term}%,phone.ilike.%${term}%`)
        .limit(8)
      if (error) throw error
      return (data ?? []) as DriverDirectoryRow[]
    },
  })

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>พขร. ที่รอประเมิน</h1>
          <p>
            ประเมินเป็นรายคน ครอบคลุมภาพรวมการทำงานทั้งหมด ไม่ใช่ทีละเที่ยว — ถ้าคนขับไม่เหมาะกับงาน
            บางประเภท ให้บันทึกไว้ในช่องเหตุผลตอนประเมิน
          </p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <label htmlFor="dsearch">
          ค้นหาคนขับเพื่อประเมิน (ประเมินซ้ำคนที่เคยประเมินแล้วได้ เพื่อปรับปรุงผลประเมิน)
        </label>
        <input
          id="dsearch"
          type="search"
          autoComplete="off"
          placeholder="ชื่อ, รหัส พขร. หรือเบอร์โทร — พิมพ์อย่างน้อย 2 ตัวอักษร"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {term.length >= 2 && (
          <div className="tablewrap" style={{ marginTop: 10, border: 0, borderRadius: 0 }}>
            {search.isLoading && (
              <div className="empty" style={{ padding: 12 }}>
                <span className="spinner" /> กำลังค้นหา…
              </div>
            )}
            {!search.isLoading && (search.data?.length ?? 0) === 0 && (
              <div className="empty" style={{ padding: 12 }}>
                ไม่พบคนขับที่ตรงกับคำค้นนี้
              </div>
            )}
            {(search.data ?? []).map((d) => (
              <div
                key={d.id}
                className="row"
                style={{ justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)' }}
              >
                <div>
                  <Link to={`/drivers/${d.id}`} style={{ fontWeight: 500 }}>
                    {d.full_name}
                  </Link>{' '}
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {fmtPhone(d.phone)}
                  </span>
                </div>
                <div className="row" style={{ gap: 10 }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {d.rating_count && d.rating_count > 0
                      ? `เคยประเมินแล้ว · ${fmtScore(d.adjusted_score)}`
                      : 'ยังไม่เคยประเมิน'}
                  </span>
                  {can('admin', 'ops', 'hr') && (
                    <button
                      className="btn btn-sm"
                      onClick={() => setTarget({ id: d.id, full_name: d.full_name })}
                    >
                      {d.rating_count && d.rating_count > 0 ? 'ประเมินใหม่' : 'ประเมิน'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="note-box err">โหลดข้อมูลไม่สำเร็จ: {(error as Error).message}</div>}

      <div className="card card-pad" style={{ marginBottom: 14 }}>
        <div className="filters-row">
          <div style={{ flex: '1 1 170px' }}>
            <label htmlFor="fj">จำนวนเที่ยว</label>
            <ClearableSelect
              id="fj"
              value={jobRange}
              onChange={(v) => pick('jobs', v)}
              options={JOB_RANGE_OPTIONS}
              clearLabel="ล้างตัวกรองจำนวนเที่ยว"
            />
          </div>
          <div style={{ flex: '1 1 170px' }}>
            <label htmlFor="fd">วิ่งงานล่าสุด</label>
            <ClearableSelect
              id="fd"
              value={maxDays}
              onChange={(v) => pick('days', v)}
              options={DAY_OPTIONS}
              clearLabel="ล้างตัวกรองวิ่งงานล่าสุด"
            />
          </div>
        </div>

        <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
          เลือกสองช่องพร้อมกันได้ เช่น “10-20 เที่ยว” คู่กับ “ใน 30 วันล่าสุด” จะได้คนวิ่งพอมีประสบการณ์ที่ยังทำงานอยู่ตอนนี้
        </p>
      </div>

      {data && (
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          {activeLabel} — แสดง {fmtNum(data.count)} คน
          {pages > 1 && ` · หน้า ${page + 1} จาก ${fmtNum(pages)}`}
        </p>
      )}

      <div className="tablewrap pending-table">
        <table>
          <thead>
            <tr>
              <th>พขร.</th>
              <th>เบอร์โทร</th>
              <th style={{ textAlign: 'center' }}>เที่ยววิ่งสะสม</th>
              <th style={{ textAlign: 'center' }}>งานล่าสุด</th>
              <th className="col-action" style={{ textAlign: 'center' }}>
                สถานะ
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <SkeletonRows
                rows={6}
                columns={[
                  { width: '65%' }, // พขร.
                  { width: '55%' }, // เบอร์โทร (ไม่กึ่งกลาง ต่างจากตารางอื่น)
                  { width: '50%', align: 'center' }, // เที่ยววิ่งสะสม
                  { width: '50%', align: 'center' }, // งานล่าสุด
                  { width: '50%', align: 'center' }, // สถานะ
                ]}
              />
            )}
            {!isLoading && (data?.rows.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  ไม่มีคนขับที่รอประเมิน
                </td>
              </tr>
            )}
            {(data?.rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>
                  <Link to={`/drivers/${r.id}`}>{r.full_name}</Link>
                </td>
                <td className="mono nowrap">{fmtPhone(r.phone)}</td>
                <td className="num" style={{ textAlign: 'center' }}>
                  {fmtNum(r.total_jobs)}
                </td>
                <td className="nowrap mono" style={{ fontSize: 12, textAlign: 'center' }}>
                  {fmtDateShort(r.last_job_date)}
                </td>
                <td className="nowrap col-action" style={{ textAlign: 'center' }}>
                  {can('admin', 'ops', 'hr') ? (
                    <button
                      className="btn btn-sm"
                      onClick={() => setTarget({ id: r.id, full_name: r.full_name })}
                    >
                      ประเมิน
                    </button>
                  ) : (
                    <span className="muted" style={{ fontSize: 12 }}>
                      ไม่มีสิทธิ์
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ก่อนหน้า
          </button>
          <button
            className="btn btn-sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage(page + 1)}
          >
            ถัดไป
          </button>
        </div>
      )}

      {target && (
        <RatingDialog
          driverId={target.id}
          driverName={target.full_name}
          onClose={() => setTarget(null)}
        />
      )}
    </main>
  )
}
