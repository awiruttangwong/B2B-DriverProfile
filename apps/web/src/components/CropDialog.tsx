import { useEffect, useId, useRef, useState } from 'react'
import { cropToJpeg, loadOrientedBitmap, ImageResizeError } from '../lib/imageResize'

const FRAME_W = 420
const OUT_W = 1000

interface Props {
  file: File
  /** กว้าง/สูง ของกรอบครอป — ตามสัดส่วนบัตรจริง ISO/IEC 7810 ID-1 */
  aspect: number
  title: string
  onCancel: () => void
  onConfirm: (blob: Blob) => void
}

interface Pan {
  x: number
  y: number
}

/**
 * ครอปรูปก่อนอัปโหลด — กรอบนิ่งอยู่กับที่ ผู้ใช้ลาก/ซูมรูปข้างใต้แทน (แบบเดียวกับ
 * ตัวครอปรูปโปรไฟล์ทั่วไป) พื้นที่ในกรอบคือพื้นที่ที่จะถูกครอปเป๊ะ ไม่ต้องคำนวณ
 * ย้อนจากสี่เหลี่ยมที่ลากเอง ลดโอกาสพลาด
 */
export default function CropDialog({ file, aspect, title, onCancel, onConfirm }: Props) {
  const frameH = Math.round(FRAME_W / aspect)
  const outH = Math.round(OUT_W / aspect)
  const zoomId = useId()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; pan: Pan } | null>(null)

  const [ready, setReady] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const [baseScale, setBaseScale] = useState(1)

  useEffect(() => {
    let cancelled = false
    loadOrientedBitmap(file)
      .then((bmp) => {
        if (cancelled) {
          bmp.close()
          return
        }
        bitmapRef.current = bmp
        const base = Math.max(FRAME_W / bmp.width, frameH / bmp.height)
        setBaseScale(base)
        setPan({
          x: (FRAME_W - bmp.width * base) / 2,
          y: (frameH - bmp.height * base) / 2,
        })
        setReady(true)
      })
      .catch((e: Error) => setErr(e instanceof ImageResizeError ? e.message : 'เปิดไฟล์รูปนี้ไม่ได้'))
    return () => {
      cancelled = true
      bitmapRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const clamp = (p: Pan, scale: number): Pan => {
    const bmp = bitmapRef.current
    if (!bmp) return p
    const dw = bmp.width * scale
    const dh = bmp.height * scale
    const minX = Math.min(0, FRAME_W - dw)
    const minY = Math.min(0, frameH - dh)
    return { x: Math.min(0, Math.max(minX, p.x)), y: Math.min(0, Math.max(minY, p.y)) }
  }

  // วาดใหม่ทุกครั้งที่ pan/zoom เปลี่ยน — กรอบที่เห็น = พื้นที่ที่จะครอปเป๊ะ
  useEffect(() => {
    const canvas = canvasRef.current
    const bmp = bitmapRef.current
    if (!canvas || !bmp || !ready) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = baseScale * zoom
    ctx.clearRect(0, 0, FRAME_W, frameH)
    ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, pan.x, pan.y, bmp.width * scale, bmp.height * scale)
  }, [pan, zoom, baseScale, ready, frameH])

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startY: e.clientY, pan }
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setPan(clamp({ x: dragRef.current.pan.x + dx, y: dragRef.current.pan.y + dy }, baseScale * zoom))
  }
  function onPointerUp() {
    dragRef.current = null
  }

  function onZoom(next: number) {
    setZoom(next)
    setPan((p) => clamp(p, baseScale * next))
  }

  async function confirm() {
    const bmp = bitmapRef.current
    if (!bmp) return
    setBusy(true)
    setErr(null)
    try {
      const scale = baseScale * zoom
      // กันพลาดจุดทศนิยมที่ขอบพอดี (ลากไปสุดขอบ + ซูมบางค่า) ไม่ให้สี่เหลี่ยมที่
      // ขอไปวาดล้ำขอบ bitmap จริงแม้เสี้ยว px เดียว
      const cropW = Math.min(FRAME_W / scale, bmp.width)
      const cropH = Math.min(frameH / scale, bmp.height)
      const cropX = Math.min(Math.max(0, -pan.x / scale), bmp.width - cropW)
      const cropY = Math.min(Math.max(0, -pan.y / scale), bmp.height - cropH)
      const blob = await cropToJpeg(bmp, { x: cropX, y: cropY, width: cropW, height: cropH }, OUT_W, outH)
      onConfirm(blob)
    } catch (e) {
      setErr(e instanceof ImageResizeError ? e.message : 'ครอปรูปไม่สำเร็จ')
      setBusy(false)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`ครอปรูป ${title}`} style={{ maxWidth: FRAME_W + 56 }}>
        <div className="card-head">
          <h2 style={{ fontSize: 16 }}>ครอปรูป{title}</h2>
          <button className="btn btn-sm btn-cancel" onClick={onCancel} disabled={busy}>
            ปิด
          </button>
        </div>

        <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          {!ready && !err && (
            <div style={{ width: FRAME_W, height: frameH, display: 'grid', placeItems: 'center' }}>
              <span className="spinner" />
            </div>
          )}
          {err && (
            <div className="note-box err" style={{ width: '100%' }}>
              {err}
            </div>
          )}
          {ready && (
            <>
              <canvas
                ref={canvasRef}
                width={FRAME_W}
                height={frameH}
                className="crop-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
              <div className="muted" style={{ fontSize: 11.5, marginTop: -6 }}>
                ลากรูปเพื่อจัดตำแหน่งให้เห็นแค่ตัวบัตร
              </div>
              <div className="row" style={{ width: '100%', gap: 10 }}>
                <label htmlFor={zoomId} className="muted" style={{ fontSize: 12 }}>
                  ซูม
                </label>
                <input
                  id={zoomId}
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => onZoom(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
              </div>
            </>
          )}

          <div className="row" style={{ justifyContent: 'flex-end', width: '100%', marginTop: 4 }}>
            <button className="btn btn-cancel" onClick={onCancel} disabled={busy}>
              ยกเลิก
            </button>
            <button className="btn btn-primary" onClick={confirm} disabled={!ready || busy}>
              {busy ? 'กำลังครอป…' : 'ยืนยันครอป'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
