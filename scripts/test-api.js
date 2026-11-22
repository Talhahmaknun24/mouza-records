/* API যাচাই — কোনো আসল টোকেন ছাড়াই।
   চালান: node scripts/test-api.js
   কেস ৫-এ dummy env var দিয়ে Google-এর token endpoint-এ যাওয়া হয় —
   Google 400/invalid_grant দেবে, API-র 502-তে পরিণত হওয়ার কথা।
   আসল redirect শুধু আসল env var সেট করলেই যাচাই করা যাবে। */
const handler = require("../api/download.js");

function mockReq(query) {
  return { query };
}
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(k, v) { this.headers[k] = v; },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(data) { this.body = data || ""; },
  };
  return res;
}

async function check(name, query, env, wantStatus, wantInBody) {
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
  const ok = res.statusCode === wantStatus &&
    (wantInBody ? res.body.includes(wantInBody) : true);
  console.log((ok ? "PASS" : "FAIL") + " | " + name +
    " | status=" + res.statusCode +
    (res.headers.Location ? " | Location=" + res.headers.Location.slice(0, 80) + "…" : "") +
    (res.body ? " | body=" + res.body.slice(0, 120) : ""));
  return ok;
}

(async () => {
  const sampleId = require("../api/allowed-ids.json")[0];
  console.log("sample allowed id:", sampleId);
  let all = true;
  all = await check("1. file param নেই", {}, null, 400, "ID দেওয়া হয়নি") && all;
  all = await check("2. ভুল ফরম্যাটের ID", { file: "!!!" }, null, 400, "সঠিক নয়") && all;
  all = await check("3. তালিকায় নেই এমন ID", { file: "1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" }, null, 404, "তালিকায় নেই") && all;
  all = await check("4. জানা ID, env var নেই", { file: sampleId }, null, 503, "কনফিগার হয়নি") && all;
  all = await check("5. জানা ID + dummy env (Google প্রত্যাখ্যান করবে)",
    { file: sampleId },
    { GOOGLE_CLIENT_ID: "dummy", GOOGLE_CLIENT_SECRET: "dummy", GOOGLE_REFRESH_TOKEN: "dummy" },
    502, "লগইন করতে পারেনি") && all;
  console.log(all ? "ALL PASS" : "SOME FAILED");
  process.exit(all ? 0 : 1);
})();
