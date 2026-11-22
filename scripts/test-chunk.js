/* chunk API যাচাই — কোনো আসল টোকেন ছাড়াই (Drive fetch mock করা হয়)।
   চালান: node scripts/test-chunk.js
   টেস্টটি api/chunk-manifest.json সাময়িকভাবে ছোট test manifest দিয়ে
   বদলে নেয়, পরীক্ষা শেষে আগের আসল manifest (যদি থাকে) ফিরিয়ে দেয় —
   আসল manifest নষ্ট হয় না। আসল manifest আপলোডের পর
   scripts/build-chunk-manifest.py দিয়ে বানাতে হবে। */
const fs = require("fs");
const path = require("path");

const MANIFEST_PATH = path.join(__dirname, "..", "api", "chunk-manifest.json");
// আসল manifest (যদি থাকে) সংরক্ষণ — পরীক্ষা শেষে ফিরিয়ে দেওয়া হবে।
let savedManifest = null;
try { savedManifest = fs.readFileSync(MANIFEST_PATH); } catch (e) { /* ছিল না */ }
function restoreManifest() {
  try {
    if (savedManifest !== null) fs.writeFileSync(MANIFEST_PATH, savedManifest);
    else fs.unlinkSync(MANIFEST_PATH);
  } catch (e) { /* already gone */ }
}
const TEST_MANIFEST = {
  "chunks/khulna/m-37aa1b37/m-4703b99e/CS/168.json": "test-file-id-001",
  "chunks/dhaka/m-b4e743f8/m-1b0cecd4/RS_BS/abdullapur.json": "test-file-id-002",
  // slug আকারের জেলা/উপজেলাও বৈধ (আসল ডাটায় ~১৪,০০০ chunk এই আকারের)।
  "chunks/barishal/barishal/m-176658f6/অন্যান্য/__unnamed__.json": "test-file-id-003",
  "chunks/chattogram/m-b0e7fe06/cs/CS/jl-100.json": "test-file-id-004",
};
const CHUNK_BODY = JSON.stringify({
  division: "খুলনা বিভাগ", files: [{ n: "168-1", name: "x.pdf", kind: "pdf" }],
});

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(TEST_MANIFEST));

const handler = require("../api/chunk.js");

const realFetch = global.fetch;
let lastDriveUrl = null;
let lastDriveAuth = null;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("oauth2.googleapis.com/token")) {
    const body = new URLSearchParams(opts.body);
    if (body.get("client_id") === "mock-ok") {
      return { ok: true, json: async () => ({ access_token: "mock-token", expires_in: 3600 }) };
    }
    return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) };
  }
  if (u.includes("googleapis.com/drive/v3/files/")) {
    lastDriveUrl = u;
    lastDriveAuth = opts && opts.headers && opts.headers.Authorization;
    return { ok: true, text: async () => CHUNK_BODY };
  }
  return realFetch(url, opts);
};

function mockReq(query) {
  return { query };
}
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const k of Object.keys(headers)) this.headers[k.toLowerCase()] = headers[k];
    },
    end(data) { this.body = data || ""; },
  };
  return res;
}

async function check(name, query, env, wantStatus, wantInBody, extra) {
  const saved = {};
  for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env || {});
  const req = mockReq(query);
  const res = mockRes();
  await handler(req, res);
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  let ok = res.statusCode === wantStatus &&
    (wantInBody ? res.body.includes(wantInBody) : true);
  if (extra) ok = ok && extra(res);
  console.log((ok ? "PASS" : "FAIL") + " | " + name +
    " | status=" + res.statusCode +
    (res.body ? " | body=" + res.body.slice(0, 100) : ""));
  return ok;
}

(async () => {
  let all = true;
  const goodPath = "chunks/khulna/m-37aa1b37/m-4703b99e/CS/168.json";
  all = await check("1. path param নেই", {}, null, 400, "সঠিক নয়") && all;
  all = await check("2. ভুল ফরম্যাটের path (../)", { path: "chunks/../secret.json" }, null, 400, "সঠিক নয়") && all;
  all = await check("3. ভুল ফরম্যাটের path (prefix নেই)", { path: "data/chunks/x.json" }, null, 400, "সঠিক নয়") && all;
  all = await check("4. ফরম্যাট ঠিক, manifest-এ নেই",
    { path: "chunks/dhaka/m-00000000/m-00000000/CS/1.json" }, null, 404, "তালিকায় নেই") && all;
  all = await check("5. জানা chunk, env var নেই", { path: goodPath }, null, 503, "কনফিগার হয়নি") && all;
  all = await check("6. জানা chunk + dummy env (Google প্রত্যাখ্যান করবে)",
    { path: goodPath },
    { GOOGLE_CLIENT_ID: "dummy", GOOGLE_CLIENT_SECRET: "dummy", GOOGLE_REFRESH_TOKEN: "dummy" },
    502, "লগইন করতে পারেনি") && all;
  all = await check("7. জানা chunk + mock token (Drive fetch সফল)",
    { path: goodPath },
    { GOOGLE_CLIENT_ID: "mock-ok", GOOGLE_CLIENT_SECRET: "mock-ok", GOOGLE_REFRESH_TOKEN: "mock-ok" },
    200, "খুলনা বিভাগ",
    (res) => res.headers["cache-control"] && res.headers["cache-control"].includes("s-maxage=86400") &&
      lastDriveUrl && lastDriveUrl.includes("test-file-id-001") &&
      lastDriveAuth === "Bearer mock-token") && all;
  all = await check("8. slug জেলার chunk (barishal/barishal/…) + mock token",
    { path: "chunks/barishal/barishal/m-176658f6/অন্যান্য/__unnamed__.json" },
    { GOOGLE_CLIENT_ID: "mock-ok", GOOGLE_CLIENT_SECRET: "mock-ok", GOOGLE_REFRESH_TOKEN: "mock-ok" },
    200, "খুলনা বিভাগ",
    () => lastDriveUrl && lastDriveUrl.includes("test-file-id-003")) && all;
  all = await check("9. slug উপজেলার chunk (…/cs/CS/…) + mock token",
    { path: "chunks/chattogram/m-b0e7fe06/cs/CS/jl-100.json" },
    { GOOGLE_CLIENT_ID: "mock-ok", GOOGLE_CLIENT_SECRET: "mock-ok", GOOGLE_REFRESH_TOKEN: "mock-ok" },
    200, "খুলনা বিভাগ",
    () => lastDriveUrl && lastDriveUrl.includes("test-file-id-004")) && all;
  console.log(all ? "ALL PASS" : "SOME FAILED");
  restoreManifest();
  global.fetch = realFetch;
  process.exit(all ? 0 : 1);
})();
