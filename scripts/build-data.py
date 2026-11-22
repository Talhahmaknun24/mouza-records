#!/usr/bin/env python3
"""Build the Mouza Records site data files.

Modes:
  --sample: one upazila from an rclone lsjson listing (paths relative to
            the upazila folder). Needs --division/--district/--upazila.
  --full:   the whole Drive listing (rclone lsjson -R); hierarchy from Path.
  --index:  the structured index (hidden_files/mouza-index.json) — the
            real dataset. Uses the index's own parsing (mouza, khatian,
            part, JL, subfolders, type_norm, kind, parse_method).

Outputs (the data contract, split per division — a single tree.json
would be ~9 MB at full scale):
    <out>/divisions.json     list of divisions (name, count, tree/search file)
    <out>/tree-<slug>.json   one division: district -> upazila -> type -> mouza list
    <out>/search-<slug>.json mouza name / JL -> path (for instant search)
    <out>/chunks/...         one JSON per (upazila, type, mouza-group): khatian list
    <api-out>                every Drive file ID in the dataset (API allowlist)

Mouza grouping (per upazila + type):
  - mouza name parsed        -> that mouza (JL shown when known)
  - no mouza, JL known       -> "জে.এল. <n>" group (41,253 scan__ files and
                                others with no name land here when a JL exists)
  - no mouza/JL, subfolders  -> "📁 <subfolder chain>" group
  - nothing at all           -> "নাম ছাড়া খতিয়ান" group
Nothing in the grouping ever breaks the site when a mouza cannot be parsed.
Spelling variants are kept as-is, never merged.
"""
import argparse
import hashlib
import json
import os
import re
import sys

# Tokens in a filename that are NOT a mouza name (lsjson modes only).
STOPWORDS = {
    "RS", "CS", "SA", "BS", "BRS", "ROR", "PETI", "SADA", "OK",
    "RESULT", "RESULTS", "SCAN", "COPY", "PAGE", "MAP", "MOUZA",
    "PDF", "JPG", "JPEG", "PNG", "DOWN", "UP",
}

# Uploader notice files ("এটা দেখুন" / "গুরুত্বপূর্ণ") are instructions, not
# records — they never enter the khatian tree.
NOTICE_MARKERS = ("এটা দেখুন", "গুরুত্বপূর্ণ", "গুরুত্বপূর্ন")

# Display labels for type folders. Unknown codes fall back to the raw code.
TYPE_LABELS = {
    "CS": "সি এস (CS)",
    "RS": "আর এস (RS)",
    "SA": "এস এ (SA)",
    "BS": "বি এস (BS)",
    "BS_RS": "বি এস / আর এস (BS_RS)",
    "RS_BS": "আর এস / বি এস (RS_BS)",
    "CS_SA": "সি এস / এস এ (CS_SA)",
    "SA_RS": "এস এ / আর এস (SA_RS)",
    "SA_CS": "এস এ / সি এস (SA_CS)",
    "RS_SA": "আর এস / এস এ (RS_SA)",
    "RS_CS": "আর এস / সি এস (RS_CS)",
    "BRS": "বি আর এস (BRS)",
    "CITY": "সিটি (CITY)",
    "DIYARA": "দিয়ারা (DIYARA)",
    "ROR": "আর ও আর (ROR)",
    "JPG": "ছবি (JPG)",
    "পেটি": "পেটি",
    "থানা ম্যাপ": "থানা ম্যাপ",
    "অন্যান্য": "অন্যান্য",
}


def slugify(text):
    """URL-safe slug for a path segment. Latin names stay readable;
    known Bangla place names use a fixed romanization; anything else
    falls back to a short hash so paths stay ASCII (and stable)."""
    s = re.sub(r"[^A-Za-z0-9]+", "-", text.strip().lower()).strip("-")
    if s:
        return s
    t = text.strip()
    if t.endswith(" বিভাগ"):
        t = t[:-len(" বিভাগ")].strip()
    return SLUG_MAP.get(t,
                        "m-" + hashlib.md5(text.encode("utf-8")).hexdigest()[:8])


