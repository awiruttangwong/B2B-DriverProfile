import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * กันหน้าขาวทั้งจอ
 *
 * เดิมถ้าโค้ดส่วนไหนพังตอน render (เช่น view คืนข้อมูลรูปแบบที่ไม่คาดคิด)
 * React จะถอดทั้งต้นไม้ทิ้ง เหลือหน้าขาวเปล่า ไม่มีข้อความ ไม่มีปุ่ม
 * ผู้ใช้จะไม่รู้ว่าเกิดอะไรขึ้นและกลับมาใช้งานเองไม่ได้เลยนอกจากรีเฟรชมั่ว ๆ
 */
interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // ยังไม่มีระบบส่ง error ออกนอกเครื่อง อย่างน้อยให้ตกใน console
    // เพื่อให้ผู้ใช้ก็อปข้อความจาก DevTools ส่งมาให้ทีมได้
    console.error('[UI พัง]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <main className="page" style={{ maxWidth: 640 }}>
        <div className="card card-pad">
          <h1 style={{ fontSize: 20, marginTop: 0 }}>หน้านี้ทำงานผิดพลาด</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            ระบบไม่ได้ทำข้อมูลหาย — เกิดข้อผิดพลาดตอนแสดงผลเท่านั้น
            ลองกลับไปหน้ารายชื่อ พขร. หรือโหลดหน้าใหม่อีกครั้ง ถ้ายังเจอซ้ำ
            ให้ส่งข้อความด้านล่างนี้ให้ผู้ดูแลระบบ
          </p>
          <pre
            className="mono"
            style={{
              fontSize: 12,
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
              padding: 12,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {error.message}
          </pre>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={() => window.location.assign('/drivers')}>
              กลับหน้ารายชื่อ พขร.
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              โหลดหน้าใหม่
            </button>
          </div>
        </div>
      </main>
    )
  }
}
