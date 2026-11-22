# মৌজা রেকর্ড

বিভাগ → জেলা → উপজেলা/থানা → খতিয়ানের ধরণ (CS/RS/SA/পেটি/BRS) → মৌজা (JL নম্বর)
→ খতিয়ান তালিকা → থানা ম্যাপ (PDF)। ফাইল Google Drive-এ **প্রাইভেট** থাকে;
ডাউনলোড হয় সাইটের সার্ভার দিয়ে **অস্থায়ী লিংক** (temp-link, ~১ ঘণ্টা বৈধ)।

লাইভ সাইট: *(এখনো ডেপ্লয় হয়নি — নিচে "Vercel সেটআপ" দেখুন)*

## ডাটা (আসল ইনডেক্স থেকে)

মোট **১,৮৭,৩৬১টি** রেকর্ড ফাইল — ৮ বিভাগ, ৬২ জেলা, ৪৮৮ উপজেলা/থানা,
৪৭,০৭১টি ভিন্ন মৌজা নাম। খতিয়ান PDF ৯৬,৫৮৯টি, খতিয়ান ছবি ৯০,৬২২টি,
থানা ম্যাপ PDF ১৫৭টি। **মৌজা ম্যাপ এই ডাটাসেটে নেই (০টি)** — সাইটে
“থানা ম্যাপ” দেখানো হয়, আর সৎভাবে লেখা আছে যে মৌজা ম্যাপ নেই।

৪১,২৫৩টি ফাইলের নাম শুধু স্ক্যানের তারিখ-সময় (`scan__…`) — এগুলোর
মৌজা/খতিয়ান নম্বর নাম থেকে জানা যায় না। সেগুলো উপজেলা + ধরণ +
জে.এল. নম্বর/ফোল্ডার দিয়ে দেখানো হয় (“জে.এল.”, “📁 ফোল্ডার” বা
“নাম ছাড়া খতিয়ান” গ্রুপে)। ২২৭টি ফাইল সাইটে নেই — ১৯টি আপলোডারের
নির্দেশনা-ফাইল (“এটা দেখুন”) ও ২০৮টি অন্যান্য ফাইল (Thumbs.db ইত্যাদি)।
নামের বানান যেমন আছে তেমনই রাখা হয়েছে — একত্রিত করা হয়নি।

## কী আছে

