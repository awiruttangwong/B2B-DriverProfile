-- =============================================================================
-- 0004_driver_status.sql
-- ให้ผู้ใช้เปลี่ยนสถานะ พขร. ได้ พร้อมเก็บร่องรอยการเปลี่ยนทุกครั้ง
--
-- ทำไมต้องมีร่องรอย: สถานะเป็น "ตัวกรองแข็ง" ในฟังก์ชัน search_drivers()
-- คนที่ถูกตั้งเป็น inactive หรือ blacklisted จะหายจากหน้าหาคนสำหรับงานทันที
-- ซึ่งกระทบรายได้ของคนคนนั้นโดยตรง จึงต้องตอบได้เสมอว่าใครสั่ง เมื่อไร เพราะอะไร
-- =============================================================================

-- เหตุผลของสถานะปัจจุบัน
alter table drivers add column if not exists status_reason text;

-- สถานะที่กระทบการรับงานต้องมีเหตุผลกำกับ บังคับที่ฐานข้อมูล ไม่ใช่แค่หน้าจอ
alter table drivers drop constraint if exists drivers_status_reason_required;
alter table drivers add constraint drivers_status_reason_required check (
  status in ('active', 'probation')
  or char_length(btrim(coalesce(status_reason, ''))) >= 10
);

-- -----------------------------------------------------------------------------
-- ประวัติการเปลี่ยนสถานะ
-- -----------------------------------------------------------------------------
create table if not exists driver_status_history (
  id           uuid primary key default gen_random_uuid(),
  driver_id    uuid not null references drivers(id) on delete cascade,
  from_status  driver_status,
  to_status    driver_status not null,
  reason       text,
  changed_by   uuid references profiles(id),
  changed_at   timestamptz not null default now()
);

create index if not exists driver_status_history_driver_idx
  on driver_status_history (driver_id, changed_at desc);

comment on table driver_status_history is
  'เขียนโดยทริกเกอร์เท่านั้น ไม่ให้แอปเขียนเอง เพื่อกันการเปลี่ยนสถานะแบบไม่ทิ้งร่องรอย';

-- -----------------------------------------------------------------------------
-- ทริกเกอร์: บันทึกประวัติทุกครั้งที่สถานะเปลี่ยน
--
-- เขียนที่ระดับฐานข้อมูล ไม่ใช่ให้แอปยิงสองคำสั่ง เพราะถ้าแอปลืม (หรือมีใคร
-- ไปแก้ผ่าน SQL Editor ตรง ๆ) ร่องรอยจะขาดหายโดยไม่มีใครรู้
-- -----------------------------------------------------------------------------
create or replace function fn_log_driver_status_change() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into driver_status_history (driver_id, from_status, to_status, reason, changed_by)
    values (new.id, old.status, new.status, nullif(btrim(coalesce(new.status_reason, '')), ''), auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists drivers_log_status on drivers;
create trigger drivers_log_status
  after update of status on drivers
  for each row execute function fn_log_driver_status_change();

-- -----------------------------------------------------------------------------
-- สิทธิ์
-- -----------------------------------------------------------------------------
alter table driver_status_history enable row level security;

drop policy if exists status_history_read on driver_status_history;
create policy status_history_read on driver_status_history
  for select to authenticated using (true);

-- ไม่มี policy insert/update/delete = แอปเขียนเองไม่ได้เลย
-- มีแต่ทริกเกอร์ (security definer) ที่เขียนได้

grant select on driver_status_history to authenticated;

-- -----------------------------------------------------------------------------
-- view: ประวัติสถานะพร้อมชื่อผู้สั่ง
-- -----------------------------------------------------------------------------
create or replace view driver_status_log
with (security_invoker = on) as
select
  h.id,
  h.driver_id,
  h.from_status,
  h.to_status,
  h.reason,
  h.changed_at,
  h.changed_by,
  p.full_name as changed_by_name
from driver_status_history h
left join profiles p on p.id = h.changed_by;

grant select on driver_status_log to authenticated;

-- -----------------------------------------------------------------------------
-- เพิ่ม status_reason เข้า driver_directory เพื่อให้หน้าโปรไฟล์อ่านได้ในคำสั่งเดียว
-- -----------------------------------------------------------------------------
drop view if exists driver_directory;
create view driver_directory
with (security_invoker = on) as
select
  d.id,
  d.driver_code,
  d.full_name,
  d.phone,
  d.status,
  d.status_reason,
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

grant select on driver_directory to authenticated;
