-- =============================================================================
-- 0003_views_and_search.sql
-- สถิติ คะแนนปรับแล้ว และการจัดอันดับความเหมาะสมกับงาน
--
-- หมายเหตุเรื่องประสิทธิภาพ: ที่ขนาดข้อมูลปัจจุบัน (7.5 พันเที่ยว / 1.2 พัน พขร.)
-- ใช้ view ธรรมดาเร็วพอและได้ข้อมูลสดเสมอ เมื่อข้อมูลโตเกิน ~1 ล้านแถว
-- ค่อยเปลี่ยน driver_scorecard เป็น materialized view แล้ว refresh ด้วย cron
-- =============================================================================

-- -----------------------------------------------------------------------------
-- สถิติงานของ พขร. แต่ละคน
-- -----------------------------------------------------------------------------
create view driver_stats
with (security_invoker = on) as
select
  d.id                                                   as driver_id,
  count(a.id)                                            as total_jobs,
  count(a.id) filter (where a.outcome = 'completed')      as completed_jobs,
  count(a.id) filter (where a.outcome = 'no_show')        as no_show_jobs,
  count(a.id) filter (where a.outcome = 'incident')       as incident_jobs,
  count(a.id) filter (
    where a.outcome in ('no_show','incident')
      and j.job_date > current_date - interval '12 months'
  )                                                      as recent_problem_jobs,
  count(distinct j.customer_id)                          as customer_count,
  count(distinct j.vehicle_id)                           as vehicle_count,
  min(j.job_date)                                        as first_job_date,
  max(j.job_date)                                        as last_job_date,
  (current_date - max(j.job_date))                       as days_since_last_job,
  sum(j.cost)                                            as total_cost,
  sum(j.revenue)                                         as total_revenue,
  sum(j.margin)                                          as total_margin,
  avg(j.margin_pct)                                      as avg_margin_pct,
  -- อัตราตรงเวลา: null ถ้ายังไม่เคยบันทึก (ข้อมูลนำเข้าไม่มีฟิลด์นี้)
  avg(case when a.on_time then 1.0 when a.on_time is false then 0.0 end)
                                                         as on_time_rate
from drivers d
left join job_assignments a on a.driver_id = d.id
left join jobs j            on j.id = a.job_id
group by d.id;

-- -----------------------------------------------------------------------------
-- คะแนนที่ใช้จริง — Bayesian shrinkage + ถ่วงน้ำหนักตามความสด
--   w(r)     = 0.5 ^ (อายุรีวิวเป็นเดือน / 6)      ครึ่งชีวิต 6 เดือน
--   adjusted = (m*C + Σ s·w) / (C + Σ w)          C = 5
-- ทำให้คนที่ได้ 5.00 จากงานเดียว ไม่ชนะคนที่ได้ 4.6 จาก 40 งาน
-- -----------------------------------------------------------------------------
create view driver_scorecard
with (security_invoker = on) as
with global_mean as (
  select coalesce(avg(overall_score), 3.5) as m
  from driver_ratings
  where voided_at is null
),
weighted as (
  select
    r.driver_id,
    r.overall_score as s,
    -- cast ให้ชัดเจน: extract(epoch ...) คืน double precision ใน Postgres รุ่นเก่า
    -- ถ้าปล่อยไว้ ผลรวมจะกลายเป็น double precision แล้ว round(..., 2) จะพัง
    power(0.5::numeric,
          (extract(epoch from (now() - r.created_at))::numeric / (86400 * 182.5)::numeric)) as w
  from driver_ratings r
  where r.voided_at is null
)
select
  d.id                                                as driver_id,
  count(w.s)                                          as rating_count,
  round(avg(w.s)::numeric, 2)                         as raw_score,
  case
    when count(w.s) = 0 then null
    else round(
      (((select m from global_mean) * 5) + sum(w.s * w.w)) / (5 + sum(w.w)),
      2)
  end                                                 as adjusted_score,
  max(w.s)                                            as best_score,
  min(w.s)                                            as worst_score
from drivers d
left join weighted w on w.driver_id = d.id
group by d.id;

-- -----------------------------------------------------------------------------
-- ผลงานแยกตามลูกค้า — ตอบว่า "เก่งงานสายไหน"
-- -----------------------------------------------------------------------------
create view driver_customer_perf
with (security_invoker = on) as
select
  a.driver_id,
  j.customer_id,
  c.code                                        as customer_code,
  count(*)                                      as jobs,
  max(j.job_date)                               as last_job_date,
  round(avg(r.overall_score)::numeric, 2)       as avg_score,
  count(r.id)                                   as rating_count
from job_assignments a
join jobs j       on j.id = a.job_id
join customers c  on c.id = j.customer_id
left join driver_ratings r
       on r.assignment_id = a.id and r.voided_at is null
