-- =============================================================================
-- 0002_rls.sql
-- สิทธิ์ทั้งหมดบังคับที่ฐานข้อมูลชั้นเดียว หน้าเว็บแค่ซ่อนปุ่มเพื่อความสวยงาม
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ฟังก์ชันช่วย — security definer เพื่อไม่ให้เกิด recursion กับ RLS ของ profiles
-- -----------------------------------------------------------------------------
create or replace function auth_role() returns app_role
language sql stable security definer set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and role = any(roles)
  )
$$;

-- เห็นข้อมูลอ่อนไหวได้หรือไม่
create or replace function can_see_pii() returns boolean
language sql stable security definer set search_path = public
as $$ select has_role('admin', 'hr') $$;

-- แก้ข้อมูลหลัก (พขร. / งาน) ได้หรือไม่
create or replace function can_write_master() returns boolean
language sql stable security definer set search_path = public
as $$ select has_role('admin', 'hr', 'ops') $$;

grant execute on function auth_role, has_role, can_see_pii, can_write_master to authenticated;

-- -----------------------------------------------------------------------------
-- เปิด RLS ทุกตาราง
-- -----------------------------------------------------------------------------
alter table profiles         enable row level security;
alter table customers        enable row level security;
alter table vehicle_types    enable row level security;
alter table banks            enable row level security;
alter table vehicles         enable row level security;
alter table drivers          enable row level security;
alter table driver_aliases   enable row level security;
alter table driver_private   enable row level security;
alter table driver_licenses  enable row level security;
alter table jobs             enable row level security;
alter table job_assignments  enable row level security;
alter table import_batches   enable row level security;
alter table rating_criteria  enable row level security;
alter table driver_ratings   enable row level security;
alter table rating_scores    enable row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy profiles_read on profiles for select to authenticated
  using (true);

create policy profiles_self_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = auth_role());

create policy profiles_admin_all on profiles for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- -----------------------------------------------------------------------------
-- ตารางอ้างอิง — ทุกคนที่ล็อกอินอ่านได้ / ops ขึ้นไปเพิ่มได้ (จำเป็นตอน import)
-- -----------------------------------------------------------------------------
create policy customers_read on customers for select to authenticated using (true);
create policy customers_write on customers for all to authenticated
  using (can_write_master()) with check (can_write_master());

create policy vehicle_types_read on vehicle_types for select to authenticated using (true);
create policy vehicle_types_write on vehicle_types for all to authenticated
  using (can_write_master()) with check (can_write_master());

create policy banks_read on banks for select to authenticated using (true);
create policy banks_write on banks for all to authenticated
  using (can_write_master()) with check (can_write_master());

create policy vehicles_read on vehicles for select to authenticated using (true);
create policy vehicles_write on vehicles for all to authenticated
  using (can_write_master()) with check (can_write_master());

-- -----------------------------------------------------------------------------
-- drivers
-- -----------------------------------------------------------------------------
create policy drivers_read on drivers for select to authenticated using (true);

create policy drivers_insert on drivers for insert to authenticated
  with check (can_write_master());

create policy drivers_update on drivers for update to authenticated
  using (can_write_master()) with check (can_write_master());

-- ลบ พขร. ได้เฉพาะ admin และเฉพาะคนที่ยังไม่มีประวัติงาน
create policy drivers_delete on drivers for delete to authenticated
  using (
    has_role('admin')
    and not exists (select 1 from job_assignments a where a.driver_id = drivers.id)
  );

create policy driver_aliases_read on driver_aliases for select to authenticated using (true);
create policy driver_aliases_write on driver_aliases for all to authenticated
  using (can_write_master()) with check (can_write_master());

create policy driver_licenses_read on driver_licenses for select to authenticated using (true);
create policy driver_licenses_write on driver_licenses for all to authenticated
  using (has_role('admin','hr')) with check (has_role('admin','hr'));

