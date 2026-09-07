#!/usr/bin/env python3
"""
etl_excel.py — แปลง ALLMANUAL_cleaned.xlsx เป็นตารางที่ normalize แล้ว พร้อมนำเข้า Postgres

ใช้ UUID แบบ deterministic (uuid5 จากคีย์ธรรมชาติ) ทำให้รันซ้ำกี่ครั้งก็ได้ id เดิม
อัปโหลดไฟล์เดิมซ้ำจึงไม่เกิดข้อมูลซ้ำ (ON CONFLICT DO NOTHING จับได้)

    python scripts/etl_excel.py ALLMANUAL_cleaned.xlsx --out data/out

ผลลัพธ์: CSV หนึ่งไฟล์ต่อหนึ่งตาราง + load.sql + report.txt
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import re
import sys
import uuid
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

# namespace คงที่ — ห้ามเปลี่ยน ไม่งั้น id ทั้งระบบจะเปลี่ยนตาม
NS = uuid.UUID("6f1c2a54-7b3e-5d18-9f42-0c8a1b6e3d70")

# ชื่อบนเบอร์เดียวกันที่คล้ายกันเกินเกณฑ์นี้ ถือว่าเป็นคนเดียวกันสะกดต่างกัน
NAME_MERGE_RATIO = 0.72

# ---------------------------------------------------------------- หัวตาราง
# ต้องตรงกับ apps/web/src/lib/sourceProfiles.ts ทุกบรรทัด
#
# ไฟล์งานจริงมีหัวตารางอย่างน้อยสามแบบที่หมายถึงสิ่งเดียวกัน จึงเก็บเป็นรายการ
# "ชื่อที่ยอมรับได้" แล้วจับคู่ด้วยหัวตารางที่ normalize แล้ว ลำดับ = ความสำคัญ
FIELD_ALIASES = {
    "segment": ["ประเภท", "express", "segment"],
    "date": ["วันที่", "date"],
    "seq": ["ลำดับงาน", "ลำดับ"],
    "customer": ["ลูกค้า", "ประเภทงาน", "customer"],
    "vehicle_type": ["ประเภทรถ"],
    "plate": ["ทะเบียน", "ทะเบียนรถ"],
    "driver_name": ["ชื่อพขร", "ชื่อคนขับ", "ชื่อพนักงานขับรถ"],
    "driver_phone": ["เบอร์โทรพขร", "เบอร์โทรคนขับ", "เบอร์โทร", "เบอร์โทรศัพท์"],
    "route": ["เส้นทาง(route)", "เส้นทาง/ดรอป/จำนวนลัง", "เส้นทาง", "route"],
    "account_name": ["ชื่อผู้รับโอน", "ชื่อผุ้รับโอน"],
    "account_no": ["เลขบัญชี"],
    "bank": ["ธนาคาร"],
    "note": ["หมายเหตุ"],
    "dispatcher_name": ["ชื่อหัวจ่าย"],
    "dispatcher_phone": ["เบอร์โทรหัวจ่าย"],
    "revenue": ["ราคารับ", "ราคาวางบิล"],
    "cost": ["ราคาจ่าย", "ค่าเที่ยวพขร", "รวมจ่ายพขร"],
    "margin": ["ส่วนต่าง"],
    "margin_pct": ["กำไร%"],
    "withholding": ["ยอดหัก1%", "1%"],
}

REQUIRED_FIELDS = ["date", "driver_name", "driver_phone"]


def norm_header(h) -> str:
    """ตัดช่องว่าง จุดท้ายคำ และตัวพิมพ์ใหญ่ออกจากหัวตาราง"""
    if h is None or (isinstance(h, float) and pd.isna(h)):
        return ""
    return re.sub(r"[.:]+$", "", re.sub(r"\s+", "", str(h))).lower()


def match_header_row(cells) -> dict[str, int]:
    """จับคู่หัวตารางหนึ่งแถวเข้ากับฟิลด์กลาง คืน {field: column index}"""
    norm = [norm_header(c) for c in cells]
    cols: dict[str, int] = {}
    taken: set[int] = set()
    for field, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            idx = next((i for i, h in enumerate(norm) if h == alias and i not in taken), None)
            if idx is not None:
                cols[field] = idx
                taken.add(idx)
                break
    return cols


def find_header_row(aoa, lookahead: int = 8):
    """หาแถวหัวตาราง — ชีต Pivot มีแถวว่างคั่นก่อน จึงเดาว่าเป็นแถว 0 ไม่ได้"""
    best = None
    for i in range(min(lookahead, len(aoa))):
        cols = match_header_row(aoa[i])
        if any(f not in cols for f in REQUIRED_FIELDS):
            continue
        if best is None or len(cols) > len(best[1]):
            best = (i, cols)
    return best


# ---------------------------------------------------------------- normalizers
def norm_text(v) -> str | None:
    """ยุบช่องว่างซ้ำ ตัดหัวท้าย คืน None ถ้าว่าง"""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def norm_phone(v) -> str | None:
    """เหลือแต่ตัวเลข เติม 0 นำหน้าให้เบอร์ 9 หลักที่ Excel กินศูนย์ไป"""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    if s.endswith(".0"):
        s = s[:-2]
    d = re.sub(r"\D", "", s)
    if len(d) == 9 and not d.startswith("0"):
        d = "0" + d
    return d if 9 <= len(d) <= 10 else None


def norm_code(v) -> str | None:
    """รหัสลูกค้า — ตัวพิมพ์ใหญ่ทั้งหมด รวม GO Hair / GO hair / Go hair เป็นตัวเดียว"""
    s = norm_text(v)
    return s.upper() if s else None


def norm_plate(v) -> str | None:
    """ทะเบียน — ยุบช่องว่าง ตัดขีดหน้าหลัง"""
    s = norm_text(v)
    if not s:
        return None
    return s.strip(" -/")


def norm_bank(v) -> str | None:
    """'KBANK - กสิกรไทย' -> 'KBANK' ; 'Prompt Pay' -> 'PROMPTPAY'"""
    s = norm_text(v)
    if not s:
        return None
    code = s.split("-")[0].strip().upper().replace(" ", "")
    return code or None


def norm_money(v):
    n = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(n) else round(float(n), 2)


def split_route(route: str | None):
    """
    'คลังสุวินทวงศ์ - นครปฐม (6 จุด)' -> ('คลังสุวินทวงศ์', 'นครปฐม (6 จุด)')
    แยกที่ ' - ' ตัวแรกเท่านั้น ถ้าไม่มีให้คืน None ทั้งคู่ แต่ยังเก็บ route_raw ไว้เสมอ
    """
    if not route:
        return None, None
    parts = re.split(r"\s+-\s+", route, maxsplit=1)
    if len(parts) != 2:
        return None, None
    o, d = norm_text(parts[0]), norm_text(parts[1])
    return (o, d) if o and d else (None, None)


def det_uuid(kind: str, key: str) -> str:
    return str(uuid.uuid5(NS, f"{kind}:{key}"))


def money_str(v) -> str:
    """
    เขียนตัวเลขให้ตรงกับที่ JavaScript ทำ (String(2000) -> '2000' ไม่ใช่ '2000.0')

    จำเป็นเพราะ hash นี้ถูกคำนวณสองที่: สคริปต์นี้ตอนโหลดชุดแรก และเบราว์เซอร์
    ตอนอัปโหลดรายเดือน ถ้ารูปแบบตัวเลขต่างกัน hash จะไม่ตรง แล้วเที่ยวเดิม
    จะถูกนำเข้าซ้ำเป็นแถวใหม่
    """
    # pandas เปลี่ยน None เป็น NaN เมื่อเก็บในคอลัมน์ตัวเลข ต้องดักทั้งสองแบบ
    if v is None or pd.isna(v):
        return ""
    f = float(v)
    return str(int(f)) if f == int(f) else repr(f)


def natural_key(date, cust, plate, phone, route, revenue, cost) -> str:
    """คีย์ธรรมชาติเจ็ดช่อง — ข้อความเดียวกับที่เอาไปเข้า sha256"""
    return "|".join(
        [
            str(date or ""),
            str(cust or ""),
            str(plate or ""),
            str(phone or ""),
            str(route or ""),
            money_str(revenue),
            money_str(cost),
        ]
    )


def row_hash(date, cust, plate, phone, route, revenue, cost, occurrence: int = 1) -> str:
    """
    ลายนิ้วมือของหนึ่งเที่ยว — ต้องตรงกับ rowHash() ใน apps/web/src/lib/normalize.ts

    occurrence คือลำดับที่ของเที่ยวที่คีย์ธรรมชาติซ้ำกันทุกช่อง จำเป็นเพราะ พขร.
    คนเดียวกันวิ่งเส้นทางเดิม ราคาเดิม หลายเที่ยวในวันเดียวได้จริง ถ้าไม่มีตัวนี้
    เที่ยวที่สองขึ้นไปจะถูกมองว่าซ้ำแล้วถูกทิ้ง จำนวนเที่ยวจึงต่ำกว่าความจริง

    occurrence = 1 ให้ค่าเท่าสูตรเดิมทุกประการ ข้อมูลที่โหลดไปแล้วจึงยังตรงเหมือนเดิม
    """
    raw = natural_key(date, cust, plate, phone, route, revenue, cost)
    if occurrence > 1:
        raw += f"|#{occurrence}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ identity
def resolve_driver_identity(df: pd.DataFrame) -> dict[tuple[str, str], str]:
    """
    ตัดสินว่าแถวไหนคือคนเดียวกัน

    เบอร์โทรอย่างเดียวไม่พอ — ในไฟล์จริงมี 80 เบอร์ที่ผูกกับหลายชื่อ บางอันเป็น
    การสะกดผิด (พีระพัฒน์ หุ่นลำพู / พีรพัฒน์ หุ่นลำภู) บางอันเป็นคนละคนจริง ๆ
    ที่ใช้เบอร์กลางของผู้รับเหมา (สกุลชัย / สมบัติ / สุริยา บนเบอร์เดียว)

    วิธี: จัดกลุ่มภายในแต่ละเบอร์ด้วยความคล้ายของชื่อ ชื่อที่คล้ายกันพอ = คนเดียวกัน
    ใช้สะกดที่พบบ่อยที่สุดเป็นชื่อหลัก ที่เหลือเก็บเป็น alias
    """
    mapping: dict[tuple[str, str], str] = {}   # (phone, raw_name) -> canonical_name
    for phone, grp in df.groupby("_phone"):
        counts = Counter(grp["_name"].dropna())
        # เรียงตามความถี่ ชื่อที่ใช้บ่อยที่สุดได้เป็นตัวแทนกลุ่ม
        ordered = [n for n, _ in counts.most_common()]
        clusters: list[list[str]] = []
        for name in ordered:
            bare = re.sub(r"\(.*?\)", "", name).strip()
            placed = False
            for cl in clusters:
                head_bare = re.sub(r"\(.*?\)", "", cl[0]).strip()
                if difflib.SequenceMatcher(None, bare, head_bare).ratio() >= NAME_MERGE_RATIO:
                    cl.append(name)
                    placed = True
                    break
            if not placed:
                clusters.append([name])
        for cl in clusters:
            canonical = cl[0]
            for name in cl:
                mapping[(phone, name)] = canonical
    return mapping


# ---------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("excel", nargs="?", default="ALLMANUAL_cleaned.xlsx")
    ap.add_argument(
        "--sheet",
        default="auto",
        help="ชื่อชีต หรือ auto เพื่อสแกนทุกชีตแล้วใช้ชีตที่อ่านได้ทั้งหมด",
    )
    ap.add_argument("--out", default="data/out")
    args = ap.parse_args()

    src = Path(args.excel)
    if not src.exists():
        print(f"ไม่พบไฟล์: {src}", file=sys.stderr)
        return 1

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    print(f"อ่าน {src} ...")
    book = pd.ExcelFile(src)
    wanted = book.sheet_names if args.sheet == "auto" else [args.sheet]

    frames = []
    total_rows = 0
    skipped_sheets = []

    for name in wanted:
        # อ่านแบบไม่มีหัวตาราง เพราะหัวตารางอาจไม่ได้อยู่แถวแรก
        aoa = book.parse(name, header=None).values.tolist()
        found = find_header_row(aoa)
        if found is None:
            skipped_sheets.append((name, "ไม่พบคอลัมน์ วันที่ / ชื่อพขร / เบอร์โทรพขร."))
            continue

        header_row, cols = found
        body = aoa[header_row + 1 :]
        total_rows += len(body)

        def take(field, cast):
            idx = cols.get(field)
            if idx is None:
                return [None] * len(body)
            return [cast(r[idx] if idx < len(r) else None) for r in body]

        sub = pd.DataFrame(
            {
                "_sheet": name,
                "_rowno": [header_row + 2 + i for i in range(len(body))],
                "_segment": take("segment", norm_text),
                "_date": [
                    (lambda d: None if pd.isna(d) else d.date())(
                        pd.to_datetime(v, errors="coerce")
                    )
                    for v in take("date", lambda x: x)
                ],
                "_seq": [
                    None if v is None else re.sub(r"\.0$", "", v)
                    for v in take("seq", norm_text)
                ],
                "_customer": take("customer", norm_code),
                "_vtype": take("vehicle_type", norm_text),
                "_plate": take("plate", norm_plate),
                "_name": take("driver_name", norm_text),
                "_phone": take("driver_phone", norm_phone),
                "_route": take("route", norm_text),
                "_acct_name": take("account_name", norm_text),
                "_acct_no": take(
                    "account_no",
                    lambda v: norm_text(str(v).split(".")[0] if v is not None and not (
                        isinstance(v, float) and pd.isna(v)
                    ) else None),
                ),
                "_bank": take("bank", norm_bank),
                "_note": take("note", norm_text),
                "_disp_name": take("dispatcher_name", norm_text),
                "_disp_phone": take("dispatcher_phone", norm_phone),
                "_revenue": take("revenue", norm_money),
                "_cost": take("cost", norm_money),
                "_margin": take("margin", norm_money),
                "_margin_pct": take("margin_pct", norm_money),
                "_withholding": take("withholding", norm_money),
            }
        )
        usable = sub["_date"].notna() & sub["_name"].notna() & sub["_phone"].notna()
        print(
            f"  ชีต {name!r}: หัวตารางแถว {header_row + 1} · "
            f"{len(sub):,} แถว · ใช้ได้ {int(usable.sum()):,}"
        )
        if usable.sum() == 0:
            skipped_sheets.append((name, "ไม่มีแถวที่มีครบทั้งวันที่ ชื่อ และเบอร์โทร"))
            continue
        frames.append(sub)

    for name, why in skipped_sheets:
        print(f"  ข้ามชีต {name!r}: {why}")

    if not frames:
        print("ไม่มีชีตไหนที่นำเข้าได้", file=sys.stderr)
        return 1

    df = pd.concat(frames, ignore_index=True)

    # pandas เปลี่ยน None เป็น NaN ทันทีที่คอลัมน์มีทั้งข้อความและค่าว่างปนกัน
    # ซึ่งพังทุกที่ที่โค้ดเช็ค `is None` หรือเรียง set (NaN เทียบกับ str ไม่ได้)
    # จึงดันกลับเป็น None ให้หมดตรงนี้ที่เดียว
    df = df.astype(object).where(pd.notna(df), None)

    # แถวที่ขาดสิ่งจำเป็นจนสร้างประวัติงานไม่ได้
    bad = df[df["_date"].isna() | df["_name"].isna() | df["_phone"].isna()]
    df = df.drop(bad.index).reset_index(drop=True)
    print(f"  ใช้ได้ {len(df):,} แถว / ข้าม {len(bad):,} แถว (ขาดวันที่ ชื่อ หรือเบอร์)")

    # ---------------------------------------------------------- identity
    print("จับคู่ตัวตน พขร. ...")
    ident = resolve_driver_identity(df)
    df["_canon_name"] = [
        ident.get((p, n), n) for p, n in zip(df["_phone"], df["_name"])
    ]
    df["_driver_id"] = [
        det_uuid("driver", f"{p}|{n}") for p, n in zip(df["_phone"], df["_canon_name"])
    ]

    n_pairs = df.groupby(["_phone", "_name"]).ngroups
    n_drivers = df["_driver_id"].nunique()
    print(f"  คู่ (เบอร์, ชื่อ) ดิบ {n_pairs:,} -> รวมเป็น พขร. {n_drivers:,} คน")

    # ---------------------------------------------------------- lookups
    customers = sorted({c for c in df["_customer"] if c})
    customers_df = pd.DataFrame(
        {"id": [det_uuid("customer", c) for c in customers], "code": customers, "name": customers}
    )

    vtypes = sorted({v for v in df["_vtype"] if v})
    vtypes_df = pd.DataFrame(
        {"id": [det_uuid("vtype", v) for v in vtypes], "code": vtypes, "name": vtypes}
    )

    plates = sorted({p for p in df["_plate"] if p})
    plate_vtype: dict[str, str | None] = {}
    for plate, grp in df[df["_plate"].notna()].groupby("_plate"):
        top = grp["_vtype"].dropna()
        plate_vtype[plate] = top.mode().iloc[0] if len(top) else None
    vehicles_df = pd.DataFrame(
        {
            "id": [det_uuid("vehicle", p) for p in plates],
            "plate": plates,
            "vehicle_type_id": [
                det_uuid("vtype", plate_vtype[p]) if plate_vtype.get(p) else None
                for p in plates
            ],
        }
    )

    # ---------------------------------------------------------- drivers
    first_seen = df.groupby("_driver_id")["_date"].min()
    last_seen = df.groupby("_driver_id")["_date"].max()

    driver_rows = []
    for did, grp in df.groupby("_driver_id"):
        driver_rows.append(
            {
                "id": did,
                "full_name": grp["_canon_name"].iloc[0],
                "phone": grp["_phone"].iloc[0],
                "first_job_date": first_seen[did],
                "last_job_date": last_seen[did],
            }
        )
    drivers_df = pd.DataFrame(driver_rows).sort_values(
        ["first_job_date", "full_name"]
    ).reset_index(drop=True)
    drivers_df["driver_code"] = [
        f"DRV-{i:05d}" for i in range(1, len(drivers_df) + 1)
    ]
    drivers_df["status"] = "active"
    drivers_df["employment"] = "unknown"
    drivers_out = drivers_df[
        ["id", "driver_code", "full_name", "phone", "status",
         "employment", "first_job_date", "last_job_date"]
    ]

    # ชื่อสะกดอื่นที่เคยพบ
    alias_counter: dict[tuple[str, str], int] = defaultdict(int)
    for did, raw, canon in zip(df["_driver_id"], df["_name"], df["_canon_name"]):
        if raw and raw != canon:
            alias_counter[(did, raw)] += 1
    aliases_df = pd.DataFrame(
        [{"driver_id": d, "alias_name": a, "seen_count": c}
         for (d, a), c in alias_counter.items()]
    )
    if aliases_df.empty:
        aliases_df = pd.DataFrame(columns=["driver_id", "alias_name", "seen_count"])

    # ---------------------------------------------------------- PII
    priv_rows = []
    for did, grp in df.groupby("_driver_id"):
        g = grp.sort_values("_date", ascending=False)
        acct = g[g["_acct_no"].notna()]
        if acct.empty:
            continue
        r = acct.iloc[0]
        priv_rows.append(
            {
                "driver_id": did,
                "bank_code": r["_bank"],
                "account_no": r["_acct_no"],
                "account_name": r["_acct_name"],
            }
        )
    private_df = pd.DataFrame(priv_rows) if priv_rows else pd.DataFrame(
        columns=["driver_id", "bank_code", "account_no", "account_name"]
    )

    # ---------------------------------------------------------- jobs
    routes = [split_route(r) for r in df["_route"]]
    df["_origin"] = [o for o, _ in routes]
    df["_destination"] = [d for _, d in routes]
    df["_key"] = [
        natural_key(d, c, p, ph, r, rev, cost)
        for d, c, p, ph, r, rev, cost in zip(
            df["_date"], df["_customer"], df["_plate"], df["_phone"],
            df["_route"], df["_revenue"], df["_cost"],
        )
    ]

    # ---------------------------------------------------------- เที่ยวซ้ำ
    # ตรรกะเดียวกับ cleanSheets() ใน apps/web/src/lib/ingest.ts ทุกขั้น
    #
    # แถวที่คีย์ธรรมชาติเหมือนกันเป๊ะ มีได้สองความหมาย
    #   ก) เที่ยวเดียวกันที่ถูกคัดลอกไปอยู่หลายชีต — ต้องนับครั้งเดียว
    #   ข) คนละเที่ยวจริง ๆ ที่บังเอิญเหมือนกันทุกช่อง — ต้องนับแยก
    # ตัวแยกคือ "ลำดับงาน": ลำดับงานเท่ากัน = แถวเดียวกัน / ต่างกัน = คนละเที่ยว
    #
    # 1. ในแต่ละชีต ยุบแถวที่คีย์ตรงและลำดับงานตรงให้เหลืออันเดียว
    # 2. จำนวนเที่ยวจริงของคีย์หนึ่ง = ค่ามากที่สุดที่ชีตใดชีตหนึ่งนับได้
    # 3. เที่ยวที่ 1 ใช้ hash สูตรเดิม เที่ยวที่ 2 ขึ้นไปต่อท้ายด้วย |#n
    per_sheet: dict[tuple[str, str], list[int]] = defaultdict(list)
    seen_seq: dict[tuple[str, str], set[str]] = defaultdict(set)
    n_collapsed = 0

    for i, (sheet, key, seq) in enumerate(zip(df["_sheet"], df["_key"], df["_seq"])):
        bucket = (sheet, key)
        if seq is not None:
            if seq in seen_seq[bucket]:
                n_collapsed += 1
                continue
            seen_seq[bucket].add(seq)
        per_sheet[bucket].append(i)

    # ชีตที่บันทึกครบที่สุดเป็นตัวตั้ง
    winner: dict[str, list[int]] = {}
    for (_, key), idxs in per_sheet.items():
        if key not in winner or len(idxs) > len(winner[key]):
            winner[key] = idxs

    kept: list[int] = []
    occurrences: list[int] = []
    n_repeat = 0
    for idxs in winner.values():
        # เรียงตามลำดับงานให้ผลคงที่ ไม่ขึ้นกับว่าอ่านชีตไหนก่อน
        def sort_key(i: int):
            seq = df["_seq"].iloc[i]
            try:
                num = float(seq) if seq is not None else float("inf")
            except ValueError:
                num = float("inf")
            return (num, df["_rowno"].iloc[i])

        for n, i in enumerate(sorted(idxs, key=sort_key), start=1):
            kept.append(i)
            occurrences.append(n)
            if n > 1:
                n_repeat += 1

    n_dupes = len(df) - len(kept)
    jobs_src = df.iloc[kept].copy()
    jobs_src["_occurrence"] = occurrences
    jobs_src["_hash"] = [
        row_hash(d, c, p, ph, r, rev, cost, occ)
        for d, c, p, ph, r, rev, cost, occ in zip(
            jobs_src["_date"], jobs_src["_customer"], jobs_src["_plate"],
            jobs_src["_phone"], jobs_src["_route"], jobs_src["_revenue"],
            jobs_src["_cost"], jobs_src["_occurrence"],
        )
    ]
    print(
        f"  ยุบแถวที่บันทึกซ้ำ {n_dupes:,} แถว "
        f"(ในชีตเดียวกัน {n_collapsed:,}) · เที่ยวซ้ำที่แยกด้วยลำดับงาน {n_repeat:,}"
    )

    # ทุกแถวที่เก็บไว้ต้องได้ hash ไม่ซ้ำกัน ไม่งั้นจะทับกันตอน ON CONFLICT
    assert jobs_src["_hash"].is_unique, "row_hash ซ้ำกันหลังคิด occurrence แล้ว"

    # นับเที่ยวจากงานที่ยุบซ้ำแล้วเท่านั้น
    # ถ้านับจาก df ดิบ ไฟล์ที่มีหลายชีตทับกันจะทำให้จำนวนเที่ยวของทุกคนพองขึ้นสองเท่า
    driver_job_counts = jobs_src["_driver_id"].value_counts().to_dict()

    jobs_df = pd.DataFrame(
        {
            "id": [det_uuid("job", h) for h in jobs_src["_hash"]],
            "job_date": jobs_src["_date"],
            "seq_no": jobs_src["_seq"],
            "segment": jobs_src["_segment"].fillna("B2B"),
            "customer_code": jobs_src["_customer"],
            "vehicle_type_code": jobs_src["_vtype"],
            "plate": jobs_src["_plate"],
            "route_raw": jobs_src["_route"],
            "origin": jobs_src["_origin"],
            "destination": jobs_src["_destination"],
            "revenue": jobs_src["_revenue"],
            "cost": jobs_src["_cost"],
            "margin": jobs_src["_margin"],
            "margin_pct": jobs_src["_margin_pct"],
            "withholding_1pct": jobs_src["_withholding"],
            "dispatcher_name": jobs_src["_disp_name"],
            "dispatcher_phone": jobs_src["_disp_phone"],
            "note": jobs_src["_note"],
            "row_hash": jobs_src["_hash"],
        }
    )

    assignments_df = pd.DataFrame(
        {
            "id": [det_uuid("asg", h) for h in jobs_src["_hash"]],
            "job_id": [det_uuid("job", h) for h in jobs_src["_hash"]],
            "driver_id": jobs_src["_driver_id"],
            "role": "primary",
            "outcome": "completed",
        }
    )

    # ---------------------------------------------------------- write
    def w(name: str, frame: pd.DataFrame):
        path = out / f"{name}.csv"
        frame.to_csv(path, index=False, encoding="utf-8-sig", na_rep="")
        print(f"  {path}  ({len(frame):,} แถว)")

    print("เขียนไฟล์ ...")
    w("customers", customers_df)
    w("vehicle_types", vtypes_df)
    w("vehicles", vehicles_df)
    w("drivers", drivers_out)
    w("driver_aliases", aliases_df)
    w("driver_private", private_df)
    w("jobs", jobs_df)
    w("job_assignments", assignments_df)

    # ---------------------------------------------------------- report
    busiest = sorted(driver_job_counts.items(), key=lambda kv: -kv[1])[:10]
    name_by_id = drivers_df.set_index("id")["full_name"].to_dict()
    one_trip = sum(1 for v in driver_job_counts.values() if v == 1)
    ten_plus = sum(1 for v in driver_job_counts.values() if v >= 10)

    report = [
        "รายงานการแปลงข้อมูลเที่ยววิ่ง",
        "=" * 60,
        f"ชีตที่นำเข้า           : {', '.join(sorted(set(df['_sheet'])))}",
        f"แถวในไฟล์ต้นทาง        : {total_rows:,}",
        f"แถวที่ข้าม (ข้อมูลขาด)  : {len(bad):,}",
        f"แถวที่บันทึกซ้ำ (ยุบแล้ว) : {n_dupes:,}",
        f"เที่ยวซ้ำที่แยกด้วยลำดับงาน : {n_repeat:,}",
        f"เที่ยวที่นำเข้าได้จริง   : {len(jobs_df):,}",
        "",
        f"พขร.                   : {len(drivers_out):,} คน",
        f"  วิ่งเที่ยวเดียว       : {one_trip:,} คน ({one_trip / max(len(drivers_out),1):.0%})",
        f"  วิ่ง 10 เที่ยวขึ้นไป  : {ten_plus:,} คน",
        f"  ชื่อสะกดต่าง (alias)  : {len(aliases_df):,} รายการ",
        f"  มีข้อมูลบัญชีธนาคาร   : {len(private_df):,} คน",
        f"ลูกค้า                  : {len(customers_df):,} ราย",
        f"ประเภทรถ               : {len(vtypes_df):,} แบบ",
        f"ทะเบียนรถ              : {len(vehicles_df):,} คัน",
        "",
        f"ช่วงวันที่              : {df['_date'].min()} ถึง {df['_date'].max()}",
        f"เส้นทางที่แยก origin/destination ได้ : "
        f"{jobs_df['origin'].notna().sum():,} / {len(jobs_df):,}",
        "",
        "พขร. ที่วิ่งมากที่สุด 10 อันดับ:",
    ]
    for did, cnt in busiest:
        report.append(f"  {cnt:4d} เที่ยว  {name_by_id.get(did, '?')}")

    text = "\n".join(report)
    (out / "report.txt").write_text(text, encoding="utf-8")
    print()
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
