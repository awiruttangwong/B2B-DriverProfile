#!/usr/bin/env python3
"""
build_demo_data.py — สร้างข้อมูลสำหรับ demo mode ของหน้าเว็บ

หน้าเว็บปกติอ่านข้อมูลจาก view ใน Postgres แต่ตอนรัน demo บนเครื่องยังไม่มีฐานข้อมูล
สคริปต์นี้จึงคำนวณผลของ view เหล่านั้นล่วงหน้าจาก CSV แล้วเขียนเป็น JSON

คำนวณให้ตรงกับ SQL ใน 0003_views_and_search.sql:
  driver_directory · driver_job_history · driver_customer_perf · pending_ratings

    python scripts/build_demo_data.py
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd

SRC = Path("data/out")
OUT = Path("apps/web/public/demo")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    def load(name: str) -> pd.DataFrame:
        return pd.read_csv(SRC / f"{name}.csv", dtype=str, keep_default_na=False, na_values=[""])

    customers = load("customers")
    vtypes = load("vehicle_types")
    vehicles = load("vehicles")
    drivers = load("drivers")
    jobs = load("jobs")
    asg = load("job_assignments")

    for col in ["revenue", "cost", "margin"]:
        jobs[col] = pd.to_numeric(jobs[col], errors="coerce")
    jobs["job_date"] = pd.to_datetime(jobs["job_date"], errors="coerce")

    # ---------------------------------------------------------- job history
    # เทียบเท่า view driver_job_history
    plate_to_type = dict(zip(vehicles["plate"], vehicles["vehicle_type_id"]))
    del plate_to_type  # ใช้ code จาก jobs โดยตรงอยู่แล้ว

    hist = asg.merge(jobs, left_on="job_id", right_on="id", suffixes=("_a", "_j"))
    hist = hist.rename(columns={"id_a": "assignment_id", "job_id": "job_id"})

    history_rows = []
    for r in hist.itertuples(index=False):
        history_rows.append(
            {
                "assignment_id": r.assignment_id,
                "driver_id": r.driver_id,
                "job_id": r.job_id,
                "job_date": r.job_date.strftime("%Y-%m-%d") if pd.notna(r.job_date) else None,
                "seq_no": r.seq_no if pd.notna(r.seq_no) else None,
                "customer_code": r.customer_code if pd.notna(r.customer_code) else None,
                "vehicle_type_code": r.vehicle_type_code if pd.notna(r.vehicle_type_code) else None,
                "plate": r.plate if pd.notna(r.plate) else None,
                "route_raw": r.route_raw if pd.notna(r.route_raw) else None,
                "origin": r.origin if pd.notna(r.origin) else None,
                "destination": r.destination if pd.notna(r.destination) else None,
                "revenue": None if pd.isna(r.revenue) else float(r.revenue),
                "cost": None if pd.isna(r.cost) else float(r.cost),
                "margin": None if pd.isna(r.margin) else float(r.margin),
                "note": r.note if pd.notna(r.note) else None,
                "outcome": r.outcome,
                "on_time": None,
                "rating_id": None,
                "overall_score": None,
                "rating_reason": None,
                "rating_tags": None,
            }
        )

    # ---------------------------------------------------------- directory
    # เทียบเท่า view driver_directory (driver_stats + driver_scorecard)
    today = date.today()
    g = hist.groupby("driver_id")
    stats = pd.DataFrame(
        {
            "total_jobs": g.size(),
            "customer_count": g["customer_code"].nunique(),
            "vehicle_count": g["plate"].nunique(),
            "last_job_date": g["job_date"].max(),
            "total_cost": g["cost"].sum(min_count=1),
        }
    )

    directory = []
    for r in drivers.itertuples(index=False):
        s = stats.loc[r.id] if r.id in stats.index else None
        last = s["last_job_date"] if s is not None and pd.notna(s["last_job_date"]) else None
        directory.append(
            {
                "id": r.id,
                "driver_code": r.driver_code,
                "full_name": r.full_name,
                "phone": r.phone,
                "status": r.status,
                "status_reason": None,
                "employment": r.employment,
                "note": None,
                "total_jobs": int(s["total_jobs"]) if s is not None else 0,
                "customer_count": int(s["customer_count"]) if s is not None else 0,
                "vehicle_count": int(s["vehicle_count"]) if s is not None else 0,
                "last_job_date": last.strftime("%Y-%m-%d") if last is not None else None,
                "days_since_last_job": (today - last.date()).days if last is not None else None,
                "total_cost": None
                if s is None or pd.isna(s["total_cost"])
                else float(s["total_cost"]),
                "recent_problem_jobs": 0,
                # ยังไม่มีใครให้คะแนน — ตรงกับสถานะจริงหลังนำเข้าข้อมูลชุดแรก
                "rating_count": 0,
                "raw_score": None,
                "adjusted_score": None,
            }
        )

    # ---------------------------------------------------------- perf by customer
    perf = (
        hist.groupby(["driver_id", "customer_code"])
        .agg(jobs=("assignment_id", "size"), last_job_date=("job_date", "max"))
        .reset_index()
    )
    cust_id = dict(zip(customers["code"], customers["id"]))
    perf_rows = [
        {
            "driver_id": r.driver_id,
            "customer_id": cust_id.get(r.customer_code, r.customer_code),
            "customer_code": r.customer_code,
            "jobs": int(r.jobs),
            "last_job_date": r.last_job_date.strftime("%Y-%m-%d")
            if pd.notna(r.last_job_date)
            else None,
            "avg_score": None,
            "rating_count": 0,
        }
        for r in perf.itertuples(index=False)
    ]

    # ---------------------------------------------------------- pending ratings
    # ทุกงานยังไม่มีคะแนน จึงค้างทั้งหมด ต้องใส่ให้ครบ ไม่ตัดจำนวน
    # เพราะหน้าแรกเอาจำนวนนี้ไปคิดสัดส่วน "คะแนนที่เก็บได้" ถ้าตัดไว้ตัวเลขจะผิด
    name_by_id = dict(zip(drivers["id"], drivers["full_name"]))
    phone_by_id = dict(zip(drivers["id"], drivers["phone"]))
    pending_src = sorted(
        history_rows, key=lambda h: h["job_date"] or "", reverse=True
    )
    pending = [
        {
            "assignment_id": h["assignment_id"],
            "driver_id": h["driver_id"],
            "driver_name": name_by_id.get(h["driver_id"], "?"),
            "driver_phone": phone_by_id.get(h["driver_id"], ""),
            "job_id": h["job_id"],
            "job_date": h["job_date"],
            "customer_code": h["customer_code"],
            "route_raw": h["route_raw"],
            "assigned_by": None,
        }
        for h in pending_src
    ]

    # ---------------------------------------------------------- lookups
    criteria = [
        {"id": "c1", "code": "safety", "label_th": "ความปลอดภัยในการขับขี่",
         "description": "อุบัติเหตุ การใช้ความเร็ว การดูแลรถ สภาพรถตอนคืน",
         "weight": 0.3, "display_order": 1, "is_active": True},
        {"id": "c2", "code": "punctuality", "label_th": "ตรงต่อเวลา",
         "description": "เข้ารับสินค้าตรงเวลา ถึงปลายทางตามนัด",
         "weight": 0.25, "display_order": 2, "is_active": True},
        {"id": "c3", "code": "cargo_care", "label_th": "การดูแลสินค้า",
         "description": "ความเสียหายของสินค้า การจัดเรียง การควบคุมอุณหภูมิ",
         "weight": 0.2, "display_order": 3, "is_active": True},
        {"id": "c4", "code": "communication", "label_th": "การสื่อสาร",
         "description": "รับสาย แจ้งปัญหาทันที ส่งรูปยืนยันการส่ง",
         "weight": 0.15, "display_order": 4, "is_active": True},
        {"id": "c5", "code": "compliance", "label_th": "ระเบียบและเอกสาร",
         "description": "เอกสารครบถ้วน การแต่งกาย การปฏิบัติตามกฎของลูกค้าปลายทาง",
         "weight": 0.1, "display_order": 5, "is_active": True},
    ]

    files = {
        "driver_directory": directory,
        "driver_job_history": history_rows,
        "driver_customer_perf": perf_rows,
        "pending_ratings": pending,
        "customers": [
            {"id": r.id, "code": r.code, "name": r.name, "is_active": True}
            for r in customers.itertuples(index=False)
        ],
        "vehicle_types": [
            {"id": r.id, "code": r.code, "name": r.name, "axle_class": None}
            for r in vtypes.itertuples(index=False)
        ],
        "rating_criteria": criteria,
        # สามตารางนี้มีแค่คอลัมน์ที่หน้าอัปโหลดใช้ตรวจของซ้ำ
        # ถ้าไม่มี ทุกแถวจะดูเหมือนเป็นของใหม่หมด แล้วตัวเลขบนหน้าจะโกหก
        "jobs": [{"row_hash": h} for h in jobs["row_hash"].dropna().tolist()],
        "drivers": [
            {"id": r.id, "full_name": r.full_name, "phone": r.phone}
            for r in drivers.itertuples(index=False)
        ],
        "vehicles": [
            {"id": r.id, "plate": r.plate} for r in vehicles.itertuples(index=False)
        ],
    }

    total = 0
    for name, rows in files.items():
        p = OUT / f"{name}.json"
        p.write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        kb = p.stat().st_size / 1024
        total += kb
        print(f"  {p}  {len(rows):,} แถว  {kb:,.0f} KB")

    print(f"\nรวม {total / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
