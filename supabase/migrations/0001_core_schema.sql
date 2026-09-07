-- =============================================================================
-- 0001_core_schema.sql
-- ระบบโปรไฟล์และคะแนน พขร. — ตารางหลัก
--
-- ออกแบบจากข้อมูลจริงในไฟล์ ALLMANUAL_cleaned.xlsx (7,507 เที่ยว, ม.ค. 2025 - ส.ค. 2026)
-- หนึ่งแถวในไฟล์ = หนึ่งเที่ยว = jobs 1 แถว + job_assignments 1 แถว
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";   -- ค้นหาชื่อไทยแบบคล้ายคลึง

-- -----------------------------------------------------------------------------
-- ผู้ใช้ระบบ (พนักงานของเรา ไม่ใช่ พขร.)
-- -----------------------------------------------------------------------------
create type app_role as enum ('admin', 'hr', 'ops', 'viewer');

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text,
  role        app_role not null default 'viewer',
  department  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table profiles is 'พนักงานของบริษัทที่ใช้ระบบ — ผูกกับ auth.users';

-- -----------------------------------------------------------------------------
-- ตารางอ้างอิง
-- -----------------------------------------------------------------------------
create table customers (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- ประเภทงาน: DD, OFM, GO HAIR, ASL ...
  name        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on column customers.code is 'มาจากคอลัมน์ "ประเภทงาน" แปลงเป็นตัวพิมพ์ใหญ่แล้ว';

create table vehicle_types (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- 4W, 6W, 4WJ, 40''HQ, หัวลาก พื้นเรียบ ...
  name        text,
  axle_class  text,                          -- จัดกลุ่มหยาบ ๆ: small / medium / large / container
  created_at  timestamptz not null default now()
);

create table banks (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- KBANK, SCB, KTB, BBL ...
  name        text
);

create table vehicles (
  id               uuid primary key default gen_random_uuid(),
  plate            text not null unique,     -- ทะเบียน (normalize ช่องว่างแล้ว)
  vehicle_type_id  uuid references vehicle_types(id),
  note             text,
  created_at       timestamptz not null default now()
);
comment on table vehicles is 'รถหนึ่งคันมี พขร. ได้หลายคน และ พขร. หนึ่งคนขับได้หลายคัน';

-- -----------------------------------------------------------------------------
-- พขร.
-- -----------------------------------------------------------------------------
create type driver_status as enum ('active', 'probation', 'inactive', 'blacklisted');
create type employment_type as enum ('employee', 'contractor', 'vendor', 'unknown');

create sequence driver_code_seq;

create table drivers (
  id               uuid primary key default gen_random_uuid(),
  driver_code      text not null unique
                     default 'DRV-' || lpad(nextval('driver_code_seq')::text, 5, '0'),
  full_name        text not null,
  phone            text not null,            -- 10 หลัก ไม่มีขีด
  status           driver_status not null default 'active',
  employment       employment_type not null default 'unknown',
  base_province    text,
  photo_path       text,
  note             text,
  -- สรุปจากการ import (คำนวณใหม่ได้เสมอ เก็บไว้เพื่อความเร็ว)
  first_job_date   date,
  last_job_date    date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references profiles(id),

  constraint drivers_phone_digits check (phone ~ '^[0-9]{9,10}$'),
  -- คีย์ธรรมชาติจากไฟล์: เบอร์เดียวกันแต่คนละชื่อ = คนละคน (พบจริง 80 เบอร์)
  constraint drivers_natural_key unique (phone, full_name)
);

comment on constraint drivers_natural_key on drivers is
  'เบอร์โทรอย่างเดียวไม่พอ — ในข้อมูลจริงมี 80 เบอร์ที่มีชื่อมากกว่าหนึ่ง (เบอร์กลางของผู้รับเหมา) '
  'และ 87 ชื่อที่มีหลายเบอร์ (เปลี่ยนเบอร์) การ import จะรวมชื่อที่สะกดใกล้เคียงกันบนเบอร์เดียวกันให้เอง';

create index drivers_phone_idx on drivers (phone);
create index drivers_name_trgm_idx on drivers using gin (full_name gin_trgm_ops);
create index drivers_status_idx on drivers (status) where status = 'active';

-- ชื่อที่สะกดต่างกันของคนเดียวกัน เก็บไว้ให้ค้นหาเจอและ import ซ้ำได้ผลเดิม
create table driver_aliases (
  driver_id   uuid not null references drivers(id) on delete cascade,
  alias_name  text not null,
  seen_count  int not null default 1,
  primary key (driver_id, alias_name)
);

-- ข้อมูลอ่อนไหว แยกตาราง เปิดสิทธิ์เฉพาะ hr/admin
create table driver_private (
  driver_id     uuid primary key references drivers(id) on delete cascade,
  bank_id       uuid references banks(id),
  account_no    text,                        -- เลขบัญชี
  account_name  text,                        -- ชื่อผู้รับโอน
  national_id   text,
  address       text,
  updated_at    timestamptz not null default now()
);
comment on table driver_private is 'PII — RLS เปิดเฉพาะ hr และ admin เท่านั้น';

create table driver_licenses (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references drivers(id) on delete cascade,
  license_type text not null,                -- ท.1 - ท.4
  license_no  text,
  issued_at   date,
  expires_at  date,
  doc_path    text,
  created_at  timestamptz not null default now()
);
create index driver_licenses_expiry_idx on driver_licenses (expires_at);

-- -----------------------------------------------------------------------------
-- งานและประวัติการวิ่ง
-- -----------------------------------------------------------------------------
create type job_outcome as enum ('completed', 'no_show', 'cancelled', 'incident');

create table import_batches (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  sheet_name   text,
  uploaded_by  uuid references profiles(id),
  row_total    int not null default 0,
  row_inserted int not null default 0,
  row_skipped  int not null default 0,
  row_failed   int not null default 0,
  status       text not null default 'running',   -- running | done | failed
  error_log    jsonb,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table jobs (
  id                uuid primary key default gen_random_uuid(),
  job_date          date not null,                    -- วันที่
  segment           text not null default 'B2B',      -- ประเภท
  customer_id       uuid references customers(id),    -- ประเภทงาน
  vehicle_type_id   uuid references vehicle_types(id),-- ประเภทรถ
  vehicle_id        uuid references vehicles(id),     -- ทะเบียน

  route_raw         text,                             -- เส้นทาง (Route) ข้อความดิบ
  origin            text,                             -- แยกจาก route_raw ถ้าแยกได้
  destination       text,

  revenue           numeric(12,2),                    -- ราคารับ
  cost              numeric(12,2),                    -- ราคาจ่าย
  margin            numeric(12,2),                    -- ส่วนต่าง
  margin_pct        numeric(8,5),                     -- กำไร %
  withholding_1pct  numeric(12,2),                    -- ยอดหัก 1%

  dispatcher_name   text,                             -- ชื่อหัวจ่าย
  dispatcher_phone  text,                             -- เบอร์โทรหัวจ่าย
  note              text,                             -- หมายเหตุ

  source            text not null default 'import',   -- import | manual | api
  import_batch_id   uuid references import_batches(id) on delete set null,
  -- กัน import ซ้ำ: hash ของฟิลด์ที่ระบุเที่ยวหนึ่ง ๆ ได้
  row_hash          text unique,

  created_at        timestamptz not null default now(),
  created_by        uuid references profiles(id)
);

create index jobs_date_idx on jobs (job_date desc);
create index jobs_customer_idx on jobs (customer_id, job_date desc);
create index jobs_vehicle_type_idx on jobs (vehicle_type_id);
create index jobs_route_trgm_idx on jobs using gin (route_raw gin_trgm_ops);

comment on column jobs.row_hash is
  'sha256 ของ (วันที่, ลูกค้า, ทะเบียน, เบอร์ พขร., เส้นทาง, ราคารับ, ราคาจ่าย) '
  'ทำให้อัปโหลดไฟล์เดิมซ้ำแล้วไม่เกิดข้อมูลซ้ำ';

create table job_assignments (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references jobs(id) on delete cascade,
  driver_id     uuid not null references drivers(id) on delete restrict,
  role          text not null default 'primary' check (role in ('primary','secondary')),

  outcome       job_outcome not null default 'completed',
  on_time       boolean,
  delay_minutes int,

  assigned_by   uuid references profiles(id),
  assigned_at   timestamptz not null default now(),
  completed_at  timestamptz,

  unique (job_id, driver_id)
);

create index job_assignments_driver_idx on job_assignments (driver_id);
create index job_assignments_job_idx on job_assignments (job_id);

comment on table job_assignments is
  'แหล่งความจริงของ "ประวัติงาน" — ข้อมูลนำเข้าถือว่า outcome = completed ทั้งหมด '
  'เพราะไฟล์ต้นทางบันทึกเฉพาะงานที่วิ่งจริง';

-- -----------------------------------------------------------------------------
-- ระบบให้คะแนน
-- -----------------------------------------------------------------------------
create table rating_criteria (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  label_th      text not null,
  description   text,
  weight        numeric(4,3) not null check (weight > 0 and weight <= 1),
  display_order int not null default 0,
  is_active     boolean not null default true
);

create table driver_ratings (
  id             uuid primary key default gen_random_uuid(),
  driver_id      uuid not null references drivers(id) on delete cascade,
  assignment_id  uuid references job_assignments(id) on delete set null,
  rater_id       uuid not null references profiles(id),

  overall_score  numeric(3,2) not null check (overall_score between 1 and 5),
  reason         text not null,
  tags           text[] not null default '{}',
  assign_again   boolean,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  locked_at      timestamptz,
  voided_at      timestamptz,
  voided_by      uuid references profiles(id),
  void_reason    text,

  -- เหตุผลเป็นหัวใจของระบบ บังคับที่ระดับฐานข้อมูล ไม่ใช่แค่หน้าจอ
  constraint driver_ratings_reason_len check (char_length(btrim(reason)) >= 20),
  -- หนึ่งใบต่อหนึ่งงานต่อหนึ่งผู้ให้คะแนน
  constraint driver_ratings_one_per_job unique (assignment_id, rater_id)
);

create index driver_ratings_driver_idx on driver_ratings (driver_id, created_at desc);
create index driver_ratings_rater_idx on driver_ratings (rater_id);

create table rating_scores (
  rating_id    uuid not null references driver_ratings(id) on delete cascade,
  criteria_id  uuid not null references rating_criteria(id),
  score        int not null check (score between 1 and 5),
  primary key (rating_id, criteria_id)
);

-- -----------------------------------------------------------------------------
-- Trigger
-- -----------------------------------------------------------------------------

-- ล็อกใบให้คะแนนหลัง 24 ชม. (ตั้งค่าเมื่อมีการแตะแถวหลังพ้นกำหนด + cron ตั้งย้อนหลัง)
create or replace function fn_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger drivers_touch before update on drivers
  for each row execute function fn_touch_updated_at();
create trigger driver_ratings_touch before update on driver_ratings
  for each row execute function fn_touch_updated_at();

-- คำนวณคะแนนรวมถ่วงน้ำหนักจากคะแนนรายเกณฑ์ ผู้ให้คะแนนไม่ต้องกรอกเลขรวมเอง
--
-- ต้องเป็น security definer เพราะเป็นการคำนวณของระบบ ไม่ใช่การกระทำของผู้ใช้
-- ถ้าปล่อยให้วิ่งด้วยสิทธิ์ผู้เรียก RLS จะบล็อกการ update เงียบ ๆ (0 แถว ไม่มี error)
-- แล้วคะแนนรวมจะค้างเป็นค่าเริ่มต้นโดยไม่มีใครรู้
create or replace function fn_recalc_overall_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rating_id uuid := coalesce(new.rating_id, old.rating_id);
  v_score numeric;
begin
  select sum(s.score * c.weight) / nullif(sum(c.weight), 0)
    into v_score
  from rating_scores s
  join rating_criteria c on c.id = s.criteria_id
  where s.rating_id = v_rating_id;

  if v_score is not null then
    update driver_ratings
       set overall_score = round(v_score, 2)
     where id = v_rating_id;
  end if;
  return null;
end $$;

create trigger rating_scores_recalc
  after insert or update or delete on rating_scores
  for each row execute function fn_recalc_overall_score();

-- อัปเดตช่วงวันที่ทำงานของ พขร. เมื่อมีงานใหม่ (ระบบทำเอง จึงเป็น security definer)
create or replace function fn_sync_driver_job_dates() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update drivers d
     set first_job_date = least(coalesce(d.first_job_date, j.job_date), j.job_date),
         last_job_date  = greatest(coalesce(d.last_job_date, j.job_date), j.job_date)
    from jobs j
   where j.id = new.job_id
     and d.id = new.driver_id;
  return new;
end $$;

create trigger job_assignments_sync_dates
  after insert on job_assignments
  for each row execute function fn_sync_driver_job_dates();
