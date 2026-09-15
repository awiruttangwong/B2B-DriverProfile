import { fmtScore } from '../lib/format'

/**
 * แสดงคะแนนพร้อมจำนวนครั้งที่ประเมิน
 *
 * ตัวเลขอย่างเดียวหลอกตาได้ — 5.00 จากการประเมินครั้งเดียวดูดีกว่า 4.42 จาก 37 ครั้ง
 * ทั้งที่ความจริงตรงกันข้าม จึงต้องแสดงจำนวนครั้งคู่กันเสมอ
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
    <span className="score-cell">
      <span className="pips" role="img" aria-label={`${fmtScore(score)} จาก 5 คะแนน`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i <= filled ? (low ? 'on low' : 'on') : ''} />
        ))}
      </span>
      <span className="score-value num">{fmtScore(score)}</span>
      <span className="score-count">{n} ครั้ง</span>
    </span>
  )
}
