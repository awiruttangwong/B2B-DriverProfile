-- 0039: แยกระบบ B2B / EXPRESS แบบเด็ดขาด
--
-- ทุกข้อมูลที่เป็นของฝั่งใดฝั่งหนึ่งมีคอลัมน์ฝั่ง และฐานข้อมูลบังคับให้ผู้ใช้เห็น/แก้ได้เฉพาะฝั่งของ
-- บัญชีตัวเอง (profiles.business_line) — ตัดสินใจกับผู้ใช้แล้วว่า:
--   - พขร. แยกคนละโปรไฟล์ (คนที่วิ่งทั้งสองฝั่งมีสองโปรไฟล์ ไม่เชื่อมกัน)
--   - สถานะ พักงาน/แบล็คลิสต์ แยกตามฝั่ง (อยู่บนแถว drivers ซึ่งแยกฝั่งแล้ว)
--   - บัญชีผู้ใช้แยกตามฝั่ง บัญชี EXPRESS ห้ามทำการใด ๆ กับฝั่ง B2B และกลับกัน
--
-- ใช้ policy แบบ RESTRICTIVE ซึ่ง AND ทับ policy เดิมทุกตัว — ไม่ต้องแก้ policy เดิมสักตัว
-- view/ฟังก์ชันค้นหาเป็น security_invoker อยู่แล้ว (driver_directory, driver_stats, search_drivers,
-- submit_rating, search_routes, activity_log ฯลฯ) จึงแยกฝั่งตามมาเองโดยไม่ต้องเขียนใหม่
-- เรียก current_line()/auth.uid() ผ่าน (select ...) เสมอ ให้ฐานข้อมูลคำนวณครั้งเดียวต่อคำสั่ง
-- ไม่ใช่ทุกแถว (สำคัญเมื่อข้อมูล EXPRESS เข้ามาหลักแสนแถว)
--
-- ข้อมูลเดิมทั้งหมดเป็น B2B ผู้ใช้ปัจจุบันจะไม่เห็นความเปลี่ยนแปลงใด ๆ หลังรันไฟล์นี้

-- -----------------------------------------------------------------------------
-- 1) ฝั่งของบัญชีผู้ใช้
-- -----------------------------------------------------------------------------
alter table profiles
  add column if not exists business_line text not null default 'B2B'
  check (business_line in ('B2B', 'EXPRESS'));

-- security definer: อ่าน profiles โดยไม่ติด RLS ของ profiles เอง (กันวนซ้ำ) ไม่มี profile = null
-- = ไม่ตรงกับฝั่งไหนเลย = มองไม่เห็นอะไร
create or replace function current_line() returns text
language sql stable security definer set search_path = public
as $$ select business_line from profiles where id = auth.uid() $$;

revoke execute on function current_line() from public, anon;
grant execute on function current_line() to authenticated;

-- ผู้ใช้แก้ profile ตัวเองได้ (profiles_self_update) แต่ห้ามย้ายฝั่งตัวเอง — ย้ายได้จาก SQL Editor
-- (role postgres) เท่านั้น
create or replace function fn_profiles_lock_line() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.business_line is distinct from old.business_line
     and current_user in ('authenticated', 'anon') then
    raise exception 'ไม่สามารถเปลี่ยนฝั่งของบัญชีจากหน้าเว็บได้';
  end if;
  return new;
end
$$;

drop trigger if exists profiles_lock_line on profiles;
create trigger profiles_lock_line before update on profiles
  for each row execute function fn_profiles_lock_line();

-- -----------------------------------------------------------------------------
-- 2) คอลัมน์ฝั่งบนข้อมูล
-- -----------------------------------------------------------------------------
alter table drivers
  add column if not exists business_line text not null default 'B2B'
  check (business_line in ('B2B', 'EXPRESS'));
alter table drivers alter column business_line set default current_line();

