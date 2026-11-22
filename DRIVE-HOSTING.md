# Mouza chunk হোস্টিং — Google Drive (R2 বাদ)

> **সিদ্ধান্ত (২০২৬-১১-২২):** chunk (`data/chunks/` — ৫৮,৮৯৪টি ফাইল, আসল
> কন্টেন্ট ~৩৯ MB) Google Drive-এই থাকবে, R2 নয়। Cloudflare R2 চালু করতে
> কার্ড (payment method) লাগে, আর মালিকের কোনো ব্যাংক অ্যাকাউন্ট/কার্ড
> নেই — তাই R2 বাদ। Drive-এ ডেটা আগে থেকেই আছে (dst অ্যাকাউন্টে ১.৯ TB
> কপি), নতুন কোনো খরচ বা অ্যাকাউন্ট লাগে না।

## প্রবাহ

```
ব্রাউজার → GET /api/chunk?path=chunks/ঢাকা/.../CS/168.json
  → api/chunk.js: path যাচাই → api/chunk-manifest.json-এ Drive file ID খোঁজে
  → env var-এর refresh token দিয়ে Google থেকে access token নেয়
    (download.js-এর মতোই; একই ৩টি env var — নতুন credential লাগে না)
  → Drive media API থেকে chunk JSON এনে সরাসরি ফেরত দেয়
    (Content-Type: application/json; CDN-এ ২৪ ঘণ্টা cache, immutable)
```

- **ফাইল প্রাইভেটই থাকে** — Drive-এ কোনো পাবলিক লিংক নয়; access token
  সার্ভারেই থাকে, ব্রাউজারে যায় না।
- **Vercel সীমা:** সবচেয়ে বড় chunk ~১৯৩ KB — Vercel-এর ৪.৫ MB
  রেসপন্স সীমার অনেক নিচে; Drive fetch সাধারণত ১ সেকেন্ডের কম।
  CDN cache-এর জন্য একই chunk বারবার Drive থেকে আনা লাগে না।
- **ফ্রন্টএন্ড বদল একটাই:** `app.js`-এর `loadChunk()` এখন
  `data/<path>`-এর বদলে `/api/chunk?path=<path>` ডাকে।
  `tree-*.json` + `search-*.json` আগের মতোই `data/` থেকে (রেপোতেই আছে)।

## Drive-এ যা আছে

- ফোল্ডার: dst অ্যাকাউন্টের root-এ **`mouza-site-chunks/`**
  (root folder ID `1P-pNk5AYT6TLzhjJE6SNr7i5l3ouPquq` — All MOUZA কপির
  একই root)। ভেতরের গাছ `data/chunks/`-এর হুবহু কপি।
- `api/chunk-manifest.json` — chunk path → Drive file ID (রেপোতে কমিট
  করা হয়; এতে কোনো গোপন মান নেই, শুধু path আর ID)।

## আপলোড ও manifest (ইনডেক্স বদলালে আবার করতে হবে)

```bash
# 1. chunk আপলোড (rclone — ~/workspace/tools/rclone-binary; conf ~/.config/rclone/rclone.conf)
~/workspace/tools/rclone-binary copy ~/workspace/mouza-records/data/chunks \
  dst:mouza-site-chunks \
  --transfers 16 --checkers 16 \
  --drive-pacer-min-sleep 100ms --tpslimit 16 \
  --retries 3 --stats 30s --log-file /tmp/mouza-chunk-upload.log
# ফ্ল্যাগ নোট: transfers 16 = মালিকের সর্বোচ্চ সীমা; pacer 100ms = gentle;
# tpslimit 16 (সাধারণ ৮ নয় — ৫৮,৮৯৪ ছোট ফাইলে ৮/s হলে ~২ ঘণ্টা লাগত;
# Drive কোটা ২০,০০০/১০০s, তাই ১৬/s তার ০.০৮% — ৬৪/১ms বিপর্যয়ের ধারেকাছেও নয়)।

# 2. manifest বানানো
~/workspace/tools/rclone-binary lsjson -R --files-only dst:mouza-site-chunks \
  > /tmp/chunks-lsjson.json
python3 scripts/build-chunk-manifest.py /tmp/chunks-lsjson.json
# → api/chunk-manifest.json (কমিট করুন)
```

