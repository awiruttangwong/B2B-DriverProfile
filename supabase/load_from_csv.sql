-- =============================================================================
-- load_from_csv.sql — โหลดข้อมูลชุดแรกจาก data/out/*.csv เข้าฐานข้อมูล
--
-- รันจากโฟลเดอร์รากของโปรเจกต์:
--     psql "$DATABASE_URL" -f supabase/load_from_csv.sql
--
-- รันซ้ำได้ปลอดภัย — ทุกตารางใช้ ON CONFLICT DO NOTHING และ id เป็นแบบ
-- deterministic (uuid5) จาก ETL อยู่แล้ว
-- =============================================================================

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- staging
create temp table stg_customers      (id uuid, code text, name text) on commit drop;
create temp table stg_vehicle_types  (id uuid, code text, name text) on commit drop;
create temp table stg_vehicles       (id uuid, plate text, vehicle_type_id uuid) on commit drop;
create temp table stg_drivers (
  id uuid, driver_code text, full_name text, phone text,
  status text, employment text, first_job_date date, last_job_date date
) on commit drop;
create temp table stg_aliases        (driver_id uuid, alias_name text, seen_count int) on commit drop;
create temp table stg_private (
  driver_id uuid, bank_code text, account_no text, account_name text
) on commit drop;
-- ลำดับคอลัมน์ต้องตรงกับหัวตารางใน data/out/jobs.csv เป๊ะ เพราะ \copy จับคู่ตามตำแหน่ง
create temp table stg_jobs (
  id uuid, job_date date, seq_no text, segment text, customer_code text, vehicle_type_code text,
  plate text, route_raw text, origin text, destination text,
  revenue numeric, cost numeric, margin numeric, margin_pct numeric,
  withholding_1pct numeric, dispatcher_name text, dispatcher_phone text,
  note text, row_hash text
) on commit drop;
create temp table stg_assignments (
  id uuid, job_id uuid, driver_id uuid, role text, outcome text
) on commit drop;

\copy stg_customers     from 'data/out/customers.csv'      with (format csv, header true, encoding 'UTF8')
\copy stg_vehicle_types from 'data/out/vehicle_types.csv'  with (format csv, header true, encoding 'UTF8')
\copy stg_vehicles      from 'data/out/vehicles.csv'       with (format csv, header true, encoding 'UTF8')
\copy stg_drivers       from 'data/out/drivers.csv'        with (format csv, header true, encoding 'UTF8')
\copy stg_aliases       from 'data/out/driver_aliases.csv' with (format csv, header true, encoding 'UTF8')
\copy stg_private       from 'data/out/driver_private.csv' with (format csv, header true, encoding 'UTF8')
\copy stg_jobs          from 'data/out/jobs.csv'           with (format csv, header true, encoding 'UTF8')
\copy stg_assignments   from 'data/out/job_assignments.csv' with (format csv, header true, encoding 'UTF8')

-- ------------------------------------------------------------------ lookups
insert into customers (id, code, name)
select id, code, name from stg_customers
on conflict (code) do nothing;

insert into vehicle_types (id, code, name)
select id, code, name from stg_vehicle_types
on conflict (code) do nothing;

insert into vehicles (id, plate, vehicle_type_id)
select s.id, s.plate, vt.id
from stg_vehicles s
left join stg_vehicle_types sv on sv.id = s.vehicle_type_id
left join vehicle_types vt     on vt.code = sv.code
on conflict (plate) do nothing;

-- ------------------------------------------------------------------ drivers
insert into drivers (
  id, driver_code, full_name, phone, status, employment, first_job_date, last_job_date
)
select id, driver_code, full_name, phone,
       status::driver_status, employment::employment_type,
       first_job_date, last_job_date
from stg_drivers
on conflict (phone, full_name) do nothing;

-- ให้ลำดับรหัส พขร. เริ่มต่อจากรหัสสูงสุดที่โหลดเข้าไป
select setval('driver_code_seq',
              coalesce((select max(substring(driver_code from 5)::int) from drivers), 0) + 1,
              false);

insert into driver_aliases (driver_id, alias_name, seen_count)
select a.driver_id, a.alias_name, a.seen_count
from stg_aliases a
where exists (select 1 from drivers d where d.id = a.driver_id)
on conflict (driver_id, alias_name) do nothing;

insert into driver_private (driver_id, bank_id, account_no, account_name)
select p.driver_id, b.id, p.account_no, p.account_name
from stg_private p
left join banks b on b.code = p.bank_code
where exists (select 1 from drivers d where d.id = p.driver_id)
on conflict (driver_id) do nothing;

-- --------------------------------------------------------------------- jobs
insert into jobs (
  id, job_date, seq_no, segment, customer_id, vehicle_type_id, vehicle_id,
  route_raw, origin, destination,
  revenue, cost, margin, margin_pct, withholding_1pct,
  dispatcher_name, dispatcher_phone, note, source, row_hash
)
select
  s.id, s.job_date, s.seq_no, coalesce(s.segment, 'B2B'),
  c.id, vt.id, v.id,
  s.route_raw, s.origin, s.destination,
  s.revenue, s.cost, s.margin, s.margin_pct, s.withholding_1pct,
  s.dispatcher_name, s.dispatcher_phone, s.note, 'import', s.row_hash
from stg_jobs s
left join customers c      on c.code  = s.customer_code
left join vehicle_types vt on vt.code = s.vehicle_type_code
left join vehicles v       on v.plate = s.plate
on conflict (row_hash) do nothing;

insert into job_assignments (id, job_id, driver_id, role, outcome)
select a.id, a.job_id, a.driver_id, a.role, a.outcome::job_outcome
from stg_assignments a
where exists (select 1 from jobs j    where j.id = a.job_id)
  and exists (select 1 from drivers d where d.id = a.driver_id)
on conflict (job_id, driver_id) do nothing;

commit;

-- -------------------------------------------------------------------- สรุป
select 'customers'       as table_name, count(*) from customers
union all select 'vehicle_types',  count(*) from vehicle_types
union all select 'vehicles',       count(*) from vehicles
union all select 'drivers',        count(*) from drivers
union all select 'driver_aliases', count(*) from driver_aliases
union all select 'driver_private', count(*) from driver_private
union all select 'jobs',           count(*) from jobs
union all select 'job_assignments',count(*) from job_assignments;
