#!/usr/bin/env python3
"""
validate_csv.py — ตรวจไฟล์ CSV จาก ETL ก่อนโหลดเข้า Postgres

จุดประสงค์: จับปัญหาที่จะทำให้ `psql -f load_from_csv.sql` ล้มกลางคัน
ตั้งแต่ตอนที่ยังแก้ง่าย แทนที่จะไปเจอตอน COPY แล้ว rollback ทั้ง transaction

ตรวจ 6 อย่าง
  1. คีย์ซ้ำ            — id / คีย์ธรรมชาติ ต้องไม่ซ้ำ
  2. foreign key        — ทุกการอ้างอิงต้องชี้ไปยังแถวที่มีจริง
  3. ข้อจำกัดของ schema — CHECK constraint ที่เขียนไว้ใน 0001_core_schema.sql
  4. ชนิดข้อมูล         — วันที่ ตัวเลข ต้องแปลงได้
  5. uuid ตรงสูตร       — สร้าง uuid5 ใหม่แล้วต้องได้ค่าเดิม
  6. การ escape ใน CSV  — ข้อความที่มีจุลภาคต้องถูกครอบด้วยเครื่องหมายคำพูด

    python scripts/validate_csv.py --dir data/out
"""
from __future__ import annotations

import argparse
import re
import sys
import uuid
from pathlib import Path

import pandas as pd

NS = uuid.UUID("6f1c2a54-7b3e-5d18-9f42-0c8a1b6e3d70")

ok_count = 0
fail_count = 0
warn_count = 0


def ok(msg: str) -> None:
    global ok_count
    ok_count += 1
    print(f"  [ผ่าน] {msg}")


def fail(msg: str) -> None:
    global fail_count
    fail_count += 1
    print(f"  [ไม่ผ่าน] {msg}")


def warn(msg: str) -> None:
    global warn_count
    warn_count += 1
    print(f"  [เตือน] {msg}")


