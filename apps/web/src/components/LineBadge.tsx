import type { BusinessLine } from '../types/database'
import { lineLabel } from '../lib/lines'

/** ป้ายบอกฝั่งของข้อมูลที่กำลังดู/บันทึก — ฟ้า = TRANSPORT (B2B), ม่วง = EXPRESS */
export default function LineBadge({ line }: { line: BusinessLine }) {
  return (
    <span
      className={`line-badge${line === 'EXPRESS' ? ' express' : ''}`}
      title={`ข้อมูลทั้งหมดในหน้านี้เป็นของฝั่ง ${lineLabel(line)}`}
    >
      {lineLabel(line)}
    </span>
  )
}