# Fixed romanization for the division names (and the sample's places).
SLUG_MAP = {
    "ঢাকা": "dhaka", "চট্টগ্রাম": "chattogram", "খুলনা": "khulna",
    "রাজশাহী": "rajshahi", "বরিশাল": "barishal", "সিলেট": "sylhet",
    "রংপুর": "rangpur", "ময়মনসিংহ": "mymensingh",
    "ইশ্বরগঞ্জ": "ishwarganj", "ঈশ্বরগঞ্জ": "ishwarganj",
}


def clean_division(raw):
    # Drive folders are named like "ঢাকা বিভাগ." — trailing dots are an
    # artifact of the folder name, not part of the division's name.
    return raw.rstrip(".").strip()


def type_label(code):
    return TYPE_LABELS.get(code, code)


# ---------------------------------------------------------------- lsjson modes
def parse_filename(name):
    """(khatian_display, mouza_or_None) pairs for one file (lsjson modes)."""
    stem = os.path.splitext(name)[0]
    results = []
    for segment in stem.split(","):
        segment = segment.strip()
        if not segment:
            continue
        tokens = [t for t in re.split(r"[-_\s]+", segment) if t]
        if not tokens:
            continue
        nums = []
        i = 0
        while i < len(tokens) and tokens[i].isdigit():
            nums.append(tokens[i])
            i += 1
        if not nums:
            results.append((segment, None))
            continue
        khatian = "-".join(nums)
        mouza = None
        for tok in tokens[i:]:
            if tok.upper() in STOPWORDS or tok.isdigit():
                continue
            mouza = tok
            break
        results.append((khatian, mouza))
    return results or [(stem, None)]


def kind_of_lsjson(name, path):
    low = (name + " " + path).lower()
    if "map" in low or "ম্যাপ" in low:
        return "map"
    return "pdf" if os.path.splitext(name)[1].lower() == ".pdf" else "jpg"


def lsjson_records(entries, fixed):
    """Yield normalized records from lsjson entries.
    Record: (div, dist, upazila, type, group_key, group_label, jl, file_entry)
    group_key: ("m", mouza) | ("n", None)."""
    for e in entries:
        if e.get("IsDir"):
            continue
        path = e["Path"]
        name = e["Name"]
        if any(m in name for m in NOTICE_MARKERS):
            yield ("skip", None)
            continue
        parts = path.split("/")
        if fixed is not None:
            div, dist, upazila = fixed
            type_code = parts[0]
            sub = "/".join(parts[1:-1]) if len(parts) > 2 else None
        elif len(parts) == 2:
            yield ("skip", None)
            continue
        elif len(parts) == 3:
            div = clean_division(parts[0])
            dist, upazila = parts[1], "জেলার ফাইল"
            type_code = "ম্যাপ" if kind_of_lsjson(name, path) == "map" else "অন্যান্য"
            sub = None
        elif len(parts) == 4:
            div = clean_division(parts[0])
            dist, upazila = parts[1], parts[2]
            type_code = "ম্যাপ" if kind_of_lsjson(name, path) == "map" else "অন্যান্য"
            sub = None
        else:
            div = clean_division(parts[0])
            dist, upazila, type_code = parts[1], parts[2], parts[3]
            sub = "/".join(parts[4:-1]) if len(parts) > 5 else None
        kind = kind_of_lsjson(name, path)
        for khatian, mouza in parse_filename(name):
            f = {"n": khatian, "name": name, "kind": kind,
                 "size": e.get("Size", 0), "id": e["ID"]}
            if sub:
                f["sub"] = sub
            key = ("m", mouza) if mouza else ("n", None)
            label = mouza if mouza else "নাম ছাড়া খতিয়ান"
            yield ("rec", (div, dist, upazila, type_code, key, label, None, f))


# ---------------------------------------------------------------- index mode
SCAN_RE = re.compile(r"^scan__(\d{4}-\d{2}-\d{2})")


