-- 0042: หน้า "รอประเมิน" ยังช้า 6.4 วิ หลัง 0041 (เกือบชน statement timeout ~8 วิ)
--
-- แผนจริงบน production: เวลาเกือบทั้งหมดหมดไปกับการอ่านเที่ยวทั้ง 72,042 แถวจากดิสก์ทุกครั้งที่เปิดหน้า
-- (jobs เป็นตารางกว้าง อ่านผ่าน index ทีละแถว) ไม่ใช่การคำนวณ — แก้ด้วยการเรียง join ไม่ได้
--
-- แก้: เก็บ "จำนวนเที่ยว" และ "วันที่วิ่งล่าสุด" ไว้บนแถว พขร. เลย (job_count, job_last_date)
-- trigger บน job_assignments / jobs อัปเดตให้เองทุกครั้งที่เพิ่ม/ลบ/แก้เที่ยว หน้ารอประเมินจึงอ่านแค่
-- ตาราง drivers (หลักพันแถว) ไม่แตะ jobs เลย
--
-- ไม่แตะ first_job_date / last_job_date เดิม (ระบบอื่นใช้อยู่) — ใช้คอลัมน์ใหม่แยกต่างหาก
-- ค่าตรงกับที่ view เดิมคำนวณเสมอ เพราะงานกับ พขร. อยู่ฝั่งเดียวกันเสมอ (0039 บังคับไว้
-- และตรวจบน production แล้ว: งานข้ามฝั่ง = 0) จำนวนที่เก็บไว้จึงเท่ากับจำนวนที่ผู้ใช้ฝั่งนั้นมองเห็น

-- 1) คอลัมน์สรุป
alter table drivers add column if not exists job_count     integer not null default 0;
alter table drivers add column if not exists job_last_date date;

-- 2) คำนวณใหม่จากของจริงสำหรับ พขร. ชุดหนึ่ง (ใช้ตอนลบ/แก้ และตอนตั้งค่าครั้งแรก)
create or replace function fn_refresh_driver_job_summary(p_driver_ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update drivers d
     set job_count     = coalesce(s.n, 0),
         job_last_date = s.last_date
    from (select x.id, agg.n, agg.last_date
            from unnest(p_driver_ids) as x(id)
            left join lateral (
              select count(a.id) as n, max(j.job_date) as last_date
                from job_assignments a
                left join jobs j on j.id = a.job_id
               where a.driver_id = x.id
            ) agg on true) s
   where d.id = s.id
     and (d.job_count is distinct from coalesce(s.n, 0)
          or d.job_last_date is distinct from s.last_date);
$$;

-- 3) เพิ่มเที่ยว: บวกทีละแถวแบบเบา ๆ (นำเข้า 72k แถวก็ไม่ต้องนับใหม่ทั้งหมด)
--    ใช้ statement trigger + transition table → อัปเดต พขร. ละครั้งเดียวต่อคำสั่ง แม้ upsert ทีละ 1,000 แถว
create or replace function fn_job_summary_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update drivers d
     set job_count     = d.job_count + s.n,
         job_last_date = greatest(d.job_last_date, s.last_date)
    from (select n.driver_id, count(*) as n, max(j.job_date) as last_date
            from new_rows n
            left join jobs j on j.id = n.job_id
           group by n.driver_id) s
   where d.id = s.driver_id;
  return null;
end $$;

-- 4) ลบ/แก้เที่ยว: นับใหม่เฉพาะ พขร. ที่เกี่ยว (วันที่ล่าสุดอาจถอยหลัง บวกลบไม่ได้)
create or replace function fn_job_summary_after_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform fn_refresh_driver_job_summary(array(select distinct driver_id from old_rows));
  return null;
end $$;

create or replace function fn_job_summary_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform fn_refresh_driver_job_summary(array(
    select driver_id from old_rows union select driver_id from new_rows));
  return null;
end $$;

-- แก้วันที่ของเที่ยว → วันที่ล่าสุดของคนขับเที่ยวนั้นเปลี่ยน
create or replace function fn_job_summary_after_job_date() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform fn_refresh_driver_job_summary(array(
    select distinct a.driver_id
      from new_rows n
      join old_rows o on o.id = n.id
      join job_assignments a on a.job_id = n.id
     where n.job_date is distinct from o.job_date));
  return null;
end $$;

revoke execute on function fn_refresh_driver_job_summary(uuid[]) from public, anon, authenticated;
revoke execute on function fn_job_summary_after_insert()   from public, anon, authenticated;
revoke execute on function fn_job_summary_after_delete()   from public, anon, authenticated;
revoke execute on function fn_job_summary_after_update()   from public, anon, authenticated;
revoke execute on function fn_job_summary_after_job_date() from public, anon, authenticated;

drop trigger if exists job_assignments_summary_ins on job_assignments;
create trigger job_assignments_summary_ins after insert on job_assignments
  referencing new table as new_rows
  for each statement execute function fn_job_summary_after_insert();

drop trigger if exists job_assignments_summary_del on job_assignments;
create trigger job_assignments_summary_del after delete on job_assignments
  referencing old table as old_rows
  for each statement execute function fn_job_summary_after_delete();

drop trigger if exists job_assignments_summary_upd on job_assignments;
create trigger job_assignments_summary_upd after update on job_assignments
  referencing old table as old_rows new table as new_rows
  for each statement execute function fn_job_summary_after_update();

drop trigger if exists jobs_summary_date on jobs;
create trigger jobs_summary_date after update on jobs
  referencing old table as old_rows new table as new_rows
  for each statement execute function fn_job_summary_after_job_date();

-- 5) ตั้งค่าครั้งแรกจากข้อมูลจริงทั้งหมด (ทุกฝั่ง — รันจาก SQL Editor จึงไม่ติด RLS)
update drivers d
   set job_count = s.n, job_last_date = s.last_date
  from (select a.driver_id, count(a.id) as n, max(j.job_date) as last_date
          from job_assignments a
          left join jobs j on j.id = a.job_id
         group by a.driver_id) s
 where d.id = s.driver_id;

-- 6) หน้ารอประเมินอ่านจาก drivers อย่างเดียว — คอลัมน์/ชนิด/ความหมายเหมือน 0031/0041 ทุกตัว
create or replace view drivers_pending_review
with (security_invoker = on) as
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  driver_effective_status(d.status, d.status_until) as status,
  d.job_count::bigint                    as total_jobs,
  d.job_last_date                        as last_job_date,
  (current_date - d.job_last_date)       as days_since_last_job,
  0::bigint                              as rating_count,
  (d.job_count >= 10
   or coalesce(current_date - d.job_last_date, 2147483647) <= 90) as is_priority
from drivers d
where not exists (select 1 from driver_ratings r
                   where r.driver_id = d.id and r.voided_at is null)
  and driver_effective_status(d.status, d.status_until) in ('active', 'probation');

grant select on drivers_pending_review to authenticated;

create index if not exists drivers_line_job_count_idx on drivers (business_line, job_count desc);