group by a.driver_id, j.customer_id, c.code;

-- -----------------------------------------------------------------------------
-- ผลงานแยกตามประเภทรถ
-- -----------------------------------------------------------------------------
create view driver_vehicle_perf
with (security_invoker = on) as
select
  a.driver_id,
  j.vehicle_type_id,
  vt.code                                       as vehicle_type_code,
  count(*)                                      as jobs,
  max(j.job_date)                               as last_job_date,
  round(avg(r.overall_score)::numeric, 2)       as avg_score
from job_assignments a
join jobs j            on j.id = a.job_id
join vehicle_types vt  on vt.id = j.vehicle_type_id
left join driver_ratings r
       on r.assignment_id = a.id and r.voided_at is null
group by a.driver_id, j.vehicle_type_id, vt.code;

-- -----------------------------------------------------------------------------
-- รายชื่อ พขร. พร้อมสรุป — view หลักที่หน้าเว็บใช้
-- -----------------------------------------------------------------------------
create view driver_directory
with (security_invoker = on) as
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  d.status,
  d.employment,
  d.note,
  s.total_jobs,
  s.customer_count,
  s.vehicle_count,
  s.last_job_date,
  s.days_since_last_job,
  s.total_cost,
  s.recent_problem_jobs,
  sc.rating_count,
  sc.raw_score,
  sc.adjusted_score
from drivers d
left join driver_stats s      on s.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id;

-- -----------------------------------------------------------------------------
-- ประวัติงานรายเที่ยว พร้อมคะแนนที่ได้ในงานนั้น
-- -----------------------------------------------------------------------------
create view driver_job_history
with (security_invoker = on) as
select
  a.id            as assignment_id,
  a.driver_id,
  j.id            as job_id,
  j.job_date,
  c.code          as customer_code,
  vt.code         as vehicle_type_code,
  v.plate,
  j.route_raw,
  j.origin,
  j.destination,
  j.revenue,
  j.cost,
  j.margin,
  j.note,
  a.outcome,
  a.on_time,
  r.id            as rating_id,
  r.overall_score,
  r.reason        as rating_reason,
  r.tags          as rating_tags
from job_assignments a
join jobs j                on j.id = a.job_id
left join customers c      on c.id = j.customer_id
left join vehicle_types vt on vt.id = j.vehicle_type_id
left join vehicles v       on v.id = j.vehicle_id
left join driver_ratings r on r.assignment_id = a.id and r.voided_at is null;

-- -----------------------------------------------------------------------------
-- งานที่จบแล้วแต่ยังไม่มีใครให้คะแนน — ใช้ทำรายการ "รอให้คะแนน"
-- -----------------------------------------------------------------------------
create view pending_ratings
with (security_invoker = on) as
select
  a.id          as assignment_id,
  a.driver_id,
  d.full_name   as driver_name,
  d.phone       as driver_phone,
  j.id          as job_id,
  j.job_date,
  c.code        as customer_code,
  j.route_raw,
  a.assigned_by
from job_assignments a
join jobs j           on j.id = a.job_id
join drivers d        on d.id = a.driver_id
left join customers c on c.id = j.customer_id
where a.outcome = 'completed'
  and not exists (
    select 1 from driver_ratings r
    where r.assignment_id = a.id and r.voided_at is null
  );