-- คนเดียวกัน (เบอร์+ชื่อ) มีได้ฝั่งละหนึ่งโปรไฟล์
alter table drivers drop constraint if exists drivers_natural_key;
alter table drivers add constraint drivers_natural_key unique (business_line, phone, full_name);

-- jobs.segment มีอยู่แล้วตั้งแต่ 0001 — ข้อมูลเดิมทั้งหมดเป็น B2B
update jobs set segment = 'B2B' where segment is distinct from 'B2B';
alter table jobs add constraint jobs_segment_check check (segment in ('B2B', 'EXPRESS'));
alter table jobs alter column segment set default current_line();

-- hash เดียวกันอยู่ได้ทั้งสองฝั่ง (ฝั่งเว็บเติมฝั่งเข้า hash ของ EXPRESS อยู่แล้ว นี่คือกันชั้นสอง)
alter table jobs drop constraint if exists jobs_row_hash_key;
alter table jobs add constraint jobs_segment_row_hash_key unique (segment, row_hash);

-- รหัสเส้นทางของ EXPRESS (เช่น AYA-PLK) — B2B ไม่มี
alter table jobs add column if not exists route_code text;

alter table import_batches
  add column if not exists business_line text not null default 'B2B'
  check (business_line in ('B2B', 'EXPRESS'));
alter table import_batches alter column business_line set default current_line();

create index if not exists jobs_segment_date_idx on jobs (segment, job_date);
create index if not exists drivers_business_line_idx on drivers (business_line);
create index if not exists profiles_business_line_idx on profiles (business_line);

-- -----------------------------------------------------------------------------
-- 3) นโยบายแยกฝั่ง (RESTRICTIVE — ต้องผ่านเพิ่มจาก policy เดิมเสมอ)
-- -----------------------------------------------------------------------------
drop policy if exists drivers_line on drivers;
create policy drivers_line on drivers as restrictive for all to authenticated
  using (business_line = (select current_line()))
  with check (business_line = (select current_line()));

drop policy if exists jobs_line on jobs;
create policy jobs_line on jobs as restrictive for all to authenticated
  using (segment = (select current_line()))
  with check (segment = (select current_line()));

drop policy if exists import_batches_line on import_batches;
create policy import_batches_line on import_batches as restrictive for all to authenticated
  using (business_line = (select current_line()))
  with check (business_line = (select current_line()));

-- บัญชีผู้ใช้: เห็นเฉพาะคนฝั่งเดียวกัน (+ ตัวเองเสมอ) — ทำให้รายชื่อผู้ทำรายการ, "ผู้ใช้งานใหม่"
-- และ "เข้าใช้งานระบบ" ในบันทึกกิจกรรมแยกฝั่งไปด้วยโดยอัตโนมัติ
drop policy if exists profiles_line on profiles;
create policy profiles_line on profiles as restrictive for all to authenticated
  using (id = (select auth.uid()) or business_line = (select current_line()))
  with check (id = (select auth.uid()) or business_line = (select current_line()));

drop policy if exists user_activity_sessions_line on user_activity_sessions;
create policy user_activity_sessions_line on user_activity_sessions as restrictive for all to authenticated
  using (exists (select 1 from profiles p where p.id = user_activity_sessions.user_id))
  with check (exists (select 1 from profiles p where p.id = user_activity_sessions.user_id));

