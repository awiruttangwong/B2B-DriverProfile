import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, IS_DEMO } from '../lib/supabase'
import { validateImageFile, ImageResizeError, ID_CARD_ASPECT } from '../lib/imageResize'
import { IconUpload } from './icons'
import CropDialog from './CropDialog'

type DocType = 'id_card' | 'driver_license'

interface Props {
  driverId: string
  docType: DocType
  label: string
  path: string | null
}

const BUCKET = 'driver-documents'
// แค่พอโหลด thumbnail/เปิดดูตอนนี้ ไม่เก็บ URL ไว้ใช้ซ้ำภายหลัง
const SIGNED_URL_TTL = 60

function objectPath(driverId: string, docType: DocType) {
  return `${driverId}/${docType === 'id_card' ? 'id_card' : 'license'}.jpg`
}

function translate(msg: string): string {
  if (msg.includes('row-level security') || msg.includes('violates row-level'))
    return 'ไม่มีสิทธิ์ทำรายการนี้ — อัปโหลดเอกสารได้เฉพาะ hr หรือ admin'
  return msg
}

export default function DocumentSlot({ driverId, docType, label, path }: Props) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [preview, setPreview] = useState(false)

  const column = docType === 'id_card' ? 'id_card_path' : 'driver_license_path'

  // path เป็นชื่อไฟล์ตายตัวต่อคนต่อประเภท (upsert ทับของเดิมเสมอ) — "เปลี่ยนรูป" จึงได้
  // path ตัวเดิมเป๊ะ query key จึงต้องไม่ผูกกับ path เพื่อให้ invalidate หลังอัปโหลด
  // ทับสำเร็จ ทำให้ query นี้ refetch จริง ไม่งั้นจะค้าง signed URL ของรูปเก่าไว้เฉย ๆ
  // (เคยเกิดจริง: เปลี่ยนรูปสำเร็จแต่ยังเห็นรูปเก่าเพราะ query key ไม่เปลี่ยนเลย)
  const signedUrl = useQuery({
    queryKey: ['driver-document-url', driverId, docType],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path as string, SIGNED_URL_TTL)
      if (error) throw error
      return data.signedUrl
    },
    enabled: !!path,
    staleTime: (SIGNED_URL_TTL - 10) * 1000,
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['driver', driverId, 'private'] })
    void qc.invalidateQueries({ queryKey: ['driver-document-url', driverId, docType] })
  }

  const upload = useMutation({
    mutationFn: async (blob: Blob) => {
      const key = objectPath(driverId, docType)
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(key, blob, { contentType: 'image/jpeg', upsert: true })
      if (upErr) throw upErr

      // path เป็นชื่อไฟล์ตายตัว — ถ้ามีแถวอยู่แล้ว ค่าที่จะเขียนจะเหมือนของเดิมเป๊ะ
      // ("เปลี่ยนรูป" ทับไฟล์เดิม ไม่มีอะไรในฐานข้อมูลต้องเปลี่ยน) เขียนจริงแค่ตอน
      // อัปโหลดครั้งแรกที่คอลัมน์ยังเป็น null เท่านั้น — ตัดจังหวะเสี่ยงที่ storage
      // อัปสำเร็จแต่เขียน DB ไม่ทัน (เน็ตหลุดพอดี) ออกไปได้เลยสำหรับกรณีเปลี่ยนรูป
      // ซึ่งเป็นกรณีที่เกิดบ่อยกว่าอัปโหลดครั้งแรกมาก
      if (path === key) return

      const patch: Partial<{ id_card_path: string; driver_license_path: string }> =
        docType === 'id_card' ? { id_card_path: key } : { driver_license_path: key }
      // .select() หลังเขียนเสมอ — RLS ปฏิเสธไม่ส่ง error กลับมา แค่แก้ได้ 0 แถวแบบเงียบ ๆ
      const { data, error } = await supabase
        .from('driver_private')
        .upsert({ driver_id: driverId, ...patch }, { onConflict: 'driver_id' })
        .select('driver_id')
      if (error) throw error
      if (!data?.length) throw new Error('row-level security')
    },
    onMutate: () => setErr(null),
    onSuccess: refresh,
    onError: (e: Error) => setErr(e instanceof ImageResizeError ? e.message : translate(e.message)),
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!path) return
      // ตัดฐานข้อมูลก่อน ลบไฟล์จริงทีหลัง — ถ้าขั้นตอนหลังล้ม (เน็ตหลุดพอดี) จะเหลือ
      // ไฟล์ค้างใน storage ที่ไม่มีอะไรอ้างถึงแล้ว (เก็บกวาดทีหลังได้ ไม่กระทบอะไร)
      // ดีกว่าลำดับกลับกันที่จะเหลือ path ใน DB ชี้ไปยังไฟล์ที่ถูกลบไปแล้ว ทำให้
      // เห็นเป็นรูปเสีย/โหลดไม่ขึ้นตอนเปิดหน้าครั้งถัดไป
      const { data, error } = await supabase
        .from('driver_private')
        .update({ [column]: null })
        .eq('driver_id', driverId)
        .select('driver_id')
      if (error) throw error
      if (!data?.length) throw new Error('row-level security')

      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
      if (rmErr) throw rmErr
    },
    onSuccess: () => {
      setConfirmDelete(false)
      refresh()
    },
    onError: (e: Error) => {
      setConfirmDelete(false)
      setErr(translate(e.message))
    },
  })

  const busy = upload.isPending || remove.isPending

  function pick(file: File | undefined) {
    if (!file || busy) return
    setErr(null)
    try {
      validateImageFile(file)
      setCropFile(file)
    } catch (e) {
      setErr(e instanceof ImageResizeError ? e.message : 'เปิดไฟล์รูปนี้ไม่ได้')
    }
  }

  if (IS_DEMO) {
    return (
      <div className="doc-slot-wrap">
        <div className="doc-slot dropzone disabled">
          <div>
            <b>{label}</b>
            <span className="doc-slot-hint">ไม่รองรับในโหมดทดลอง</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="doc-slot-wrap">
      {path ? (
        <div className="doc-slot doc-slot-filled">
          <button
            type="button"
            className="doc-slot-thumb"
            title="คลิกเพื่อดูรูปขนาดเต็ม"
            disabled={!signedUrl.data}
            onClick={() => signedUrl.data && setPreview(true)}
          >
            {signedUrl.data && !busy && !signedUrl.isFetching ? (
              <img src={signedUrl.data} alt={label} />
            ) : (
              <span className="spinner" />
            )}
          </button>
          <div className="doc-slot-info">
            <b>{label}</b>
            <div className="doc-slot-links">
              {confirmDelete ? (
                <>
                  <button
                    type="button"
                    className="doc-slot-link danger"
                    disabled={busy}
                    onClick={() => remove.mutate()}
                  >
                    {remove.isPending ? 'กำลังลบ…' : 'ยืนยันลบ'}
                  </button>
                  ·
                  <button
                    type="button"
                    className="doc-slot-link"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    ยกเลิก
                  </button>
                </>
              ) : busy ? (
                'กำลังอัปโหลด…'
              ) : (
                <>
                  <button
                    type="button"
                    className="doc-slot-link"
                    onClick={() => inputRef.current?.click()}
                  >
                    เปลี่ยนรูป
                  </button>
                  ·
                  <button
                    type="button"
                    className="doc-slot-link danger"
                    onClick={() => setConfirmDelete(true)}
                  >
                    ลบ
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`doc-slot dropzone${dragOver ? ' dragover' : ''}${busy ? ' disabled' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`อัปโหลดรูป${label}`}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click()
          }}
          onDragOver={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault()
            if (!busy) setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault()
            setDragOver(false)
            pick(e.dataTransfer.files?.[0])
          }}
        >
          <span className="dropzone-icon">
            {busy ? <span className="spinner" /> : <IconUpload size={17} />}
          </span>
          <div>
            <b>{label}</b>
            <span className="doc-slot-hint">
              {busy ? 'กำลังอัปโหลด…' : 'คลิกหรือวางรูป'}
            </span>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {err && <div className="doc-slot-err">{err}</div>}

      {preview && signedUrl.data && (
        // ดูรูปเต็มในแอปเท่านั้น — ตั้งใจไม่เปิดแท็บใหม่/window.open เพราะจะเผย signed
        // URL ออกไปอยู่นอกแอป (โผล่ในแถบที่อยู่เว็บ เผลอแชร์/บันทึกลิงก์ต่อได้ง่าย)
        // ซึ่งไม่เหมาะกับเอกสารอ่อนไหวอย่างบัตร ปชช./ใบขับขี่
        <div
          className="dialog-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreview(false)
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`ดูรูป ${label}`}
            style={{ maxWidth: 640, padding: 0, overflow: 'hidden' }}
          >
            <img
              src={signedUrl.data}
              alt={label}
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
            <div className="row" style={{ justifyContent: 'flex-end', padding: 12 }}>
              <button className="btn btn-cancel" onClick={() => setPreview(false)}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {cropFile && (
        <CropDialog
          file={cropFile}
          aspect={ID_CARD_ASPECT}
          title={label}
          onCancel={() => setCropFile(null)}
          onConfirm={(blob) => {
            setCropFile(null)
            upload.mutate(blob)
          }}
        />
      )}
    </div>
  )
}