-- =============================================================================
-- จัดอันดับความเหมาะสมกับงาน
--
-- ชั้นที่ 1 กรองแข็ง : สถานะต้อง active และไม่อยู่ในบัญชีห้ามใช้
-- ชั้นที่ 2 ให้คะแนน 0-100 จากผลงานที่ "เกี่ยวข้องกับงานนี้โดยเฉพาะ"
--
-- ระหว่างที่ยังไม่มีคะแนนสะสม ส่วนของคะแนนจะถูกแทนด้วยค่ากลาง
-- ทำให้การจัดอันดับยังใช้ได้จริงตั้งแต่วันแรกโดยอาศัยประสบการณ์ตรงสาย
-- =============================================================================
create or replace function search_drivers(
  p_customer_code     text default null,
  p_vehicle_type_code text default null,
  p_route_keyword     text default null,
  p_limit             int  default 25
)
returns table (
  driver_id          uuid,
  driver_code        text,
  full_name          text,
  phone              text,
  total_jobs         bigint,
  customer_jobs      bigint,
  vehicle_type_jobs  bigint,
  route_jobs         bigint,
  adjusted_score     numeric,
  rating_count       bigint,
  last_job_date      date,
  fit_score          numeric
)
language sql stable security invoker
as $$
with base as (
  select
    d.id,
    d.driver_code,
    d.full_name,
    d.phone,
    coalesce(s.total_jobs, 0)          as total_jobs,
    s.last_job_date,
    s.days_since_last_job,
    coalesce(s.recent_problem_jobs, 0) as problems,
    s.on_time_rate,
    sc.adjusted_score,
    coalesce(sc.rating_count, 0)       as rating_count,
    -- ประสบการณ์ตรงลูกค้ารายนี้
    coalesce((
      select count(*) from job_assignments a2
      join jobs j2 on j2.id = a2.job_id
      join customers c2 on c2.id = j2.customer_id
      where a2.driver_id = d.id
        and (p_customer_code is null or upper(c2.code) = upper(p_customer_code))
        and p_customer_code is not null
    ), 0) as customer_jobs,
    -- ประสบการณ์ตรงประเภทรถ
    coalesce((
      select count(*) from job_assignments a3
      join jobs j3 on j3.id = a3.job_id
      join vehicle_types v3 on v3.id = j3.vehicle_type_id
      where a3.driver_id = d.id
        and (p_vehicle_type_code is null or upper(v3.code) = upper(p_vehicle_type_code))
        and p_vehicle_type_code is not null
    ), 0) as vehicle_type_jobs,
    -- ประสบการณ์ตรงเส้นทาง
    coalesce((
      select count(*) from job_assignments a4
      join jobs j4 on j4.id = a4.job_id
      where a4.driver_id = d.id
        and p_route_keyword is not null
        and j4.route_raw ilike '%' || p_route_keyword || '%'
    ), 0) as route_jobs
  from drivers d
  left join driver_stats s      on s.driver_id = d.id
  left join driver_scorecard sc on sc.driver_id = d.id
  where d.status = 'active'          -- ชั้นที่ 1: กรองแข็ง
)
select
  b.id,
  b.driver_code,
  b.full_name,
  b.phone,
  b.total_jobs,
  b.customer_jobs,
  b.vehicle_type_jobs,
  b.route_jobs,
  b.adjusted_score,
  b.rating_count,
  b.last_job_date,
  -- หมายเหตุเรื่องชนิดข้อมูล: ต้อง cast เป็น numeric ให้ชัดเจน
  -- เพราะ ln() ที่รับ bigint จะถูกแปลงเป็น ln(double precision) ตามกฎการเลือก
  -- ฟังก์ชันของ Postgres ทำให้ทั้งนิพจน์กลายเป็น double precision
  -- แล้ว round(double precision, int) ไม่มีอยู่จริง จะพังตอนเรียกใช้
  round((
      -- 40 คะแนน: คุณภาพงาน (ใช้ค่ากลาง 3.5 เมื่อยังไม่มีรีวิว)
      40 * (coalesce(b.adjusted_score, 3.5) / 5.0)
      -- 20 คะแนน: อัตราตรงเวลา (ใช้ 0.8 เป็นค่าเริ่มต้นเมื่อยังไม่มีข้อมูล)
    + 20 * coalesce(b.on_time_rate, 0.8)
      -- 15 คะแนน: ประสบการณ์กับลูกค้ารายนี้ เพดาน 20 เที่ยว
    + 15 * least(ln((b.customer_jobs + 1)::numeric) / ln(21::numeric), 1.0)
      -- 10 คะแนน: ประสบการณ์ประเภทรถนี้
    + 10 * least(ln((b.vehicle_type_jobs + 1)::numeric) / ln(21::numeric), 1.0)
      -- 10 คะแนน: ประสบการณ์เส้นทางนี้
    + 10 * least(ln((b.route_jobs + 1)::numeric) / ln(11::numeric), 1.0)
      --  5 คะแนน: ความสดของข้อมูล วิ่งภายใน 30 วัน = เต็ม
    +  5 * case
             when b.days_since_last_job is null then 0.0
             when b.days_since_last_job <= 30   then 1.0
             when b.days_since_last_job <= 90   then 0.6
             when b.days_since_last_job <= 180  then 0.3
             else 0.0
           end
      -- หัก 10 ต่อปัญหาใน 12 เดือน หักได้มากสุด 30
    - least(b.problems * 10, 30)::numeric
  )::numeric, 1) as fit_score
from base b
order by fit_score desc, b.total_jobs desc
limit greatest(p_limit, 1);
$$;

grant execute on function search_drivers to authenticated;

-- -----------------------------------------------------------------------------
-- สิทธิ์อ่าน view
-- view เหล่านี้ตั้ง security_invoker = on ไว้แล้ว การอ่านจึงยังผ่าน RLS
-- ของตารางต้นทางตามปกติ grant ตรงนี้แค่เปิดประตูให้ role authenticated เท่านั้น
-- -----------------------------------------------------------------------------
grant select on
  driver_stats,
  driver_scorecard,
  driver_customer_perf,
  driver_vehicle_perf,
  driver_directory,
  driver_job_history,
  pending_ratings
to authenticated;