-- ตารางลูกของ พขร. — มองเห็น/แก้ได้ก็ต่อเมื่อมองเห็น พขร. คนนั้น (RLS ของ drivers ทำงานใน subquery)
do $$
declare t text;
begin
  foreach t in array array[
    'driver_ratings', 'driver_contacts', 'driver_phones', 'driver_private', 'driver_aliases',
    'driver_licenses', 'driver_favorites', 'driver_status_history'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_line', t);
    execute format(
      'create policy %I on %I as restrictive for all to authenticated
         using (exists (select 1 from drivers d where d.id = %I.driver_id))
         with check (exists (select 1 from drivers d where d.id = %I.driver_id))',
      t || '_line', t, t, t);
  end loop;
end
$$;

drop policy if exists rating_scores_line on rating_scores;
create policy rating_scores_line on rating_scores as restrictive for all to authenticated
  using (exists (select 1 from driver_ratings r where r.id = rating_scores.rating_id))
  with check (exists (select 1 from driver_ratings r where r.id = rating_scores.rating_id));

drop policy if exists job_assignments_line on job_assignments;
create policy job_assignments_line on job_assignments as restrictive for all to authenticated
  using (
    exists (select 1 from jobs j where j.id = job_assignments.job_id)
    and exists (select 1 from drivers d where d.id = job_assignments.driver_id)
  )
  with check (
    exists (select 1 from jobs j where j.id = job_assignments.job_id)
    and exists (select 1 from drivers d where d.id = job_assignments.driver_id)
  );

-- รูปเอกสาร: พาธเป็น '<driver_id>/<ชนิด>.jpg' (DocumentSlot.tsx objectPath)
drop policy if exists driver_documents_line on storage.objects;
create policy driver_documents_line on storage.objects as restrictive for all to authenticated
  using (
    bucket_id <> 'driver-documents'
    or exists (select 1 from drivers d where d.id::text = (storage.foldername(name))[1])
  )
  with check (
    bucket_id <> 'driver-documents'
    or exists (select 1 from drivers d where d.id::text = (storage.foldername(name))[1])
  );

-- -----------------------------------------------------------------------------
-- 4) ลูกค้า / ประเภทรถ / ทะเบียนรถ — แยกตามฝั่งด้วย (ไม่ใช้ร่วม)
--
-- สองฝั่งเป็นการทำงานคนละส่วนกันโดยสิ้นเชิง ลูกค้าชื่อเดียวกัน (เช่น FLASH) หรือรถคันเดียวกัน
-- ที่ปรากฏทั้งสองฝั่งจึงเป็นคนละแถว แก้/ลบของฝั่งหนึ่งต้องไม่กระทบอีกฝั่ง
-- (banks และ rating_criteria เป็นรายการกลาง ไม่มีข้อมูลของฝั่งใด — ใช้ร่วมตามเดิม)
-- -----------------------------------------------------------------------------
alter table customers
  add column if not exists business_line text not null default 'B2B'
  check (business_line in ('B2B', 'EXPRESS'));
alter table customers alter column business_line set default current_line();
alter table customers drop constraint if exists customers_code_key;
alter table customers add constraint customers_line_code_key unique (business_line, code);

alter table vehicle_types
  add column if not exists business_line text not null default 'B2B'
  check (business_line in ('B2B', 'EXPRESS'));
alter table vehicle_types alter column business_line set default current_line();
alter table vehicle_types drop constraint if exists vehicle_types_code_key;
alter table vehicle_types add constraint vehicle_types_line_code_key unique (business_line, code);

alter table vehicles
  add column if not exists business_line text not null default 'B2B'
  check (business_line in ('B2B', 'EXPRESS'));
alter table vehicles alter column business_line set default current_line();
alter table vehicles drop constraint if exists vehicles_plate_key;
alter table vehicles add constraint vehicles_line_plate_key unique (business_line, plate);

do $$
declare t text;
begin
  foreach t in array array['customers', 'vehicle_types', 'vehicles'] loop
    execute format('drop policy if exists %I on %I', t || '_line', t);
    execute format(
      'create policy %I on %I as restrictive for all to authenticated
         using (business_line = (select current_line()))
         with check (business_line = (select current_line()))',
      t || '_line', t);
  end loop;
end
$$;

