-- =============================================================================
-- 0010_actor_tracking_and_perf.sql
--
-- แก้สามเรื่องที่ตรวจเจอจากการ audit ทั้งระบบ:
--   1. ไม่มีการบันทึกว่า "ใครเป็นคนทำ" เลยสักแถวเดียวในระบบ
--   2. การให้คะแนนเขียนสองคำสั่งแยกกัน ถ้าพังกลางทางได้ใบคะแนนที่ไม่มีคะแนนรายเกณฑ์
--   3. search_drivers() ช้าเกินจำเป็นเพราะยิง subquery ซ้อน 3 ชุดต่อ พขร. หนึ่งคน
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) บันทึกผู้ทำรายการอัตโนมัติที่ระดับฐานข้อมูล
--
-- ตรวจพบว่าคอลัมน์ created_by / uploaded_by / assigned_by เป็น null ทั้ง 100%
-- (jobs 7,556/7,556 · job_assignments 7,556/7,556 · drivers 1,290/1,290 ·
-- import_batches ทุกแถว) เพราะ ingest.ts ไม่เคยส่งค่าเหล่านี้มา และฐานข้อมูล
-- ก็ไม่มี default ให้ ผลคือ "ใครอัปโหลดไฟล์นี้" ตอบไม่ได้เลยแม้แต่แถวเดียว
--
-- แก้ที่ฐานข้อมูลไม่ใช่ที่แอป เพราะถ้าให้แอปส่งมาเอง วันหลังมีโค้ดเส้นทางใหม่
-- ที่ลืมส่ง ร่องรอยจะขาดอีกเงียบ ๆ แบบเดิม — ให้ฐานข้อมูลเติมให้เสมอแทน
-- -----------------------------------------------------------------------------
alter table import_batches  alter column uploaded_by set default auth.uid();
alter table jobs            alter column created_by  set default auth.uid();
alter table job_assignments alter column assigned_by set default auth.uid();
alter table drivers         alter column created_by  set default auth.uid();

-- กันการสวมชื่อคนอื่น: เพิ่มเป็น policy แบบ restrictive (ต้องผ่านทุกข้อ ไม่ใช่ข้อใดข้อหนึ่ง)
-- บังคับเฉพาะตอน insert เท่านั้น การแก้ไขภายหลังยังคงเดิม ไม่งั้นแอดมินจะแก้งาน
-- ที่คนอื่นสร้างไม่ได้เลย
drop policy if exists jobs_insert_actor on jobs;
create policy jobs_insert_actor on jobs as restrictive for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists job_assignments_insert_actor on job_assignments;
create policy job_assignments_insert_actor on job_assignments as restrictive for insert to authenticated
  with check (assigned_by = auth.uid());

drop policy if exists import_batches_insert_actor on import_batches;
create policy import_batches_insert_actor on import_batches as restrictive for insert to authenticated
  with check (uploaded_by = auth.uid());

drop policy if exists drivers_insert_actor on drivers;
create policy drivers_insert_actor on drivers as restrictive for insert to authenticated
  with check (created_by = auth.uid());

-- -----------------------------------------------------------------------------
-- 2) ให้คะแนนเป็นคำสั่งเดียวจบ (atomic)
--
-- เดิมแอปยิงสองคำสั่ง: insert driver_ratings แล้วค่อย insert rating_scores
-- ถ้าคำสั่งที่สองพัง (เน็ตหลุด / RLS ปฏิเสธ) จะเหลือใบคะแนนที่ไม่มีคะแนนรายเกณฑ์
-- ค้างอยู่ถาวร ลบเองไม่ได้ด้วยเพราะระบบไม่เปิดให้ลบคะแนน และคะแนนรวมจะค้างเป็น
-- ค่าที่ "ฝั่งเบราว์เซอร์" คำนวณส่งมา ไม่ใช่ค่าที่ทริกเกอร์คำนวณจากคะแนนจริง
--
-- ฟังก์ชันเดียวจึงเป็นทรานแซกชันเดียว พังตรงไหนก็ย้อนกลับหมด และคะแนนรวม
-- คำนวณจากฝั่งฐานข้อมูลล้วน เบราว์เซอร์ส่งตัวเลขรวมมาหลอกไม่ได้อีกต่อไป
--
-- security invoker: สิทธิ์ยังบังคับด้วย policy ratings_insert เหมือนเดิมทุกประการ
-- -----------------------------------------------------------------------------
create or replace function submit_rating(
  p_driver_id     uuid,
  p_assignment_id uuid,
  p_reason        text,
  p_tags          text[],
  p_assign_again  boolean,
  p_scores        jsonb   -- [{"code":"safety","score":4}, ...]
) returns uuid
language plpgsql security invoker
as $$
declare
  v_rating_id uuid;
  v_overall   numeric;
  v_given     int;
  v_required  int;
