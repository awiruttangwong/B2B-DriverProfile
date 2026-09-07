/**
 * verify_parity.mjs — พิสูจน์ว่า Python กับ TypeScript ให้ค่าตรงกันทุกแถว
 *
 * ทำไมต้องมี: การโหลดชุดแรกทำด้วย scripts/etl_excel.py ส่วนการอัปโหลดรายเดือน
 * ทำผ่านเบราว์เซอร์ด้วยโค้ดใน apps/web/src/lib/ ถ้าสองฝั่งคำนวณ row_hash ต่างกัน
 * แม้แถวเดียว เที่ยวเดิมจะถูกนำเข้าซ้ำเป็นแถวใหม่โดยไม่มีใครรู้ — เคยเกิดมาแล้ว
 * ตอนที่วันที่เลื่อนไปหนึ่งวันเพราะเขตเวลา และหลุดไปเพราะ "ตรวจด้วยมือ" ไม่กี่ค่า
 *
 * สคริปต์นี้ไม่ได้ถือสำเนาตรรกะไว้เอง แต่แปลง TypeScript ตัวจริงด้วย esbuild
 * แล้วเรียกฟังก์ชันเดียวกับที่หน้าเว็บเรียก การทดสอบจึงไม่มีทางเพี้ยนจากของจริง
 *
 *   node scripts/verify_parity.mjs [ไฟล์.xlsx] [--out data/out]
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const webSrc = path.join(root, 'apps/web/src/lib')

// ใช้ SheetJS และ esbuild ตัวเดียวกับที่หน้าเว็บใช้
const XLSX = require(path.join(root, 'apps/web/node_modules/xlsx'))
const esbuild = require(path.join(root, 'apps/web/node_modules/esbuild'))

/**
 * แปลง .ts ของหน้าเว็บให้ Node เรียกได้
 *
 * มัดรวมเป็นไฟล์เดียวเพื่อให้ import ระหว่างโมดูลทำงานได้ และบังคับ format esm
 * โมดูลทั้งสามตัวนี้เป็นตรรกะล้วน ไม่แตะ DOM และไม่แตะ Supabase client
 */