## Env var (Vercel — download.js-এর ৩টিই, নতুন কিছু নয়)

| নাম | মানের উৎস |
|---|---|
| `GOOGLE_CLIENT_ID` | `~/.config/rclone/rclone.conf`-এর [dst] রিমোটের OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | একই OAuth client-এর secret |
| `GOOGLE_REFRESH_TOKEN` | একই conf-এর [dst] রিমোটের `token` JSON-এর `refresh_token` |

⚠️ **কখনো এই মানগুলো রেপো/কোডে/চ্যাটে লিখবেন না।** শুধু Vercel Dashboard-এ।
[rclone-এর নিজের (built-in) client নয় — [dst]-তে নিজের client_id/secret
আছে (২০২৬-১১-২২ যাচাই করা), তাই README-এর পুরনো "খোলা প্রশ্ন" এখন
মীমাংসিত।]

## যাচাই

```bash
node scripts/test-api.js     # ডাউনলোড API — ৫/৫ (চুক্তি অপরিবর্তিত)
node scripts/test-chunk.js   # chunk API — ৯/৯ (mock Drive fetch দিয়ে)
```

## অবস্থা — সম্পূর্ণ ✅ (২০২৬-১১-২২ ~২৩:৫২)

- **আপলোড সম্পূর্ণ + hash-যাচাইকৃত:** `dst:mouza-site-chunks`-এ **৫৮,৮৯৪/৫৮,৮৯৪
  ফাইল, ৩৯,২৪৯,১৯৮ B** — লোকালের সাথে হুবহু মিল; `rclone check`:
  **০টি পার্থক্য, ৫৮,৮৯৪টি মিলে যাওয়া ফাইল** (exit 0)।
- **manifest তৈরি + কমিট-প্রস্তুত:** `api/chunk-manifest.json` — **৫৮,৮৯৪ এন্ট্রি,
  ৫,৫৮৫,২২৫ B**; manifest-এর সব key লোকাল chunk-এর সাথে হুবহু মেলে।
- **লাইভ যাচাই (আসল manifest + আসল token): ALL PASS** — ৩ আকারের chunk
  (hash/hash, slug জেলা, slug উপজেলা) Drive থেকে এসে লোকাল ফাইলের সাথে
  byte-হুবহু মিলেছে (২০০ + ২৪ ঘণ্টা immutable cache); manifest-এ নেই এমন
  path-এ ৪০৪। ডাউনলোড API ৫/৫, chunk API ৯/৯।
- **দুটো আসল বাগ ধরা + সারা (এই কাজেই):** (১) validator শুধু m-হ্যাশ
  জেলা/উপজেলা মানত — আসল ডাটায় ~১৪,০০০ chunk-এর জেলা/উপজেলা ASCII
  slug (যেমন barishal, faridpur-sadar); ঠিক করা হয়েছে, দুই আকারই বৈধ।
  (২) test-chunk.js আসল manifest মুছে ফেলত — এখন পরীক্ষা শেষে আসল
  manifest ফিরিয়ে দেয়।

## বাকি ব্লকার

1. **GitHub রেপো অনুমোদন মেয়াদোত্তীর্ণ** — `Talhahmaknun24/mouza-records`
   রেপো বানানো + push + Vercel deploy-এর নতুন অনুমোদন লাগবে (মালিকের)।
   অনুমোদন ছাড়া ডেপ্লয় হবে না। Vercel-এ ৩টি env var-ও বসাতে হবে
   (উপরের টেবিল দেখুন)।
2. ~~আপলোড + manifest~~ — সম্পূর্ণ ✅ (উপরে দেখুন)।