def index_records(idx):
    """Yield normalized records from mouza-index.json.
    group_key: ("m", mouza) | ("j", jl) | ("s", subchain) | ("n", None)."""
    for r in idx["files"]:
        if r.get("upazila") is None:
            yield ("skip", "unmatched-notice")
            continue
        if r.get("kind") == "অন্যান্য":
            yield ("skip", "other-kind")
            continue
        div = clean_division(r["division"])
        dist, upazila = r["district"], r["upazila"]
        type_code = r.get("type_norm") or "অন্যান্য"
        # subfolders[] is the chain between upazila and file — its first
        # segment is usually the type folder itself (95% of files), which
        # the UI already shows as the ধরণ. Strip it so the breadcrumb
        # only shows the folders *below* the type folder.
        subfolders = r.get("subfolders") or []
        if subfolders and r.get("type_raw") and subfolders[0] == r["type_raw"]:
            subfolders = subfolders[1:]
        sub = " / ".join(subfolders) if subfolders else None
        khatian = r.get("khatian_number")
        part = r.get("part_number")
        display = None
        if khatian is not None:
            display = str(khatian) + ("-" + str(part) if part else "")
        scan = None
        if r.get("parse_method") == "scan_timestamp":
            m = SCAN_RE.match(r["name"] or "")
            scan = m.group(1) if m else None
        if r.get("kind") == "থানা ম্যাপ PDF" or r.get("is_map"):
            kind = "map"
        elif (r.get("ext") or "").lower() == "pdf":
            kind = "pdf"
        else:
            kind = "jpg"
        f = {"n": display, "name": r["name"], "kind": kind,
             "size": r.get("size", 0), "id": r["drive_id"]}
        if sub:
            f["sub"] = sub
        if scan:
            f["scan"] = scan
        mouza = r.get("mouza")
        jl = r.get("jl_number")
        if mouza:
            key, label = ("m", mouza), mouza
        elif jl:
            key, label = ("j", str(jl)), "জে.এল. " + str(jl)
        elif sub:
            key, label = ("s", sub), "📁 " + sub
        else:
            key, label = ("n", None), "নাম ছাড়া খতিয়ান"
        yield ("rec", (div, dist, upazila, type_code, key, label, jl, f))


# ---------------------------------------------------------------- emit
def sort_key(f):
    n = f.get("n") or ""
    m = re.match(r"(\d+)", n)
    return (0 if m else 1, int(m.group(1)) if m else 0, n)


