#!/usr/bin/env python3
"""Chunk manifest builder — Drive-এ আপলোড করা chunk-এর path -> file ID তালিকা।

ব্যবহার (chunk আপলোড শেষ হওয়ার পর):
    ~/workspace/tools/rclone-binary lsjson -R --files-only dst:mouza-site-chunks \
        > /tmp/chunks-lsjson.json
    python3 scripts/build-chunk-manifest.py /tmp/chunks-lsjson.json

লেখে: api/chunk-manifest.json — {"chunks/<বিভাগ>/.../<ফাইল>.json": "<Drive file ID>", ...}
(চাবি সাজানো থাকে, যাতে প্রতিবার একই ফাইল বের হয়।)

বিকল্প: আপলোডের সময় rclone-এর বদলে সরাসরি manifest বানানো গেলে সেটাও
একই ফরম্যাটে হতে হবে — api/chunk.js এই ফরম্যাটই পড়ে।
"""
import json
import sys

def main():
    if len(sys.argv) < 2:
        print("usage: build-chunk-manifest.py <rclone-lsjson-output>", file=sys.stderr)
        return 2
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        entries = json.load(f)
    manifest = {}
    skipped = 0
    for e in entries:
        if e.get("IsDir"):
            continue
        rel = e.get("Path", "")
        fid = e.get("ID", "")
        if not rel.endswith(".json") or not fid:
            skipped += 1
            continue
        manifest["chunks/" + rel.replace("\\", "/")] = fid
    out_path = "api/chunk-manifest.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        f.write("\n")
    import os
    print(f"wrote {out_path}: {len(manifest)} chunks, "
          f"{os.path.getsize(out_path)} bytes (skipped {skipped})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