-- ข้อมูลอ่อนไหว: hr / admin เท่านั้น ทั้งอ่านและเขียน
create policy driver_private_read on driver_private for select to authenticated
  using (can_see_pii());
create policy driver_private_write on driver_private for all to authenticated
  using (can_see_pii()) with check (can_see_pii());

-- -----------------------------------------------------------------------------
-- งาน
-- -----------------------------------------------------------------------------
create policy jobs_read on jobs for select to authenticated using (true);
create policy jobs_write on jobs for all to authenticated
  using (can_write_master()) with check (can_write_master());

create policy job_assignments_read on job_assignments for select to authenticated using (true);
create policy job_assignments_write on job_assignments for all to authenticated
  using (can_write_master()) with check (can_write_master());

create policy import_batches_read on import_batches for select to authenticated using (true);
create policy import_batches_write on import_batches for all to authenticated
  using (can_write_master()) with check (can_write_master());

-- -----------------------------------------------------------------------------
-- คะแนน — หัวใจของกติกา
-- -----------------------------------------------------------------------------
create policy rating_criteria_read on rating_criteria for select to authenticated using (true);
create policy rating_criteria_write on rating_criteria for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- อ่าน: ใบที่ยังไม่ถูกยกเลิกเห็นได้ทุกคน ใบที่ยกเลิกแล้วเห็นเฉพาะ admin
create policy ratings_read on driver_ratings for select to authenticated
  using (voided_at is null or has_role('admin'));

-- เขียน: ต้องเป็นตัวเอง งานต้องจบแล้ว และต้องเป็นคนที่เกี่ยวข้องกับงานนั้น
-- (assignment_id เป็น null ได้สำหรับคะแนนทั่วไป แต่ต้องเป็น admin/ops เท่านั้น)
create policy ratings_insert on driver_ratings for insert to authenticated
  with check (
    rater_id = auth.uid()
    and has_role('admin', 'ops', 'hr')
    and (
      assignment_id is null
      or exists (
        select 1 from job_assignments a
        where a.id = assignment_id
          and a.driver_id = driver_ratings.driver_id
          and a.outcome = 'completed'
      )
    )
  );

-- แก้: เฉพาะใบตัวเอง ยังไม่ถูกล็อก และภายใน 24 ชั่วโมง
create policy ratings_update on driver_ratings for update to authenticated
  using (
    rater_id = auth.uid()
    and locked_at is null
    and voided_at is null
    and created_at > now() - interval '24 hours'
  )
  with check (rater_id = auth.uid());

-- admin ยกเลิกใบได้ (void) แต่ยังลบไม่ได้
create policy ratings_admin_void on driver_ratings for update to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- ไม่มี policy สำหรับ delete = ลบคะแนนไม่ได้เลยทั้งระบบ

create policy rating_scores_read on rating_scores for select to authenticated using (true);

create policy rating_scores_write on rating_scores for all to authenticated
  using (
    exists (
      select 1 from driver_ratings r
      where r.id = rating_scores.rating_id
        and r.rater_id = auth.uid()
        and r.locked_at is null
        and r.created_at > now() - interval '24 hours'
    )
  )
  with check (
    exists (
      select 1 from driver_ratings r
      where r.id = rating_scores.rating_id
        and r.rater_id = auth.uid()
        and r.locked_at is null
        and r.created_at > now() - interval '24 hours'
    )
  );

-- -----------------------------------------------------------------------------
-- สร้าง profile อัตโนมัติเมื่อมีผู้ใช้ใหม่สมัคร
-- คนแรกของระบบได้เป็น admin ที่เหลือเป็น viewer รอ admin เลื่อนสิทธิ์
-- -----------------------------------------------------------------------------
create or replace function fn_handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role app_role := 'viewer';
begin
  if not exists (select 1 from profiles) then
    v_role := 'admin';
  end if;

  insert into profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    v_role
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function fn_handle_new_user();