def emit(records, out, api_out, sample):
    """records: iterable of ("rec", rec) / ("skip", reason). Writes all outputs."""
    tree = {}
    allowed = set()
    total_files = 0
    skipped = {}

    for tag, payload in records:
        if tag == "skip":
            skipped[payload or "skip"] = skipped.get(payload or "skip", 0) + 1
            continue
        div, dist, upazila, type_code, key, label, jl, f = payload
        total_files += 1
        allowed.add(f["id"])
        node = tree.setdefault(div, {}).setdefault(dist, {}).setdefault(
            upazila, {}).setdefault(type_code, {})
        g = node.setdefault(key, {"label": label, "jl": jl, "files": []})
        g["files"].append(f)
        if jl and not g["jl"]:
            g["jl"] = jl

    divisions_index = {"sample": sample, "totalFiles": total_files,
                       "skipped": skipped, "divisions": []}
    tree_files, search_files, chunks = {}, {}, {}

    for div in sorted(tree):
        div_node = {"name": div, "count": 0, "districts": []}
        div_search = []
        for dist in sorted(tree[div]):
            dist_node = {"name": dist, "count": 0, "upazilas": []}
            for upazila in sorted(tree[div][dist]):
                up_node = {"name": upazila, "count": 0, "types": []}
                for code in sorted(tree[div][dist][upazila]):
                    groups = tree[div][dist][upazila][code]
                    type_node = {"code": code, "label": type_label(code),
                                 "count": 0, "mouzas": []}
                    base = "/".join([slugify(div), slugify(dist),
                                     slugify(upazila),
                                     code.replace(" ", "-")])
                    ordered = sorted(
                        groups.items(),
                        key=lambda kv: ({"m": 0, "j": 1, "s": 2, "n": 3}[kv[0][0]],
                                        str(kv[0][1] or "").lower()))
                    for key, g in ordered:
                        files = sorted(g["files"], key=sort_key)
                        seen, deduped = set(), []
                        for f in files:
                            k = (f["id"], f.get("n"))
                            if k in seen:
                                continue
                            seen.add(k)
                            deduped.append(f)
                        kind, kval = key
                        if kind == "m":
                            slug = slugify(kval)
                        elif kind == "j":
                            slug = "jl-" + re.sub(r"\D", "", kval)
                        elif kind == "s":
                            slug = "sub-" + hashlib.md5(
                                kval.encode("utf-8")).hexdigest()[:8]
                        else:
                            slug = "__unnamed__"
                        chunk_rel = f"chunks/{base}/{slug}.json"
                        if chunk_rel in chunks:
                            # Two different groups slugified to the same
                            # path (e.g. names differing only by case or
                            # punctuation) — keep both, disambiguate.
                            suffix = hashlib.md5(
                                "|".join([div, dist, upazila, code,
                                          key[0], str(key[1])]).encode(
                                              "utf-8")).hexdigest()[:6]
                            chunk_rel = f"chunks/{base}/{slug}-{suffix}.json"
                        group = {"m": "mouza", "j": "jl",
                                 "s": "subfolder", "n": "unnamed"}[kind]
                        chunks[chunk_rel] = {
                            "division": div, "district": dist,
                            "upazila": upazila, "type": code,
                            "mouza": kval if kind == "m" else None,
                            "label": g["label"], "jl": g["jl"],
                            "group": group, "files": deduped,
                        }
                        mouza_name = kval if kind == "m" else None
                        type_node["mouzas"].append({
                            "name": mouza_name, "label": g["label"],
                            "jl": g["jl"], "group": group,
                            "count": len(deduped), "chunk": chunk_rel,
                        })
                        type_node["count"] += len(deduped)
                        if kind in ("m", "j", "s"):
                            div_search.append({
                                "name": g["label"], "jl": g["jl"],
                                "path": [div, dist, upazila, code, mouza_name],
                                "chunk": chunk_rel,
                            })
                    up_node["types"].append(type_node)
                    up_node["count"] += type_node["count"]
                dist_node["upazilas"].append(up_node)
                dist_node["count"] += up_node["count"]
            div_node["districts"].append(dist_node)
            div_node["count"] += dist_node["count"]
        div_search.sort(key=lambda s: (s["name"] or "").lower())
        div_slug = slugify(div)
        tree_files[f"tree-{div_slug}.json"] = div_node
        search_files[f"search-{div_slug}.json"] = div_search
        divisions_index["divisions"].append({
            "name": div, "slug": div_slug, "count": div_node["count"],
            "tree": f"tree-{div_slug}.json",
            "search": f"search-{div_slug}.json",
        })

    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "divisions.json"), "w", encoding="utf-8") as f:
        json.dump(divisions_index, f, ensure_ascii=False, indent=1)
    for name, node in tree_files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump(node, f, ensure_ascii=False, indent=1)
    for name, entries_out in search_files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump(entries_out, f, ensure_ascii=False, indent=1)
    for rel, chunk in chunks.items():
        p = os.path.join(out, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(chunk, f, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.dirname(os.path.abspath(api_out)), exist_ok=True)
    with open(api_out, "w", encoding="utf-8") as f:
        json.dump(sorted(allowed), f, ensure_ascii=False)

    n_search = sum(len(v) for v in search_files.values())
    print(f"files={total_files} skipped={skipped} "
          f"divisions={len(divisions_index['divisions'])} chunks={len(chunks)} "
          f"search_entries={n_search} allowed_ids={len(allowed)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", help="lsjson file or mouza-index.json")
    ap.add_argument("--sample", action="store_true",
                    help="sample mode: paths relative to one upazila")
    ap.add_argument("--full", action="store_true",
                    help="full lsjson mode: hierarchy from Path")
    ap.add_argument("--index", action="store_true",
                    help="structured mouza-index.json mode (real dataset)")
    ap.add_argument("--division", default="")
    ap.add_argument("--district", default="")
    ap.add_argument("--upazila", default="")
    ap.add_argument("--out", required=True, help="data dir to write")
    ap.add_argument("--api-out", required=True,
                    help="where to write allowed-ids.json")
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        data = json.load(f)
    if args.index:
        records = index_records(data)
        emit(records, args.out, args.api_out, sample=False)
    else:
        fixed = None
        if args.sample:
            if not (args.division and args.district and args.upazila):
                ap.error("--sample needs --division, --district and --upazila")
            fixed = (args.division, args.district, args.upazila)
        records = lsjson_records(data, fixed)
        emit(records, args.out, args.api_out, sample=bool(fixed))


if __name__ == "__main__":
    main()