async function loadWebModules() {
  const dir = mkdtempSync(path.join(tmpdir(), 'parity-'))
  const entry = path.join(dir, 'entry.ts')
  writeFileSync(
    entry,
    [
      `export * from ${JSON.stringify(path.join(webSrc, 'normalize.ts'))}`,
      `export * from ${JSON.stringify(path.join(webSrc, 'sourceProfiles.ts'))}`,
      `export * from ${JSON.stringify(path.join(webSrc, 'cleaning.ts'))}`,
    ].join('\n'),
    'utf8',
  )
  const outfile = path.join(dir, 'bundle.mjs')
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  })
  const mod = await import(pathToFileURL(outfile).href)
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------------------
// อ่าน CSV ที่ Python สร้าง (มี BOM และมีค่าที่ถูกครอบด้วยเครื่องหมายคำพูด)
// ---------------------------------------------------------------------------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  const header = rows.shift()
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf('--out')
  const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(root, 'data/out')
  const excel = args.find((a) => !a.startsWith('--') && a !== outDir) ?? path.join(root, 'ALLMANUAL_cleaned.xlsx')

  const { mod, cleanup } = await loadWebModules()
  try {
    const { scanSheets, isUsableRow, cleanSheets, detUuid } = mod

    // อ่านด้วยตัวเลือกเดียวกับหน้า Upload ทุกประการ
    const wb = XLSX.read(readFileSync(excel), { cellDates: false })
    const scans = scanSheets(
      wb.SheetNames,
      (name) => {
        const ws = wb.Sheets[name]
        if (!ws) return []
        return XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: null,
          raw: true,
          blankrows: true,
        })
      },
      isUsableRow,
    )

    console.log(`ไฟล์: ${path.basename(excel)}`)
    for (const s of scans) {
      const tag = s.status === 'ok' ? 'นำเข้า' : 'ข้าม  '
      console.log(
        `  ${tag} ${s.name.padEnd(30)} ${s.profile.padEnd(10)} ` +
          `แถว ${String(s.totalRows).padStart(6)} ใช้ได้ ${String(s.usableRows).padStart(6)}` +
          (s.reason ? `  (${s.reason})` : ''),
      )
    }

    const picked = scans
      .filter((s) => s.status === 'ok')
      .map((s) => ({ name: s.name, columns: s.columns, rows: s.rows }))

    const clean = await cleanSheets(picked)
    console.log(
      `\nฝั่ง TypeScript: ${clean.rows.length.toLocaleString('th-TH')} เที่ยว · ` +
        `ยุบซ้ำ ${clean.collapsedAcrossSheets.toLocaleString('th-TH')} · ` +
        `เที่ยวซ้ำที่แยกด้วยลำดับงาน ${clean.repeatTrips.toLocaleString('th-TH')} · ` +
        `แถวที่ข้าม ${clean.invalid.length.toLocaleString('th-TH')}`,
    )

    const tsRows = new Map(clean.rows.map((r) => [r.hash, r]))

    const pyRows = parseCsv(readFileSync(path.join(outDir, 'jobs.csv'), 'utf8'))
    console.log(`ฝั่ง Python    : ${pyRows.length.toLocaleString('th-TH')} เที่ยว`)
    console.log()

    let hashMatch = 0
    const missing = []
    const fieldDiffs = []

    for (const py of pyRows) {
      const ts = tsRows.get(py.row_hash)
      if (!ts) {
        missing.push(py)
        continue
      }
      hashMatch++
      const cmp = [
        ['job_date', py.job_date, ts.date],
        ['seq_no', py.seq_no, ts.seq ?? ''],
        ['customer_code', py.customer_code, ts.customer ?? ''],
        ['plate', py.plate, ts.plate ?? ''],
        ['route_raw', py.route_raw, ts.route ?? ''],
        ['origin', py.origin, ts.origin ?? ''],
        ['destination', py.destination, ts.destination ?? ''],
      ]
      for (const [f, a, b] of cmp) {
        if ((a ?? '') !== (b ?? '')) fieldDiffs.push({ hash: py.row_hash, field: f, py: a, ts: b })
      }
    }

    // แถวที่ TS มีแต่ Python ไม่มี — ต้องเป็นศูนย์เหมือนกัน ไม่งั้นแปลว่านับเที่ยวไม่ตรง
    const extra = clean.rows.filter((r) => !pyRows.some((p) => p.row_hash === r.hash))

    // ตรวจ uuid ของงานด้วย
    let uuidMatch = 0
    const uuidBad = []
    for (const py of pyRows.slice(0, 500)) {
      const id = await detUuid('job', py.row_hash)
      if (id === py.id) uuidMatch++
      else uuidBad.push({ hash: py.row_hash, py: py.id, ts: id })
    }

    console.log('='.repeat(64))
    console.log(
      `row_hash ตรงกัน            : ${hashMatch.toLocaleString('th-TH')} / ${pyRows.length.toLocaleString('th-TH')}`,
    )
    console.log(`Python มี แต่ TS ไม่มี      : ${missing.length.toLocaleString('th-TH')}`)
    console.log(`TS มี แต่ Python ไม่มี      : ${extra.length.toLocaleString('th-TH')}`)
    console.log(`ค่าในฟิลด์ต่างกัน           : ${fieldDiffs.length.toLocaleString('th-TH')}`)
    console.log(`uuid งานตรงกัน (500 แถวแรก) : ${uuidMatch} / ${Math.min(500, pyRows.length)}`)
    console.log('='.repeat(64))

    if (missing.length) {
      console.log('\nตัวอย่างแถวที่ Python มี แต่ TS ไม่มี:')
      for (const m of missing.slice(0, 5)) {
        console.log(`  ${m.job_date} | ${m.customer_code} | ${m.plate} | ${m.route_raw}`)
        console.log(`    hash=${m.row_hash}`)
      }
    }
    if (extra.length) {
      console.log('\nตัวอย่างแถวที่ TS มี แต่ Python ไม่มี:')
      for (const e of extra.slice(0, 5)) {
        console.log(`  ${e.date} | ${e.customer} | ${e.plate} | ${e.route} | เที่ยวที่ ${e.occurrence}`)
      }
    }
    if (fieldDiffs.length) {
      console.log('\nตัวอย่างฟิลด์ที่ต่างกัน:')
      for (const d of fieldDiffs.slice(0, 8)) {
        console.log(`  ${d.field}: python=${JSON.stringify(d.py)}  ts=${JSON.stringify(d.ts)}`)
      }
    }
    if (uuidBad.length) {
      console.log('\nตัวอย่าง uuid ที่ต่างกัน:')
      for (const u of uuidBad.slice(0, 3)) console.log(`  python=${u.py}  ts=${u.ts}`)
    }

    const bad = missing.length + extra.length + fieldDiffs.length + uuidBad.length
    console.log(bad === 0 ? '\nสองฝั่งตรงกันทุกแถว' : `\nพบความไม่ตรงกัน ${bad} จุด`)
    process.exitCode = bad === 0 ? 0 : 1
  } finally {
    cleanup()
  }
}

main()
