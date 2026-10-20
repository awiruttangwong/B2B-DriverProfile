import type { BusinessLine } from '../types/database'

/** ป้ายบอกฝั่งของข้อมูลที่กำลังดู/บันทึก — ฟ้า = B2B, ม่วง = EXPRESS */
export default function LineBadge({ line }: { line: BusinessLine }) {
  return (
    <span
      className={`line-badge${line === 'EXPRESS' ? ' express' : ''}`}
      title={`ข้อมูลทั้งหมดในหน้านี้เป็นของฝั่ง ${line}`}
    >
      {line}
    </span>
  )
}
