/**
 * เทมเพลต Excel ให้พนักงานดาวน์โหลดไปกรอกข้อมูลงานเอง
 *
 * ใช้ชื่อคอลัมน์ชุดเดียวกับที่ sourceProfiles.ts รู้จักเป็นอันดับแรก (นามแฝงตัวแรกของ
 * แต่ละฟิลด์ใน ALIASES) เพื่อให้ระบบจับคู่หัวตารางได้แน่นอน 100% ไม่ต้องพึ่งการเดา
 * และตรงกับฟิลด์ที่หน้าอัปโหลดโชว์ผลการจับคู่ให้ดู (ดู SHOWN_FIELDS ใน Upload.tsx)
 *
 * แยกตามฝั่งของบัญชี — EXPRESS ใช้หัวคอลัมน์ชุดเดียวกับไฟล์ที่ทีม EXPRESS ใช้จริง
 * (EXPRESS_2026_CLEAN.xlsx) ไม่มีราคา มีรหัสเส้นทาง และคอลัมน์ "ประเภท" = EXPRESS ซึ่งระบบใช้
 * ตรวจว่าไม่ได้อัปโหลดผิดฝั่ง
 */
import type { BusinessLine } from '../types/database'

interface TemplateCol {
  header: string
  width: number
  example: string | number | Date
}

const B2B_COLS: TemplateCol[] = [
  // ระบุฝั่งไว้ในไฟล์ — บัญชี EXPRESS อัปโหลดเทมเพลตนี้จะถูกปฏิเสธทุกแถว (และกลับกัน)
  { header: 'ประเภท', width: 10, example: 'B2B' },
  { header: 'วันที่', width: 12, example: new Date() },
  { header: 'ลำดับงาน', width: 12, example: 'JB-0001' },
  { header: 'ลูกค้า', width: 20, example: 'บริษัท ตัวอย่าง จำกัด' },
  { header: 'ประเภทรถ', width: 12, example: '4W' },
  { header: 'ทะเบียน', width: 12, example: '1กก-1234 กทม' },
  { header: 'ชื่อ พขร.', width: 20, example: 'สมชาย ใจดี' },
  { header: 'เบอร์โทร พขร.', width: 14, example: '0812345678' },
  { header: 'เส้นทาง (Route)', width: 28, example: 'กรุงเทพฯ → ระยอง' },
  { header: 'ราคารับ', width: 12, example: 5000 },
  { header: 'ราคาจ่าย', width: 12, example: 4200 },
  { header: 'หมายเหตุ', width: 20, example: '' },
]

const EXPRESS_COLS: TemplateCol[] = [
  { header: 'ประเภท', width: 10, example: 'EXPRESS' },
  { header: 'วันที่', width: 12, example: new Date() },
  { header: 'ลูกค้า', width: 14, example: 'FLASH NE' },
  { header: 'ประเภทรถ', width: 10, example: '6W7.2' },
  { header: 'ชื่อเส้นทาง', width: 16, example: 'AYA-PLK' },
  { header: 'เส้นทาง (Route)', width: 28, example: 'ลาดหลุมแก้ว-พิษณุโลก' },
  { header: 'ชื่อพขร', width: 20, example: 'สมชาย ใจดี' },
  { header: 'ทะเบียน', width: 12, example: '70-1234' },
  { header: 'เบอร์โทร', width: 14, example: '0812345678' },
]

const TEMPLATES: Record<BusinessLine, { cols: TemplateCol[]; required: string[]; file: string }> = {
  B2B: {
    cols: B2B_COLS,
    required: ['วันที่', 'ชื่อ พขร.', 'เบอร์โทร พขร.'],
    file: 'เทมเพลตนำเข้าข้อมูลงาน.xlsx',
  },
  EXPRESS: {
    cols: EXPRESS_COLS,
    required: ['วันที่', 'ชื่อพขร', 'เบอร์โทร'],
    file: 'เทมเพลตนำเข้าข้อมูลงาน EXPRESS.xlsx',
  },
}

export async function downloadJobTemplate(line: BusinessLine): Promise<void> {
  const XLSX = await import('xlsx')
  const { cols: COLS, required: REQUIRED_HEADERS, file } = TEMPLATES[line]

  const headerRow = COLS.map((c) => c.header)
  const exampleRow = COLS.map((c) => c.example)

  const ws = XLSX.utils.aoa_to_sheet([headerRow, exampleRow])
  ws['!cols'] = COLS.map((c) => ({ wch: c.width }))
  // เซลล์วันที่ตัวอย่างต้องเป็น Excel date จริง (ไม่ใช่ข้อความ) ให้ตรงรูปแบบที่
  // หน้าอัปโหลดคาดหวัง (อ่านด้วย cellDates:false, raw:true แล้วแปลงจาก serial number)
  const dateCol = XLSX.utils.encode_col(COLS.findIndex((c) => c.header === 'วันที่'))
  const dateCell = ws[`${dateCol}2`]
  if (dateCell) dateCell.z = 'dd/mm/yyyy'

  const wbNote = XLSX.utils.aoa_to_sheet([
    ['วิธีใช้เทมเพลตนี้'],
    [''],
    ['1. แถวที่ 2 เป็นตัวอย่าง ให้ลบทิ้งก่อนกรอกข้อมูลจริง (เหลือไว้แค่หัวตารางแถวแรก)'],
    ['2. คอลัมน์บังคับต้องกรอกทุกแถว: ' + REQUIRED_HEADERS.join(' · ')],
    ['3. คอลัมน์ "วันที่" ให้พิมพ์เป็นวันที่ในเอ็กเซล (กด Ctrl+; ได้วันที่วันนี้) ห้ามพิมพ์เป็นข้อความ'],
    ['4. คอลัมน์ที่เหลือไม่บังคับ เว้นว่างได้ถ้าไม่มีข้อมูล'],
    [`   คอลัมน์ "ประเภท" ให้ใส่ ${line} ทุกแถว (ถ้าใส่ฝั่งอื่น ระบบจะไม่รับแถวนั้น)`],
    ['5. ห้ามเปลี่ยนชื่อหัวตารางในแถวแรก ไม่งั้นระบบจะจับคู่คอลัมน์ไม่ได้'],
    ['6. 1 แถว = 1 เที่ยวงาน กรอกกี่แถวก็ได้ในชีตเดียวกัน'],
    ['7. กรอกเสร็จแล้วเซฟเป็น .xlsx แล้วอัปโหลดที่หน้า "อัปโหลดไฟล์" ได้เลย'],
  ])
  wbNote['!cols'] = [{ wch: 90 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'กรอกข้อมูลที่นี่')
  XLSX.utils.book_append_sheet(wb, wbNote, 'คำแนะนำ')

  XLSX.writeFile(wb, file)
}
