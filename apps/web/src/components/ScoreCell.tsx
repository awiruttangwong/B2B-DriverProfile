import { fmtScore } from '../lib/format'

/**
 * แสดงคะแนนพร้อมจำนวนรีวิว
 *
 * ตัวเลขอย่างเดียวหลอกตาได้ — 5.00 จากรีวิวเดียวดูดีกว่า 4.42 จาก 37 รีวิว
 * ทั้งที่ความจริงตรงกันข้าม จึงต้องแสดงจำนวนรีวิวคู่กันเสมอ
 *
 * แถบ 5 ขีดช่วยให้กวาดสายตาเทียบกันได้ทั้งคอลัมน์โดยไม่ต้องอ่านตัวเลขทีละตัว
 * และไม่ได้สื่อความหมายด้วยสีอย่างเดียว (มีทั้งตัวเลขและจำนวนขีด)
 */
export default function ScoreCell({
  score,
  count,
}: {
  score: number | null | undefined
  count: number | null | undefined
}) {
  const n = count ?? 0

  if (n === 0 || score === null || score === undefined) {
    return <span className="score-none">ยังไม่มีคะแนน</span>
  }

  const filled = Math.round(score)
  const low = score < 3.5

  return (
    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <span className="pips" role="img" aria-label={`${fmtScore(score)} จาก 5 คะแนน`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i <= filled ? (low ? 'on low' : 'on') : ''} />
        ))}
      </span>
      <span className="num" style={{ fontWeight: 600 }}>
        {fmtScore(score)}
      </span>
      <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
        {n} รีวิว
      </span>
      {n < 3 && (
        <span className="badge warn" title="รีวิวยังน้อย คะแนนยังไม่นิ่ง">
          ข้อมูลน้อย
        </span>
      )}
    </span>
  )
}
