import { fmtScore } from '../lib/format'

/**
 * แสดงคะแนนพร้อมจำนวนครั้งที่ประเมิน
 *
 * ตัวเลขอย่างเดียวหลอกตาได้ — 5.00 จากการประเมินครั้งเดียวดูดีกว่า 4.42 จาก 37 ครั้ง
 * ทั้งที่ความจริงตรงกันข้าม จึงต้องแสดงจำนวนครั้งคู่กันเสมอ
 *
 * คะแนนต่ำกว่า 3.5 เปลี่ยนสีตัวเลขเป็นส้มเตือนสายตา — ยังไม่ได้สื่อความหมายด้วยสี
 * อย่างเดียว เพราะตัวเลขเองก็อ่านออกว่าต่ำอยู่แล้วไม่ว่าจะเห็นสีหรือไม่
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
    return <span className="score-none">ยังไม่ประเมิน</span>
  }

  const low = score < 3.5

  return (
    <span className="score-cell">
      <span className={`score-value num${low ? ' low' : ''}`}>{fmtScore(score)}</span>
      <span className="score-count">
        ประเมินแล้ว <span className="num">{n}</span> ครั้ง
      </span>
    </span>
  )
}
