-- =============================================================================
-- 0007_route_suggestions.sql
-- คำแนะนำเส้นทางสำหรับช่องค้นหาอิสระในหน้า "หาคนสำหรับงาน"
-- ไม่บังคับให้เลือก แค่ช่วยพิมพ์เร็วขึ้นด้วยเส้นทางที่เคยมีจริงในระบบ
-- เรียงจากที่วิ่งบ่อยที่สุดก่อน เพื่อดันเส้นทางพิมพ์ผิด/ครั้งเดียวลงท้ายลิสต์
-- =============================================================================

create or replace function search_routes(p_limit int default 500)
returns table (route_raw text, job_count bigint)
language sql stable security invoker
as $$
  select route_raw, count(*) as job_count
  from jobs
  where route_raw is not null and btrim(route_raw) <> ''
  group by route_raw
  order by job_count desc, route_raw
  limit p_limit
$$;

grant execute on function search_routes to authenticated;
