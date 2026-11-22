/**
 * GET /api/download?file=<driveFileId>
 *
 * ফাইল প্রাইভেট Drive-এই থাকে। এই ফাংশন:
 *  1. file ID যাচাই করে — শুধু আমাদের ডাটাসেটের ফাইলই চলবে
 *     (api/allowed-ids.json — build-data.py তৈরি করে; রেপোতে কমিট করা হয়,
 *     কিন্তু Vercel-এ api/ ফোল্ডারের ফাইল স্ট্যাটিকভাবে সার্ভ হয় না)।
 *  2. env var-এ রাখা refresh token দিয়ে Google থেকে নতুন access token নেয়।
 *  3. Drive media URL-এ 302 redirect করে — access token ~১ ঘণ্টা বৈধ,
 *     এটাই অস্থায়ী (temp) লিংক। ফাইল Vercel দিয়ে যায় না।
 *
 * Env vars (Vercel Dashboard -> Project -> Settings -> Environment Variables;
 * কখনো রেপো/কোডে নয়):
 *   GOOGLE_CLIENT_ID       Google OAuth client ID
 *   GOOGLE_CLIENT_SECRET   Google OAuth client secret
 *   GOOGLE_REFRESH_TOKEN   Drive-এ পড়ার অনুমতিসহ refresh token
 * মানের উৎস: ~/.config/rclone/rclone.conf-এর [dst] রিমোটের OAuth token
 * (refresh_token) + একই OAuth client-এর client_id/client_secret।
 * বিস্তারিত: README.md-এর "Vercel সেটআপ" অংশ দেখুন।
 */
const fs = require("fs");
const path = require("path");

let allowed = null;
function loadAllowed() {
  if (allowed) return allowed;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "allowed-ids.json"), "utf8");
    allowed = new Set(JSON.parse(raw));
  } catch (e) {
    allowed = new Set();
  }
  return allowed;
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  const id = req.query && req.query.file;
  if (!id || typeof id !== "string") {
    return json(res, 400, { error: "ফাইলের ID দেওয়া হয়নি।" });
  }
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    return json(res, 400, { error: "ফাইলের ID সঠিক নয়।" });
  }
  if (!loadAllowed().has(id)) {
    return json(res, 404, { error: "এই ফাইলটি তালিকায় নেই।" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return json(res, 503, { error: "ডাউনলোড সার্ভার এখনো কনফিগার হয়নি।" });
  }

  // Refresh token -> access token (১ ঘণ্টা বৈধ)।
  let tokenRes;
  try {
    tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (e) {
    return json(res, 502, { error: "ডাউনলোড সার্ভার Google-এর সাথে যোগাযোগ করতে পারেনি।" });
  }
  if (!tokenRes.ok) {
    return json(res, 502, { error: "ডাউনলোড সার্ভার লগইন করতে পারেনি।" });
  }
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return json(res, 502, { error: "ডাউনলোড সার্ভার লগইন করতে পারেনি।" });
  }

  const mediaUrl =
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(id) +
    "?alt=media&access_token=" +
    encodeURIComponent(tokenData.access_token);
  res.writeHead(302, { Location: mediaUrl });
  res.end();
};
