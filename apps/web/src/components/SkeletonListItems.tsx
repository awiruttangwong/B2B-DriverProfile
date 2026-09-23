/**
 * โครงร่างระหว่างโหลดรายการแบบการ์ด/ลิสต์ (คู่กับ SkeletonRows.tsx ที่ใช้กับตาราง) —
 * ใช้กับรายการที่ไม่ใช่ <table> เช่น "ประวัติการติดต่อ" ใน DriverProfile.tsx
 * (ul.contact-list > li.contact-item) จำลองรูปร่างจริงของหนึ่งแถว: วันที่ + ป้ายผล
 * การติดต่อ + ชื่อผู้โทร บางรายการสลับให้มีแท่งหมายเหตุต่อท้ายด้วย (ของจริงก็ไม่ใช่
 * ทุกแถวมีหมายเหตุ) เพื่อไม่ให้ดูซ้ำเป๊ะทุกแถวจนรู้สึกเป็นแผ่นเทาทึบแผ่นเดียว
 */

interface Props {
  rows?: number
}

export default function SkeletonListItems({ rows = 4 }: Props) {
  return (
    <ul className="contact-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="contact-item">
          <div className="contact-item-main">
            <div className="sk" style={{ width: '11ch', height: 11 }} />
            <div className="sk" style={{ width: 62, height: 18, borderRadius: 'var(--r-pill)' }} />
            <div className="sk" style={{ width: '16ch', height: 11 }} />
          </div>
          {i % 2 === 0 && <div className="sk" style={{ width: '65%', height: 11, marginTop: 7 }} />}
        </li>
      ))}
    </ul>
  )
}
