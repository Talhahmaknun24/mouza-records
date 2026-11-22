/**
 * GET /api/chunk?path=chunks/<বিভাগ>/<জেলা>/<উপজেলা>/<ধরণ>/<মৌজা-গ্রুপ>.json
 *
 * খতিয়ান তালিকার chunk JSON (data/chunks/ — ৫৮,৮৯৪টি ফাইল, ~৩৯ MB)
 * Git-এ নেই, তাই Google Drive-এ রাখা আছে (প্রাইভেট, "mouza-site-chunks"
 * ফোল্ডার, dst অ্যাকাউন্টে)। এই ফাংশন:
 *  1. path যাচাই করে — শুধু api/chunk-manifest.json-এ থাকা chunk-ই চলবে
 *     (manifest = chunk path -> Drive file ID; scripts/build-chunk-manifest.py
 *     তৈরি করে; build-data.py-র chunk থেকে নয়, Drive-এ আপলোডের পর বানানো)।
 *  2. env var-এ রাখা refresh token দিয়ে Google থেকে নতুন access token নেয়
 *     (download.js-এর মতোই; একই ৩টি env var — নতুন credential লাগে না)।
 *  3. Drive থেকে chunk JSON নিয়ে সরাসরি ফেরত দেয় (Vercel দিয়ে যায় —
 *     chunk ছোট, সবচেয়ে বড়টি ~১৯৩ KB; Vercel-এর ৪.৫ MB সীমার অনেক নিচে)।
 *     CDN-এ ২৪ ঘণ্টা cache হয় (immutable কন্টেন্ট), তাই একই chunk
 *     বারবার Drive থেকে আনা লাগে না।
 *
 * Env vars (Vercel Dashboard -> Project -> Settings -> Environment Variables;
 * কখনো রেপো/কোডে নয় — download.js-এর ৩টিই):
 *   GOOGLE_CLIENT_ID       Google OAuth client ID
 *   GOOGLE_CLIENT_SECRET   Google OAuth client secret
 *   GOOGLE_REFRESH_TOKEN   Drive-এ পড়ার অনুমতিসহ refresh token
 * মানের উৎস: ~/.config/rclone/rclone.conf-এর [dst] রিমোটের OAuth token।
 * বিস্তারিত: DRIVE-HOSTING.md দেখুন।
 */
const fs = require("fs");
const path = require("path");

let manifest = null;
let manifestMissing = false;
function loadManifest() {
  if (manifest || manifestMissing) return manifest;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "chunk-manifest.json"), "utf8");
    manifest = JSON.parse(raw);
  } catch (e) {
    manifestMissing = true;
    manifest = null;
  }
  return manifest;
}

// Access token cache (module scope — একই warm function-এ বারবার লগইন নয়)।
let tokenCache = { accessToken: null, expiresAt: 0 };

async function getAccessToken(clientId, clientSecret, refreshToken) {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenRes.ok) {
    try {
      const errBody = await tokenRes.text();
      console.error("[chunk] token exchange failed:", tokenRes.status, errBody.slice(0, 300));
    } catch (_) {}
    return null;
  }
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return null;
  // expires_in ~৩৬০০ সেকেন্ড; ৬০ সেকেন্ড আগেই মেয়াদোত্তীর্ণ ধরা হয়।
  const ttl = Math.max(60, (tokenData.expires_in || 3600) - 60);
  tokenCache = {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + ttl * 1000,
  };
  return tokenCache.accessToken;
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function isValidChunkPath(p) {
  if (typeof p !== "string") return false;
  if (p.length < 12 || p.length > 220) return false;
  if (!p.startsWith("chunks/")) return false;
  if (!p.endsWith(".json")) return false;
  if (p.includes("..") || p.includes("\\") || p.includes("//")) return false;
  // chunks/<বিভাগ-slug>/<জেলা>/<উপজেলা>/<ধরণ>/<ফাইল>.json (৬ অংশ)।
  // জেলা/উপজেলা হয় m-হ্যাশ (বাংলা নাম হ্যাশ করা) নয়তো ASCII slug
  // (যেমন barishal জেলা, faridpur-sadar উপজেলা) — দুটোই বৈধ।
  const parts = p.split("/");
  if (parts.length !== 6) return false;
  if (!/^[a-z0-9-]{2,40}$/.test(parts[1])) return false;
  const seg = /^(m-[0-9a-f]{8}|[a-z0-9-]{1,40})$/;
  if (!seg.test(parts[2])) return false;
  if (!seg.test(parts[3])) return false;
  if (!parts[4] || parts[4].length > 60) return false; // ধরণ — যেকোনো নাম হতে পারে
  if (!parts[5] || parts[5].length > 120) return false;
  return true;
}

module.exports = async (req, res) => {
  const p = req.query && req.query.path;
  if (!isValidChunkPath(p)) {
    return json(res, 400, { error: "chunk-এর path সঠিক নয়।" });
  }

  const map = loadManifest();
  if (!map) {
    return json(res, 503, { error: "chunk ডাটা এখনো প্রস্তুত নয়।" });
  }
  const fileId = map[p];
  if (!fileId || typeof fileId !== "string") {
    return json(res, 404, { error: "এই chunk তালিকায় নেই।" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return json(res, 503, { error: "chunk সার্ভার এখনো কনফিগার হয়নি।" });
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
  } catch (e) {
    return json(res, 502, { error: "chunk সার্ভার Google-এর সাথে যোগাযোগ করতে পারেনি।" });
  }
  if (!accessToken) {
    return json(res, 502, { error: "chunk সার্ভার লগইন করতে পারেনি।" });
  }

  let driveRes;
  try {
    driveRes = await fetch(
      "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(fileId) +
        "?alt=media",
      { headers: { Authorization: "Bearer " + accessToken } }
    );
  } catch (e) {
    return json(res, 502, { error: "chunk সার্ভার Google Drive থেকে ফাইল আনতে পারেনি।" });
  }
  if (!driveRes.ok) {
    return json(res, 502, { error: "chunk সার্ভার Google Drive থেকে ফাইল আনতে পারেনি।" });
  }

  const body = await driveRes.text();
  // Chunk অপরিবর্তনীয় কন্টেন্ট — Vercel CDN ২৪ ঘণ্টা cache করবে।
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, immutable");
  res.end(body);
};