- `index.html` + `styles.css` + `app.js` — স্ট্যাটিক ফ্রন্টএন্ড, কোনো ফ্রেমওয়ার্ক নেই।
  ডিজাইন eporcha.tech-এর মতো: সাদা কার্ড, হালকা ধূসর ব্যাকগ্রাউন্ড, গাঢ় সবুজ
  (#146c43) সিলেক্টেড স্টেট + সাদা ✓, প্রতিটি স্তরে সার্চ, স্ক্রলযোগ্য তালিকা।
  ফন্ট: Hind Siliguri (বডি) + Baloo Da 2 (ডিসপ্লে)। বাংলা-প্রথম UI।
- `api/download.js` — Vercel serverless ফাংশন `GET /api/download?file=<driveFileId>`:
  ID যাচাই করে (শুধু `api/allowed-ids.json`-এ থাকা ফাইল), refresh token দিয়ে
  নতুন access token নেয়, Drive media URL-এ 302 redirect করে। ফাইল Vercel
  দিয়ে যায় না, Drive-এ পাবলিকও করা হয় না।
- `data/` — ডাটা কন্ট্রাক্ট (প্রতি বিভাগে ভাগ করা — একটাই tree.json ~৯ MB হতো):
  `divisions.json` → `tree-<slug>.json` + `search-<slug>.json`
  → `chunks/<বিভাগ>/<জেলা>/<উপজেলা>/<ধরণ>/<মৌজা-গ্রুপ>.json` (খতিয়ান তালিকা)।
- `scripts/build-data.py` — আসল ইনডেক্স (`mouza-index.json`) থেকে উপরের ডাটা বানায়।
- `scripts/test-api.js` — ডাউনলোড API-র যাচাই (কোনো আসল টোকেন ছাড়াই)।

## লোকালি চালানো

```bash
python3 -m http.server 8000
# http://localhost:8000 খুলুন
```

ডাউনলোড API লোকালি পরীক্ষা করতে:

```bash
node scripts/test-api.js   # কোনো টোকেন ছাড়াই যাচাইয়ের ধাপগুলো চেক করে
```

## Vercel সেটআপ (ডেপ্লয়ের জন্য যা বাকি)

1. Vercel-এ নতুন প্রজেক্ট: **Import Git Repository** → `Talhahmaknun24/mouza-records`
   (প্রজেক্ট নামের সাজেশন: `mouza-records` → `mouza-records.vercel.app`)।
   ফ্রেমওয়ার্ক: Other / Static, বিল্ড কমান্ড লাগে না।
2. **Environment Variables** (Settings → Environment Variables) — এই ৩টি সেট করুন:
   | নাম | মানের উৎস |
   |---|---|
   | `GOOGLE_CLIENT_ID` | `~/.config/rclone/rclone.conf`-এর [dst] রিমোটের OAuth client ID (যদি conf-এ না থাকে, নিচের নোট দেখুন) |
   | `GOOGLE_CLIENT_SECRET` | একই OAuth client-এর secret |
   | `GOOGLE_REFRESH_TOKEN` | একই conf-এর [dst] রিমোটের `token` JSON-এর `refresh_token` |

   ⚠️ **কখনো এই মানগুলো রেপো/কোডে/চ্যাটে লিখবেন না।** শুধু Vercel Dashboard-এ।

   [dst] রিমোটে নিজের OAuth client_id/secret আছে (২০২৬-১১-২২ যাচাই করা) —
   rclone-এর built-in client নয়, তাই নতুন OAuth client বানাতে হবে না।
   একই ৩টি env var `api/chunk.js`-ও ব্যবহার করে (নতুন কিছু লাগে না)।
3. **chunk হোস্টিং — Google Drive (সিদ্ধান্ত নেওয়া, R2 বাদ):** `data/chunks/`
   ৫৮,৮৯৪টি ফাইল / আসল কন্টেন্ট ~৩৯ MB — এত ফাইল Git-এ পুশ করা ঠিক নয়,
   তাই রেপোতে নেই (`.gitignore`-এ আছে)। chunk-গুলো Drive-এ আপলোড করা
   হয় (`dst:mouza-site-chunks/`) আর `api/chunk.js` (`GET /api/chunk?path=…`)
   manifest (`api/chunk-manifest.json`, path → Drive file ID) দিয়ে
   সেগুলো সার্ভ করে — ফ্রন্টএন্ডের `loadChunk()` সেখানেই ডাকে।
   বিস্তারিত: **DRIVE-HOSTING.md**। UI কোডে আর বদল লাগে না।
   `tree-*.json` + `search-*.json` (~১৯ MB) রেপোতেই আছে, সেগুলো Vercel
   থেকে সার্ভ হবে। (R2 বাদ দেওয়ার কারণ: Cloudflare R2 চালু করতে কার্ড
   লাগে, মালিকের কার্ড নেই।)
4. Deploy করুন। তারপর ফোনে যাচাই: ক্যাসকেড → খতিয়ান তালিকা → ডাউনলোড বাটন।

## আসল ডাটা আবার বানানো (ইনডেক্স বদলালে)

```bash
python3 scripts/build-data.py --index \
  ~/workspace/goals/mouza-records-site/hidden_files/mouza-index.json \
  --out data --api-out api/allowed-ids.json
# তারপর tree/search কমিট করুন; chunk বদলে থাকলে Drive-এ আবার আপলোড করে
# manifest বানান (DRIVE-HOSTING.md-এর "আপলোড ও manifest" অংশ দেখুন)।
```

## স্কেল নোট — আসল ডাটায় যা জানা গেল (সৎ সীমা)

- chunk ৫৮,৪৭৯টি ফাইল / ~২৫০ MB (compact JSON); `tree-<বিভাগ>.json`
  সবচেয়ে বড়টি (ঢাকা) ৪.৬ MB, `search-<বিভাগ>.json` ৫.১ MB — বিভাগ বেছে
  নিলে একবার লোড হয়; Vercel-এর CDN gzip করে দেয়, তাই ট্রান্সফার অনেক কম।
- `api/allowed-ids.json` ~৬.৭ MB (১,৮৭,৩৬১টি ID) — Vercel ফাংশনের সাথে
  bundle হিসেবে এটা চলবে।
- ৪৯টি same-path ডুপ্লিকেট (একই ফোল্ডারে একই নাম, ভিন্ন Drive ID) তালিকায়
  দুবার দেখাবে — দুটোই আলাদা Drive ফাইল, তাই দুটোই রাখা হয়েছে।

## স্টোরেজ (সৎভাবে)

- ১.৯ TB ফাইল **Google Drive-এই থাকবে (প্রাইভেট)**। GitHub-এ ১.৯ TB যাবে না
  (ফাইলপ্রতি ১০০ MB, রেপোপ্রতি ~৫ GB সীমা)। বিনামূল্যে ১.৯ TB স্টোরেজ
  কোথাও নেই। বিকল্প (Backblaze B2 ~$১১/মাস, Wasabi ~$১৩/মাস, বাহ্যিক
  হার্ডডিস্ক) — মালিকের সিদ্ধান্ত ছাড়া কেনা/বদলানো হবে না।
