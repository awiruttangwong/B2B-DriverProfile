const MAX_SOURCE_BYTES = 20 * 1024 * 1024

/** สัดส่วนบัตร ปชช./ใบขับขี่จริงตามมาตรฐาน ISO/IEC 7810 ID-1 (85.6 × 54 มม.) */
export const ID_CARD_ASPECT = 1.586

export class ImageResizeError extends Error {}

export function validateImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new ImageResizeError('ไฟล์ต้องเป็นรูปภาพเท่านั้น')
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImageResizeError('ไฟล์ใหญ่เกินไป (จำกัด 20MB)')
  }
}

/**
 * อ่านไฟล์เป็น bitmap พร้อมแก้ทิศทางรูปที่หมุนมาจากกล้องมือถือให้อัตโนมัติ (EXIF
 * orientation) — ใช้ bitmap เดียวกันนี้ทั้งตอนพรีวิวให้ผู้ใช้ลากครอปและตอนวาด
 * ผลลัพธ์จริง กันพิกัดเพี้ยนถ้ารูปที่เห็นกับรูปที่ครอปไม่ตรงกัน
 */
export async function loadOrientedBitmap(file: File): Promise<ImageBitmap> {
  validateImageFile(file)
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageResizeError('เปิดไฟล์รูปนี้ไม่ได้')
  }
}

/** วาดส่วนที่เลือก (พิกัดจริงบน bitmap ต้นฉบับ) ลงเป็น JPEG ขนาดคงที่ */
export async function cropToJpeg(
  bitmap: ImageBitmap,
  crop: { x: number; y: number; width: number; height: number },
  outWidth: number,
  outHeight: number,
  quality = 0.85,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new ImageResizeError('เบราว์เซอร์ไม่รองรับการประมวลผลรูปภาพ')
  ctx.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outWidth,
    outHeight,
  )
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) throw new ImageResizeError('บันทึกรูปไม่สำเร็จ')
  return blob
}
