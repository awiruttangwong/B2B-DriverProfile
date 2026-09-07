/**
 * เทมเพลต Excel ให้พนักงานดาวน์โหลดไปกรอกข้อมูลงานเอง
 *
 * ใช้ชื่อคอลัมน์ชุดเดียวกับที่ sourceProfiles.ts รู้จักเป็นอันดับแรก (นามแฝงตัวแรกของ
 * แต่ละฟิลด์ใน ALIASES) เพื่อให้ระบบจับคู่หัวตารางได้แน่นอน 100% ไม่ต้องพึ่งการเดา
 * และตรงกับฟิลด์ที่หน้าอัปโหลดโชว์ผลการจับคู่ให้ดู (ดู SHOWN_FIELDS ใน Upload.tsx)
 */

interface TemplateCol {
  header: string
  width: number
  example: string | number | Date
}

const COLS: TemplateCol[] = [
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

const REQUIRED_HEADERS = ['วันที่', 'ชื่อ พขร.', 'เบอร์โทร พขร.']

export async function downloadJobTemplate(): Promise<void> {
  const XLSX = await import('xlsx')

  const headerRow = COLS.map((c) => c.header)
  const exampleRow = COLS.map((c) => c.example)

  const ws = XLSX.utils.aoa_to_sheet([headerRow, exampleRow])
  ws['!cols'] = COLS.map((c) => ({ wch: c.width }))
  // เซลล์วันที่ตัวอย่างต้องเป็น Excel date จริง (ไม่ใช่ข้อความ) ให้ตรงรูปแบบที่
  // หน้าอัปโหลดคาดหวัง (อ่านด้วย cellDates:false, raw:true แล้วแปลงจาก serial number)
  const dateCell = ws['A2']
  if (dateCell) dateCell.z = 'dd/mm/yyyy'

  const wbNote = XLSX.utils.aoa_to_sheet([
    ['วิธีใช้เทมเพลตนี้'],
    [''],
    ['1. แถวที่ 2 เป็นตัวอย่าง ให้ลบทิ้งก่อนกรอกข้อมูลจริง (เหลือไว้แค่หัวตารางแถวแรก)'],
    ['2. คอลัมน์บังคับต้องกรอกทุกแถว: ' + REQUIRED_HEADERS.join(' · ')],
    ['3. คอลัมน์ "วันที่" ให้พิมพ์เป็นวันที่ในเอ็กเซล (กด Ctrl+; ได้วันที่วันนี้) ห้ามพิมพ์เป็นข้อความ'],
    ['4. คอลัมน์ที่เหลือไม่บังคับ เว้นว่างได้ถ้าไม่มีข้อมูล'],
    ['5. ห้ามเปลี่ยนชื่อหัวตารางในแถวแรก ไม่งั้นระบบจะจับคู่คอลัมน์ไม่ได้'],
    ['6. 1 แถว = 1 เที่ยวงาน กรอกกี่แถวก็ได้ในชีตเดียวกัน'],
    ['7. กรอกเสร็จแล้วเซฟเป็น .xlsx แล้วอัปโหลดที่หน้า "อัปโหลดไฟล์" ได้เลย'],
  ])
  wbNote['!cols'] = [{ wch: 90 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'กรอกข้อมูลที่นี่')
  XLSX.utils.book_append_sheet(wb, wbNote, 'คำแนะนำ')

  XLSX.writeFile(wb, 'เทมเพลตนำเข้าข้อมูลงาน.xlsx')
}