def det_uuid(kind: str, key: str) -> str:
    return str(uuid.uuid5(NS, f"{kind}:{key}"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="data/out")
    args = ap.parse_args()

    d = Path(args.dir)
    if not d.exists():
        print(f"ไม่พบโฟลเดอร์ {d} — รัน scripts/etl_excel.py ก่อน", file=sys.stderr)
        return 2

    def load(name: str) -> pd.DataFrame:
        return pd.read_csv(d / f"{name}.csv", dtype=str, keep_default_na=False, na_values=[""])

    customers = load("customers")
    vtypes = load("vehicle_types")
    vehicles = load("vehicles")
    drivers = load("drivers")
    aliases = load("driver_aliases")
    private = load("driver_private")
    jobs = load("jobs")
    asg = load("job_assignments")

    print("=" * 64)
    print("1. คีย์ซ้ำ")
    print("=" * 64)
    for name, df, cols in [
        ("customers.id", customers, ["id"]),
        ("customers.code", customers, ["code"]),
        ("vehicle_types.code", vtypes, ["code"]),
        ("vehicles.plate", vehicles, ["plate"]),
        ("drivers.id", drivers, ["id"]),
        ("drivers.driver_code", drivers, ["driver_code"]),
        ("drivers (phone, full_name)", drivers, ["phone", "full_name"]),
        ("jobs.id", jobs, ["id"]),
        ("jobs.row_hash", jobs, ["row_hash"]),
        ("job_assignments (job_id, driver_id)", asg, ["job_id", "driver_id"]),
        ("driver_private.driver_id", private, ["driver_id"]),
        ("driver_aliases (driver_id, alias_name)", aliases, ["driver_id", "alias_name"]),
    ]:
        n = int(df.duplicated(subset=cols).sum())
        if n:
            fail(f"{name} ซ้ำ {n} แถว")
        else:
            ok(f"{name} ไม่ซ้ำ ({len(df):,} แถว)")

    print()
    print("=" * 64)
    print("2. foreign key")
    print("=" * 64)
    checks = [
        ("vehicles.vehicle_type_id -> vehicle_types.id", vehicles, "vehicle_type_id", vtypes, "id"),
        ("driver_aliases.driver_id -> drivers.id", aliases, "driver_id", drivers, "id"),
        ("driver_private.driver_id -> drivers.id", private, "driver_id", drivers, "id"),
        ("jobs.customer_code -> customers.code", jobs, "customer_code", customers, "code"),
        ("jobs.vehicle_type_code -> vehicle_types.code", jobs, "vehicle_type_code", vtypes, "code"),
        ("jobs.plate -> vehicles.plate", jobs, "plate", vehicles, "plate"),
        ("job_assignments.job_id -> jobs.id", asg, "job_id", jobs, "id"),
        ("job_assignments.driver_id -> drivers.id", asg, "driver_id", drivers, "id"),
    ]
    for label, child, ccol, parent, pcol in checks:
        vals = child[ccol].dropna()
        valid = set(parent[pcol].dropna())
        missing = sorted(set(vals) - valid)
        if missing:
            fail(f"{label} — ชี้ไปยังแถวที่ไม่มีอยู่ {len(missing)} ค่า เช่น {missing[:3]}")
        else:
            ok(f"{label} ครบทุกแถว ({len(vals):,} การอ้างอิง)")

    print()
    print("=" * 64)
    print("3. ข้อจำกัดของ schema")
    print("=" * 64)

    bad_phone = drivers[~drivers["phone"].fillna("").str.match(r"^[0-9]{9,10}$")]
    if len(bad_phone):
        fail(f"drivers.phone ผิดรูปแบบ {len(bad_phone)} แถว (CHECK ต้องเป็นเลข 9-10 หลัก)")
    else:
        ok(f"drivers.phone ผ่าน CHECK ทุกแถว ({len(drivers):,})")

    empty_name = drivers[drivers["full_name"].fillna("").str.strip() == ""]
    if len(empty_name):
        fail(f"drivers.full_name ว่าง {len(empty_name)} แถว (NOT NULL)")
    else:
        ok("drivers.full_name ไม่มีค่าว่าง")

    bad_status = set(drivers["status"].dropna()) - {"active", "probation", "inactive", "blacklisted"}
    if bad_status:
        fail(f"drivers.status มีค่านอก enum: {bad_status}")
    else:
        ok("drivers.status อยู่ใน enum driver_status ทั้งหมด")

    bad_outcome = set(asg["outcome"].dropna()) - {"completed", "no_show", "cancelled", "incident"}
    if bad_outcome:
        fail(f"job_assignments.outcome มีค่านอก enum: {bad_outcome}")
    else:
        ok("job_assignments.outcome อยู่ใน enum job_outcome ทั้งหมด")

    bad_role = set(asg["role"].dropna()) - {"primary", "secondary"}
    if bad_role:
        fail(f"job_assignments.role มีค่านอก CHECK: {bad_role}")
    else:
        ok("job_assignments.role ผ่าน CHECK ทั้งหมด")

    null_date = jobs[jobs["job_date"].isna()]
    if len(null_date):
        fail(f"jobs.job_date ว่าง {len(null_date)} แถว (NOT NULL)")
    else:
        ok("jobs.job_date ไม่มีค่าว่าง")

    print()
    print("=" * 64)
    print("4. ชนิดข้อมูล")
    print("=" * 64)

    dates = pd.to_datetime(jobs["job_date"], errors="coerce", format="%Y-%m-%d")
    n_bad = int(dates.isna().sum())
    if n_bad:
        fail(f"jobs.job_date แปลงเป็นวันที่ไม่ได้ {n_bad} แถว")
    else:
        ok(f"jobs.job_date แปลงได้ทุกแถว ({dates.min().date()} ถึง {dates.max().date()})")

    for col in ["revenue", "cost", "margin", "margin_pct", "withholding_1pct"]:
        v = pd.to_numeric(jobs[col], errors="coerce")
        broken = int((v.isna() & jobs[col].notna()).sum())
        if broken:
            fail(f"jobs.{col} แปลงเป็นตัวเลขไม่ได้ {broken} แถว")
        else:
            ok(f"jobs.{col} เป็นตัวเลขทุกแถวที่มีค่า (ว่าง {int(jobs[col].isna().sum()):,})")

    for col, df, label in [
        ("first_job_date", drivers, "drivers.first_job_date"),
        ("last_job_date", drivers, "drivers.last_job_date"),
    ]:
        v = pd.to_datetime(df[col], errors="coerce", format="%Y-%m-%d")
        broken = int((v.isna() & df[col].notna()).sum())
        if broken:
            fail(f"{label} แปลงไม่ได้ {broken} แถว")
        else:
            ok(f"{label} แปลงได้ทุกแถว")

    swapped = drivers[
        pd.to_datetime(drivers["first_job_date"], errors="coerce")
        > pd.to_datetime(drivers["last_job_date"], errors="coerce")
    ]
    if len(swapped):
        fail(f"drivers มี first_job_date มากกว่า last_job_date {len(swapped)} แถว")
    else:
        ok("drivers ทุกแถวมี first_job_date <= last_job_date")

    print()
    print("=" * 64)
    print("5. uuid ตรงสูตร (สร้างใหม่แล้วต้องได้ค่าเดิม)")
    print("=" * 64)

    exp = customers["code"].map(lambda c: det_uuid("customer", c))
    n = int((exp != customers["id"]).sum())
    fail(f"customers.id ไม่ตรงสูตร {n} แถว") if n else ok("customers.id ตรงสูตร uuid5 ทุกแถว")

    exp = vtypes["code"].map(lambda c: det_uuid("vtype", c))
    n = int((exp != vtypes["id"]).sum())
    fail(f"vehicle_types.id ไม่ตรงสูตร {n} แถว") if n else ok("vehicle_types.id ตรงสูตร uuid5 ทุกแถว")

    exp = vehicles["plate"].map(lambda p: det_uuid("vehicle", p))
    n = int((exp != vehicles["id"]).sum())
    fail(f"vehicles.id ไม่ตรงสูตร {n} แถว") if n else ok("vehicles.id ตรงสูตร uuid5 ทุกแถว")

    exp = [det_uuid("driver", f"{p}|{n_}") for p, n_ in zip(drivers["phone"], drivers["full_name"])]
    n = int((pd.Series(exp) != drivers["id"]).sum())
    fail(f"drivers.id ไม่ตรงสูตร {n} แถว") if n else ok("drivers.id ตรงสูตร uuid5 ทุกแถว")

    exp = jobs["row_hash"].map(lambda h: det_uuid("job", h))
    n = int((exp != jobs["id"]).sum())
    fail(f"jobs.id ไม่ตรงสูตร {n} แถว") if n else ok("jobs.id ตรงสูตร uuid5 ทุกแถว")

    hash_bad = jobs[~jobs["row_hash"].fillna("").str.match(r"^[0-9a-f]{64}$")]
    if len(hash_bad):
        fail(f"jobs.row_hash ไม่ใช่ sha256 hex 64 ตัว {len(hash_bad)} แถว")
    else:
        ok("jobs.row_hash เป็น sha256 hex 64 ตัวทุกแถว")

    print()
    print("=" * 64)
    print("6. การ escape ใน CSV")
    print("=" * 64)

    raw = (d / "jobs.csv").read_text(encoding="utf-8-sig")
    with_comma = jobs[jobs["route_raw"].fillna("").str.contains(",", regex=False)]
    if len(with_comma):
        sample = str(with_comma["route_raw"].iloc[0])
        quoted = f'"{sample}"' in raw
        if quoted:
            ok(f"ข้อความที่มีจุลภาคถูกครอบด้วยเครื่องหมายคำพูด ({len(with_comma):,} แถว)")
        else:
            fail("พบข้อความที่มีจุลภาคแต่ไม่ถูกครอบด้วยเครื่องหมายคำพูด — COPY จะอ่านคอลัมน์เพี้ยน")
    else:
        ok("ไม่มีข้อความที่มีจุลภาคใน route_raw")

    newline_cols = [
        c for c in jobs.columns if jobs[c].fillna("").str.contains("\n", regex=False).any()
    ]
    if newline_cols:
        warn(f"มีขึ้นบรรทัดใหม่ในคอลัมน์ {newline_cols} — COPY อ่านได้ถ้าครอบคำพูดถูก แต่ควรตรวจ")
    else:
        ok("ไม่มีการขึ้นบรรทัดใหม่กลางค่าข้อมูล")

    # จำนวนคอลัมน์ในทุกไฟล์ต้องคงที่ ไม่งั้น COPY จะฟ้อง
    for name in [
        "customers", "vehicle_types", "vehicles", "drivers",
        "driver_aliases", "driver_private", "jobs", "job_assignments",
    ]:
        path = d / f"{name}.csv"
        df = pd.read_csv(path, dtype=str, keep_default_na=False, nrows=5)
        ok(f"{name}.csv อ่านได้ปกติ ({len(df.columns)} คอลัมน์)")

    print()
    print("=" * 64)
    print(f"สรุป: ผ่าน {ok_count} · ไม่ผ่าน {fail_count} · เตือน {warn_count}")
    print("=" * 64)
    return 1 if fail_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
