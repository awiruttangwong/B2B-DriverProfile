/**
 * เธรดแยกสำหรับแกะไฟล์ Excel
 *
 * ทำไมต้องมี: วัดกับไฟล์จริง (IMPORT SUM ALL DATA DAILY B2B EXPRESS.xlsx ขนาด 9.4 MB
 * 16,574 แถว) แล้วพบว่า XLSX.read() บนเธรดหลักบล็อกหน้าจอยาว 5,978 มิลลิวินาที
 * เป็นเฟรมเดียวรวด — ระหว่างนั้นสปินเนอร์ไม่หมุน กดปุ่มไม่ติด หน้าเหมือนค้าง/แครช
 * ผู้ใช้ที่ไม่รู้จะกดซ้ำหรือรีเฟรชทิ้งกลางคัน
 *
 * ย้ายมาแกะในเธรดนี้แทน เธรดหลักจึงว่างพอจะวาดสถานะ "กำลังอ่านไฟล์" และตอบสนอง
 * การคลิกได้ตามปกติ ตัวเลือกในการแกะ (cellDates/raw/defval/blankrows) ต้องเหมือน
 * ของเดิมทุกตัว ไม่งั้นวันที่จะเลื่อนเขตเวลาและคอลัมน์ว่างจะหาย
 */
import * as XLSX from 'xlsx'

export interface SheetAoa {
  name: string
  rows: unknown[][]
}

export type WorkerResult = { ok: true; sheets: SheetAoa[] } | { ok: false; error: string }

self.onmessage = (e: MessageEvent<{ buf: ArrayBuffer }>) => {
  const post = (msg: WorkerResult) => (self as unknown as Worker).postMessage(msg)
  try {
    const wb = XLSX.read(e.data.buf, { cellDates: false })
    const sheets: SheetAoa[] = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name]
      if (!ws) return { name, rows: [] }
      return {
        name,
        rows: XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: null,
          raw: true,
          blankrows: true,
        }),
      }
    })
    post({ ok: true, sheets })
  } catch (err) {
    post({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
