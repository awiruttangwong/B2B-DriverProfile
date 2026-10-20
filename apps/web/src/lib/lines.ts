import type { BusinessLine } from '../types/database'

/**
 * ชื่อฝั่งที่ผู้ใช้เห็น — ค่าในฐานข้อมูลยังเป็น 'B2B' ตามเดิม (hash กันซ้ำ, id, RLS ผูกกับค่านี้)
 * เปลี่ยนแค่คำที่แสดง: ฝั่ง B2B เรียกว่า TRANSPORT
 */
export const LINE_LABEL: Record<BusinessLine, string> = {
  B2B: 'TRANSPORT',
  EXPRESS: 'EXPRESS',
}

export function lineLabel(line: BusinessLine): string {
  return LINE_LABEL[line]
}

/** ค่าในคอลัมน์ "ประเภท" ของไฟล์ → ฝั่ง (รับทั้งชื่อเดิม B2B และชื่อใหม่ TRANSPORT) */
export function parseLine(value: string | null | undefined): BusinessLine | null {
  const v = value?.trim().toUpperCase()
  if (v === 'B2B' || v === 'TRANSPORT') return 'B2B'
  if (v === 'EXPRESS') return 'EXPRESS'
  return null
}