-- งานต้องอ้างลูกค้า/ประเภทรถ/รถของฝั่งเดียวกันเท่านั้น — foreign key ไม่ผ่าน RLS จึงต้องตรวจเอง
-- (ไม่งั้นคนที่รู้ id ของอีกฝั่งจะผูกงานของตัวเองเข้ากับข้อมูลอีกฝั่งได้)
-- security definer: ต้องอ่านฝั่งจริงของแถวที่ถูกอ้าง แม้ผู้เรียกจะมองไม่เห็นแถวนั้น
create or replace function fn_same_line_refs() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_line text;
begin
  -- แยก if ทีละตาราง: PL/pgSQL แปลงนิพจน์ตอนรันจริง อ้าง new.segment บนตาราง vehicles จะพัง
  if tg_table_name = 'jobs' then
    v_line := new.segment;
  else
    v_line := new.business_line;
  end if;

  if tg_table_name = 'jobs' then
    if new.customer_id is not null
       and (select business_line from customers where id = new.customer_id) is distinct from v_line then
      raise exception 'ลูกค้าไม่ได้อยู่ฝั่ง %', v_line;
    end if;
    if new.vehicle_id is not null
       and (select business_line from vehicles where id = new.vehicle_id) is distinct from v_line then
      raise exception 'ทะเบียนรถไม่ได้อยู่ฝั่ง %', v_line;
    end if;
  end if;
  if new.vehicle_type_id is not null
     and (select business_line from vehicle_types where id = new.vehicle_type_id) is distinct from v_line then
    raise exception 'ประเภทรถไม่ได้อยู่ฝั่ง %', v_line;
  end if;
  return new;
end
$$;

revoke execute on function fn_same_line_refs() from public, anon, authenticated;

drop trigger if exists jobs_same_line_refs on jobs;
create trigger jobs_same_line_refs before insert or update on jobs
  for each row execute function fn_same_line_refs();

drop trigger if exists vehicles_same_line_refs on vehicles;
create trigger vehicles_same_line_refs before insert or update on vehicles
  for each row execute function fn_same_line_refs();

-- -----------------------------------------------------------------------------
-- 5) รายการกลางที่ใช้ร่วมสองฝั่ง — ล็อกไม่ให้ฝั่งใดแก้จากหน้าเว็บ (แก้แล้วกระทบอีกฝั่ง)
--
-- rating_criteria: หัวข้อในแบบประเมิน เดิม admin แก้ได้ แต่ทีม EXPRESS เป็น admin ทั้งทีม — ถ้าแก้
--   ได้จะเปลี่ยนแบบประเมินของ B2B ไปด้วย หน้าเว็บไม่มีที่แก้อยู่แล้ว แก้ได้จาก SQL Editor เท่านั้น
--   (ใบประเมินและคะแนนแยกฝั่งอยู่แล้วผ่าน พขร. ที่แยกโปรไฟล์ — ใช้แค่ชุดคำถามร่วมกัน)
-- banks: รายชื่อธนาคาร ไม่มีข้อมูลของฝั่งใด ยังเพิ่มธนาคารใหม่ตอนอัปโหลดได้ แต่แก้/ลบไม่ได้
-- -----------------------------------------------------------------------------
-- แยกทีละคำสั่ง (ไม่ใช่ for all) เพราะแบบประเมินยังต้องอ่านหัวข้อได้ตามปกติ
drop policy if exists rating_criteria_no_insert on rating_criteria;
drop policy if exists rating_criteria_no_update on rating_criteria;
drop policy if exists rating_criteria_no_delete on rating_criteria;
create policy rating_criteria_no_insert on rating_criteria as restrictive for insert to authenticated
  with check (false);
create policy rating_criteria_no_update on rating_criteria as restrictive for update to authenticated
  using (false);
create policy rating_criteria_no_delete on rating_criteria as restrictive for delete to authenticated
  using (false);

drop policy if exists banks_no_update on banks;
create policy banks_no_update on banks as restrictive for update to authenticated using (false);
drop policy if exists banks_no_delete on banks;
create policy banks_no_delete on banks as restrictive for delete to authenticated using (false);
