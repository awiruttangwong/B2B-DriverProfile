/**
 * ชนิดข้อมูลของฐานข้อมูล
 *
 * ไฟล์นี้เขียนด้วยมือให้ตรงกับ supabase/migrations/*.sql
 * เมื่อเชื่อมต่อโปรเจกต์จริงแล้ว ให้สร้างใหม่อัตโนมัติด้วย
 *     npm run gen:types
 * เพื่อให้ type พังตอน build ทันทีที่ schema เปลี่ยน แทนที่จะพังตอน production
 */

export type AppRole = 'admin' | 'hr' | 'ops' | 'viewer'
export type DriverStatus = 'active' | 'probation' | 'inactive' | 'blacklisted'
export type EmploymentType = 'employee' | 'contractor' | 'vendor' | 'unknown'
export type JobOutcome = 'completed' | 'no_show' | 'cancelled' | 'incident'

export interface Profile {
  id: string
  full_name: string
  email: string | null
  role: AppRole
  department: string | null
  is_active: boolean
  created_at: string
}

export interface Customer {
  id: string
  code: string
  name: string | null
  is_active: boolean
}

export interface VehicleType {
  id: string
  code: string
  name: string | null
  axle_class: string | null
}

export interface Vehicle {
  id: string
  plate: string
  vehicle_type_id: string | null
  note: string | null
}

export interface Driver {
  id: string
  driver_code: string
  full_name: string
  phone: string
  status: DriverStatus
  employment: EmploymentType
  base_province: string | null
  photo_path: string | null
  note: string | null
  first_job_date: string | null
  last_job_date: string | null
  created_at: string
  updated_at: string
}

/** view: driver_directory — รายชื่อพร้อมสรุป ใช้ในหน้ารายการและหน้าโปรไฟล์ */
export interface DriverDirectoryRow {
  id: string
  driver_code: string
  full_name: string
  phone: string
  status: DriverStatus
  status_reason: string | null
  employment: EmploymentType
  note: string | null
  total_jobs: number | null
  customer_count: number | null
  vehicle_count: number | null
  last_job_date: string | null
  days_since_last_job: number | null
  total_cost: number | null
  recent_problem_jobs: number | null
  rating_count: number | null
  raw_score: number | null
  adjusted_score: number | null
}

/** view: driver_job_history — ประวัติงานรายเที่ยว พร้อมคะแนนที่ได้ในงานนั้น */
export interface JobHistoryRow {
  assignment_id: string
  driver_id: string
  job_id: string
  job_date: string
  /** ลำดับงานในไฟล์ต้นทาง — แยกเที่ยวที่ข้อมูลอื่นเหมือนกันหมดออกจากกัน */
  seq_no: string | null
  customer_code: string | null
  vehicle_type_code: string | null
  plate: string | null
  route_raw: string | null
  origin: string | null
  destination: string | null
  revenue: number | null
  cost: number | null
  margin: number | null
  note: string | null
  outcome: JobOutcome
  on_time: boolean | null
  rating_id: string | null
  overall_score: number | null
  rating_reason: string | null
  rating_tags: string[] | null
}

/** view: driver_customer_perf — ผลงานแยกตามลูกค้า */
export interface CustomerPerfRow {
  driver_id: string
  customer_id: string
  customer_code: string
  jobs: number
  last_job_date: string | null
  avg_score: number | null
  rating_count: number
}

/** view: drivers_pending_review — พขร. ที่ยังไม่เคยได้รับการประเมินภาพรวมเลยสักครั้ง */
export interface DriverPendingReviewRow {
  id: string
  driver_code: string
  full_name: string
  phone: string
  status: DriverStatus
  total_jobs: number
  last_job_date: string | null
  days_since_last_job: number | null
  rating_count: number
  /** ควรประเมินก่อน — วิ่งตั้งแต่ 10 เที่ยว หรือยังวิ่งอยู่ใน 90 วันล่าสุด */
  is_priority: boolean
}

/**
 * table: driver_ratings — ใบประเมิน
 * assignment_id เป็น null = ประเมินภาพรวมทั้งคน ซึ่งเป็นรูปแบบปกติของระบบตอนนี้
 */
export interface DriverReviewRow {
  id: string
  overall_score: number
  reason: string
  tags: string[] | null
  assign_again: boolean | null
  created_at: string
  assignment_id: string | null
  rater: { full_name: string } | null
}

/**
 * rpc: search_drivers — ผลการจัดอันดับ พขร. ที่ตรงกับงาน
 *
 * ไม่มีคะแนนผสมสูตรเดียว (เช่น fit_score) เพราะข้อมูลจริงยังไม่ครบพอจะคำนวณแบบนั้น
 * ได้อย่างซื่อสัตย์ — เรียงลำดับด้วยข้อมูลจริงหลายชั้นแทน ดู order by ใน
 * supabase/migrations/0009_search_drivers_real_signals.sql
 */
export interface DriverFitRow {
  driver_id: string
  driver_code: string
  full_name: string
  phone: string
  total_jobs: number
  customer_jobs: number
  vehicle_type_jobs: number
  route_jobs: number
  adjusted_score: number | null
  rating_count: number
  last_job_date: string | null
}

/** view: driver_status_log — ใครเปลี่ยนสถานะ เมื่อไร เพราะอะไร */
export interface DriverStatusLogRow {
  id: string
  driver_id: string
  from_status: DriverStatus | null
  to_status: DriverStatus
  reason: string | null
  changed_at: string
  changed_by: string | null
  changed_by_name: string | null
}

export interface RatingCriteria {
  id: string
  code: string
  label_th: string
  description: string | null
  weight: number
  display_order: number
  is_active: boolean
}

export interface DriverRating {
  id: string
  driver_id: string
  assignment_id: string | null
  rater_id: string
  overall_score: number
  reason: string
  tags: string[]
  assign_again: boolean | null
  created_at: string
  locked_at: string | null
  voided_at: string | null
}

/** view: activity_log — รวมร่องรอยการกระทำของทุก user ทั้งระบบไว้จุดเดียว จำกัด admin เท่านั้น */
export interface ActivityLogRow {
  id: string
  at: string
  actor_id: string | null
  actor_name: string | null
  actor_email: string | null
  actor_role: AppRole | null
  action: string
  action_label: string
  target_label: string | null
  target_type: 'driver' | 'batch' | 'user' | null
  target_id: string | null
  detail: Record<string, unknown> | null
}

export interface ImportBatch {
  id: string
  filename: string
  sheet_name: string | null
  uploaded_by: string | null
  row_total: number
  row_inserted: number
  row_skipped: number
  row_failed: number
  status: string
  created_at: string
  finished_at: string | null
}