begin
  -- ต้องให้คะแนนครบทุกเกณฑ์ที่เปิดใช้อยู่ ไม่ใช่แค่หน้าจอบังคับ
  select count(*) into v_required from rating_criteria where is_active;

  select count(*), sum(s.score * c.weight) / nullif(sum(c.weight), 0)
    into v_given, v_overall
  from jsonb_to_recordset(p_scores) as s(code text, score int)
  join rating_criteria c on c.code = s.code and c.is_active;

  if v_given is null or v_given < v_required then
    raise exception 'ต้องให้คะแนนครบทุกเกณฑ์ (ได้รับ % จาก %)', coalesce(v_given, 0), v_required
      using errcode = 'check_violation';
  end if;

  insert into driver_ratings (
    driver_id, assignment_id, rater_id, overall_score, reason, tags, assign_again
  ) values (
    p_driver_id, p_assignment_id, auth.uid(), round(v_overall, 2),
    p_reason, coalesce(p_tags, '{}'), p_assign_again
  )
  returning id into v_rating_id;

  insert into rating_scores (rating_id, criteria_id, score)
  select v_rating_id, c.id, s.score
  from jsonb_to_recordset(p_scores) as s(code text, score int)
  join rating_criteria c on c.code = s.code and c.is_active;

  return v_rating_id;
end $$;

grant execute on function submit_rating to authenticated;

-- -----------------------------------------------------------------------------
-- 3) search_drivers() เร็วขึ้น ~4 เท่า
--
-- วัดจริงบนข้อมูล production (พขร. 1,290 คน · เที่ยว 7,556):
--   ของเดิม (correlated subquery 3 ชุดต่อคน) — 219 ms เมื่อระบุครบ 3 เงื่อนไข
--   ของใหม่ (สแกน job_assignments รอบเดียวแล้ว group)  —  53 ms
-- ยิ่ง พขร. เยอะ ส่วนต่างยิ่งถ่างขึ้น เพราะของเดิมโตแบบ (จำนวนคน × จำนวนเที่ยว)
--
-- ลำดับการเรียงยังเป็นข้อมูลจริงล้วนเหมือน 0009 ไม่มีคะแนนผสมสูตรกลับมา
-- -----------------------------------------------------------------------------
drop function if exists search_drivers(text, text, text, int);

create function search_drivers(
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
  last_job_date      date
)
language sql stable security invoker
as $$
with rel as (
  -- นับประสบการณ์ที่ตรงกับงานนี้ทั้งสามแบบในการสแกนรอบเดียว
  -- ข้ามทั้งบล็อกถ้าไม่ได้ระบุเงื่อนไขใดเลย จะได้ไม่จ่ายค่าสแกนฟรี ๆ
  select
    a.driver_id,
    count(*) filter (
      where p_customer_code is not null and upper(c.code) = upper(p_customer_code)
    ) as customer_jobs,
    count(*) filter (
      where p_vehicle_type_code is not null and upper(v.code) = upper(p_vehicle_type_code)
    ) as vehicle_type_jobs,
    count(*) filter (
      where p_route_keyword is not null and j.route_raw ilike '%' || p_route_keyword || '%'
    ) as route_jobs
  from job_assignments a
  join jobs j                on j.id = a.job_id
  left join customers c      on c.id = j.customer_id
  left join vehicle_types v  on v.id = j.vehicle_type_id
  where p_customer_code is not null
     or p_vehicle_type_code is not null
     or p_route_keyword is not null
  group by a.driver_id
)
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  coalesce(s.total_jobs, 0)          as total_jobs,
  coalesce(r.customer_jobs, 0)       as customer_jobs,
  coalesce(r.vehicle_type_jobs, 0)   as vehicle_type_jobs,
  coalesce(r.route_jobs, 0)          as route_jobs,
  sc.adjusted_score,
  coalesce(sc.rating_count, 0)       as rating_count,
  s.last_job_date
from drivers d
left join driver_stats s      on s.driver_id = d.id
left join driver_scorecard sc on sc.driver_id = d.id
left join rel r               on r.driver_id = d.id
where d.status in ('active', 'probation')   -- ชั้นที่ 1: กรองแข็ง — ตรงกับ StatusDialog.tsx
order by
  coalesce(s.recent_problem_jobs, 0) asc,
  (coalesce(sc.rating_count, 0) > 0) desc,
  sc.adjusted_score desc nulls last,
  coalesce(r.customer_jobs, 0) desc,
  coalesce(r.vehicle_type_jobs, 0) desc,
  coalesce(r.route_jobs, 0) desc,
  coalesce(s.total_jobs, 0) desc,
  s.last_job_date desc nulls last
limit greatest(p_limit, 1);
$$;

grant execute on function search_drivers to authenticated;
