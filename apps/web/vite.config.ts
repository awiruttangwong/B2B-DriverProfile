import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * เสิร์ฟข้อมูลโหมดทดลองจากโฟลเดอร์นอก apps/web/ ตอนรัน dev server เท่านั้น
 *
 * ทำไมต้องแยกไว้นอก apps/web/public/ — เคยเก็บไว้ใน public/demo/ มาก่อน แล้ว
 * Vite คัดลอกทุกอย่างใน public/ ลง dist/ ของ "ทุกโหมด" แบบไม่สนใจว่าโค้ดจะ
 * import ไปใช้จริงหรือเปล่า ผลคือตอน deploy ขึ้น Cloudflare Workers ครั้งแรก
 * ไฟล์ที่มีชื่อและเบอร์โทรจริงของ พขร. 1,290 คน หลุดขึ้นไปเปิดให้ดึงได้แบบ
 * ไม่ต้องยืนยันตัวตนอยู่ช่วงหนึ่งก่อนจะจับได้และแก้ (ดู .gitignore ประกอบ)
 *
 * ย้ายข้อมูลออกมาไว้ที่ demo-data/ ที่ระดับรากของ repo แทน แล้วให้ปลั๊กอินนี้
 * เสิร์ฟผ่าน middleware ของ dev server เฉพาะตอน --mode demo เท่านั้น ทำให้
 * ไฟล์เหล่านี้ไม่มีทางถูกคัดลอกเข้า dist/ ได้เลยไม่ว่าจะลืมเช็คแค่ไหนในอนาคต
 * เพราะไม่ได้อยู่ใน public/ และไม่ได้ถูก import เข้า module graph
 */
function serveDemoData(mode: string): Plugin {
  const dataDir = fileURLToPath(new URL('../../demo-data', import.meta.url))
  return {
    name: 'serve-demo-data',
    configureServer(server) {
      if (mode !== 'demo') return
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/^\/demo\/([a-z_]+)\.json(?:\?.*)?$/)
        if (!m) return next()
        const file = `${dataDir}/${m[1]}.json`
        if (!existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(readFileSync(file))
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), serveDemoData(mode)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    // SheetJS ก้อนใหญ่ แยกออกมาเพื่อไม่ให้หน้าแรกโหลดช้า
    rollupOptions: {
      output: {
        manualChunks: {
          xlsx: ['xlsx'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
}))
