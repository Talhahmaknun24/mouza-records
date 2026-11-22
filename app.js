/* মৌজা রেকর্ড — ক্যাসকেড ব্রাউজার।
   ডাটা কন্ট্রাক্ট: data/divisions.json -> data/tree-<slug>.json (+ search-<slug>.json)
   -> data/chunks/.../*.json (খতিয়ান তালিকা)। chunk লোড একটাই ফাংশনে (loadChunk),
   তাই পরে chunk অন্য কোথাও (API/CDN) গেলেও UI বদলাতে হবে না। */
"use strict";

const DATA_BASE = "data/";
const DOWNLOAD_API = "/api/download";
const CHUNK_API = "/api/chunk"; // chunk JSON Drive-এ থাকে (DRIVE-HOSTING.md) —
// DATA_BASE দিয়ে tree/search/divisions (রেপোতেই আছে), chunk /api/chunk দিয়ে।

const $ = (id) => document.getElementById(id);
const bn = (n) => Number(n).toLocaleString("bn-BD");
const fmtSize = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1048576) return Math.round(bytes / 1024) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
};

let divisions = [];          // divisions.json
let treeCache = {};          // slug -> division tree node
let searchCache = {};        // slug -> search entries
let chunkCache = {};         // chunk path -> chunk object
let sel = { division: null, district: null, upazila: null, type: null, mouza: null };
let mapSel = { division: null, district: null };
let currentChunk = null;     // chunk object of the selected mouza
const filters = {};          // level -> search text

/* ---------- helpers ---------- */
function toast(msg, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return res.json();
}

function loadChunk(path) {
  if (chunkCache[path]) return Promise.resolve(chunkCache[path]);
  // chunk রেপোতে নেই — /api/chunk Drive থেকে এনে দেয় (DRIVE-HOSTING.md)।
  return getJSON(CHUNK_API + "?path=" + encodeURIComponent(path)).then((c) => { chunkCache[path] = c; return c; });
}

function matchFilter(text, q) {
  if (!q) return true;
  return (text || "").toLowerCase().includes(q.trim().toLowerCase());
}

/* ---------- list rendering ---------- */
function renderList(ulId, items, selectedValue, emptyMsg) {
  const ul = $(ulId);
  ul.innerHTML = "";
  if (!items) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = emptyMsg || "প্রথমে উপরের ধাপটি নির্বাচন করুন।";
    ul.appendChild(li);
    return;
  }
  const q = filters[ulId] || "";
  const shown = items.filter((it) => matchFilter(it.label + " " + (it.code || ""), q));
  if (shown.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = q ? "কিছু পাওয়া যায়নি।" : "তালিকা খালি।";
    ul.appendChild(li);
    return;
  }
  for (const it of shown) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const name = document.createElement("span");
    name.textContent = it.label;
    b.appendChild(name);
    if (it.count != null) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = bn(it.count);
      b.appendChild(badge);
    }
    const check = document.createElement("span");
    check.className = "check";
    check.textContent = "✓";
    b.appendChild(check);
    if (selectedValue != null && it.value === selectedValue) b.classList.add("selected");
    b.addEventListener("click", it.onClick);
    li.appendChild(b);
    ul.appendChild(li);
  }
}

function divisionNode() {
  return sel.division ? treeCache[sel.division.slug] : null;
}
function districtNode() {
  const d = divisionNode();
  return d && sel.district ? d.districts.find((x) => x.name === sel.district) : null;
}
function upazilaNode() {
  const d = districtNode();
  return d && sel.upazila ? d.upazilas.find((x) => x.name === sel.upazila) : null;
}
function typeNode() {
  const u = upazilaNode();
  return u && sel.type ? u.types.find((x) => x.code === sel.type) : null;
}

function renderCascade() {
  renderList("list-division",
    divisions.map((d) => ({
      label: d.name, value: d.slug, count: d.count,
      onClick: () => selectDivision(d),
    })),
    sel.division ? sel.division.slug : null, "লোড হচ্ছে…");

  const div = divisionNode();
  renderList("list-district",
    div ? div.districts.map((x) => ({
      label: x.name, value: x.name, count: x.count,
      onClick: () => { sel.district = x.name; sel.upazila = sel.type = sel.mouza = null; currentChunk = null; renderAll(); },
    })) : null,
    sel.district, "প্রথমে বিভাগ নির্বাচন করুন।");

  const dist = districtNode();
  renderList("list-upazila",
    dist ? dist.upazilas.map((x) => ({
      label: x.name, value: x.name, count: x.count,
      onClick: () => { sel.upazila = x.name; sel.type = sel.mouza = null; currentChunk = null; renderAll(); },
    })) : null,
    sel.upazila, "প্রথমে জেলা নির্বাচন করুন।");

  const up = upazilaNode();
  renderList("list-type",
    up ? up.types.map((x) => ({
      label: x.label, value: x.code, count: x.count,
      onClick: () => { sel.type = x.code; sel.mouza = null; currentChunk = null; renderAll(); },
    })) : null,
    sel.type, "প্রথমে উপজেলা নির্বাচন করুন।");

  const tp = typeNode();
  renderList("list-mouza",
    tp ? tp.mouzas.map((x) => ({
      label: x.label + (x.jl ? " (JL " + x.jl + ")" : ""),
      value: x.name === null ? "__unnamed__" : x.name, count: x.count,
      onClick: () => selectMouza(x),
    })) : null,
    sel.mouza ? (sel.mouza.name === null ? "__unnamed__" : sel.mouza.name) : null,
    "প্রথমে খতিয়ানের ধরণ নির্বাচন করুন।");

  renderPathbar();
  renderKhatian();
}

function renderPathbar() {
  const parts = [];
  if (sel.division) parts.push(sel.division.name);
  if (sel.district) parts.push(sel.district);
  if (sel.upazila) parts.push(sel.upazila);
  const tp = typeNode();
  if (tp) parts.push(tp.label);
  if (sel.mouza) parts.push(sel.mouza.label);
  $("pathbar").hidden = parts.length === 0;
  $("pathbar-text").textContent = parts.join(" › ");
}

/* ---------- selection ---------- */
async function selectDivision(d) {
  if (sel.division && sel.division.slug === d.slug && treeCache[d.slug]) {
    sel.district = sel.upazila = sel.type = sel.mouza = null;
    currentChunk = null;
    renderAll();
    return;
  }
  sel.division = d;
  sel.district = sel.upazila = sel.type = sel.mouza = null;
  currentChunk = null;
  renderAll();
  try {
    const [tree, search] = await Promise.all([
      getJSON(DATA_BASE + d.tree),
      getJSON(DATA_BASE + d.search),
    ]);
    treeCache[d.slug] = tree;
    searchCache[d.slug] = search;
    $("global-search-hint").textContent =
      "“" + d.name + "” বিভাগের মৌজা খুঁজুন — নামের অংশ লিখলেই হবে।";
    renderAll();
    renderMap();
  } catch (e) {
    toast("বিভাগের তালিকা লোড করা যায়নি।");
  }
}

async function selectMouza(m) {
  sel.mouza = m;
  currentChunk = null;
  renderAll();
  try {
    currentChunk = await loadChunk(m.chunk);
    renderKhatian();
  } catch (e) {
    toast("খতিয়ান তালিকা লোড করা যায়নি।");
  }
}

/* Set a full path at once (used by global search). Matches by chunk path,
   so JL / subfolder / unnamed groups resolve too. */
async function selectPath(divSlug, district, upazila, typeCode, chunk) {
  const d = divisions.find((x) => x.slug === divSlug);
  if (!d) return;
  if (!treeCache[d.slug]) {
    await selectDivision(d);
  } else {
    sel.division = d;
  }
  sel.district = district;
  sel.upazila = upazila;
  sel.type = typeCode;
  sel.mouza = null;
  const tp = typeNode();
  const m = tp && tp.mouzas.find((x) => x.chunk === chunk);
  if (m) await selectMouza(m);
  else renderAll();
}

/* ---------- khatian table ---------- */
function renderKhatian() {
  const body = $("khatian-body");
  const hint = $("khatian-hint");
  if (!sel.mouza || !currentChunk) {
    body.hidden = true;
    hint.hidden = false;
    hint.textContent = sel.mouza ? "খতিয়ান তালিকা লোড হচ্ছে…" : "খতিয়ান দেখতে মৌজা নির্বাচন করুন।";
    return;
  }
  hint.hidden = true;
  body.hidden = false;
  const q = ($("khatian-filter").value || "").trim().toLowerCase();
  const files = currentChunk.files.filter((f) =>
    !q || (f.n + " " + f.name).toLowerCase().includes(q));
  $("khatian-count").textContent =
    "মোট " + bn(currentChunk.files.length) + "টি খতিয়ান" +
    (q ? " — খোঁজে " + bn(files.length) + "টি মিলেছে" : "") +
    " • " + sel.mouza.label + " • " + (typeNode() ? typeNode().label : "");
  const tbody = $("khatian-rows");
  tbody.innerHTML = "";
  $("khatian-empty").hidden = files.length !== 0;
  for (const f of files) {
    const tr = document.createElement("tr");

    const tdN = document.createElement("td");
    const strong = document.createElement("strong");
    strong.textContent = f.n || "—";
    tdN.appendChild(strong);
    if (f.scan) {
      const tag = document.createElement("span");
      tag.className = "scan-tag";
      tag.textContent = "স্ক্যান " + f.scan;
      tdN.appendChild(tag);
    }
    if (f.kind === "map") {
      const tag = document.createElement("span");
      tag.className = "kind-tag map";
      tag.textContent = "ম্যাপ";
      tdN.appendChild(tag);
    } else if (f.kind === "pdf") {
      const tag = document.createElement("span");
      tag.className = "kind-tag pdf";
      tag.textContent = "PDF";
      tdN.appendChild(tag);
    }
    const fn = document.createElement("span");
    fn.className = "file-name";
    fn.textContent = f.name + " (" + fmtSize(f.size) + ")";
    tdN.appendChild(fn);
    if (f.sub) {
      const sp = document.createElement("span");
      sp.className = "sub-path";
      sp.textContent = "📁 " + f.sub;
      tdN.appendChild(sp);
    }
    tr.appendChild(tdN);

    const tdOwner = document.createElement("td");
    tdOwner.className = "no-owner";
    tdOwner.title = "এই ফাইলে মালিকের তথ্য নেই";
    tdOwner.textContent = "—";
    tr.appendChild(tdOwner);

    const tdAct = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    const view = document.createElement("a");
    view.className = "btn btn-outline";
    view.href = DOWNLOAD_API + "?file=" + encodeURIComponent(f.id);
    view.target = "_blank";
    view.rel = "noopener";
    view.textContent = "দেখুন";
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "btn btn-solid";
    dl.textContent = "⬇ ডাউনলোড";
    dl.addEventListener("click", () => downloadFile(f.id, f.name));
    wrap.appendChild(view);
    wrap.appendChild(dl);
    tdAct.appendChild(wrap);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  }
}

/* Download: try fetch->blob (forces a real download); if the browser or
   the redirect blocks it, fall back to opening the temp link in a new tab. */
async function downloadFile(id, filename) {
  toast("ডাউনলোড শুরু হচ্ছে…");
  try {
    const res = await fetch(DOWNLOAD_API + "?file=" + encodeURIComponent(id));
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      const err = await res.json().catch(() => ({}));
      toast(err.error || "ডাউনলোড করা যায়নি।");
      return;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "khatian";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    window.open(DOWNLOAD_API + "?file=" + encodeURIComponent(id), "_blank", "noopener");
  }
}

/* ---------- global search ---------- */
function renderGlobalSearch() {
  const input = $("global-search-input");
  const box = $("global-search-results");
  const q = input.value.trim().toLowerCase();
  box.innerHTML = "";
  if (q.length < 2) { box.hidden = true; return; }
  if (!sel.division || !searchCache[sel.division.slug]) {
    box.hidden = true;
    $("global-search-hint").textContent = "মৌজা খুঁজতে প্রথমে বিভাগ নির্বাচন করুন।";
    return;
  }
  const hits = searchCache[sel.division.slug]
    .filter((s) => s.name.toLowerCase().includes(q) ||
      (s.jl && String(s.jl).includes(q)))
    .slice(0, 8);
  if (hits.length === 0) {
    box.hidden = true;
    $("global-search-hint").textContent = "“" + input.value.trim() + "” নামে কোনো মৌজা এই বিভাগে পাওয়া যায়নি।";
    return;
  }
  box.hidden = false;
  $("global-search-hint").textContent = bn(hits.length) + "টি মৌজা পাওয়া গেছে।";
  for (const h of hits) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const name = document.createElement("span");
    name.textContent = h.name;
    const crumb = document.createElement("span");
    crumb.className = "crumb";
    crumb.textContent = h.path.slice(1, 4).join(" › ");
    b.appendChild(name);
    b.appendChild(crumb);
    b.addEventListener("click", () => {
      box.hidden = true;
      input.value = "";
      const divSlug = sel.division.slug;
      selectPath(divSlug, h.path[1], h.path[2], h.path[3], h.chunk);
      document.getElementById("khatian-card").scrollIntoView({ behavior: "smooth" });
    });
    li.appendChild(b);
    box.appendChild(li);
  }
}

/* ---------- thana map section ----------
   The dataset has NO mouza maps (0). It has 157 thana map PDFs, filed
   under type "থানা ম্যাপ". So this section browses division -> district
   and lists every thana map in that district. */
function mapDivisionNode() {
  return mapSel.division ? treeCache[mapSel.division.slug] : null;
}
function mapDistrictNode() {
  const d = mapDivisionNode();
  return d && mapSel.district ? d.districts.find((x) => x.name === mapSel.district) : null;
}
/* Chunk paths of every "থানা ম্যাপ" group in a district. */
function thanaMapChunks(distNode) {
  const out = [];
  if (!distNode) return out;
  for (const up of distNode.upazilas) {
    for (const tp of up.types) {
      if (tp.code === "থানা ম্যাপ") {
        for (const m of tp.mouzas) out.push(m.chunk);
      }
    }
  }
  return out;
}

function renderMap() {
  renderList("list-map-division",
    divisions.map((d) => ({
      label: d.name, value: d.slug, count: d.count,
      onClick: () => selectMapDivision(d),
    })),
    mapSel.division ? mapSel.division.slug : null, "লোড হচ্ছে…");

  const div = mapDivisionNode();
  renderList("list-map-district",
    div ? div.districts.map((x) => ({
      label: x.name, value: x.name, count: x.count,
      onClick: () => selectMapDistrict(x.name),
    })) : null,
    mapSel.district, "প্রথমে বিভাগ নির্বাচন করুন।");
}

async function selectMapDivision(d) {
  mapSel.division = d;
  mapSel.district = null;
  $("map-body").hidden = true;
  $("map-empty").hidden = true;
  renderMap();
  if (!treeCache[d.slug]) {
    try {
      const [tree, search] = await Promise.all([
        getJSON(DATA_BASE + d.tree),
        getJSON(DATA_BASE + d.search),
      ]);
      treeCache[d.slug] = tree;
      searchCache[d.slug] = search;
      renderMap();
    } catch (e) {
      toast("বিভাগের তালিকা লোড করা যায়নি।");
    }
  }
}

async function selectMapDistrict(districtName) {
  mapSel.district = districtName;
  renderMap();
  const body = $("map-body");
  const empty = $("map-empty");
  body.hidden = true;
  empty.hidden = true;
  const chunks = thanaMapChunks(mapDistrictNode());
  if (chunks.length === 0) {
    empty.hidden = false;
    empty.textContent = "এই জেলার কোনো থানা ম্যাপ পাওয়া যায়নি।";
    return;
  }
  try {
    const loaded = await Promise.all(chunks.map((c) => loadChunk(c)));
    const maps = [];
    for (const c of loaded) {
      for (const f of c.files) {
        if (f.kind === "map") maps.push({ ...f, upazila: c.upazila });
      }
    }
    if (maps.length === 0) {
      empty.hidden = false;
      empty.textContent = "এই জেলার কোনো থানা ম্যাপ পাওয়া যায়নি।";
      return;
    }
    $("map-count").textContent =
      "মোট " + bn(maps.length) + "টি থানা ম্যাপ PDF — " + districtName;
    const ul = $("map-rows");
    ul.innerHTML = "";
    for (const f of maps) {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = f.name + " (" + fmtSize(f.size) + ")" +
        (f.upazila && f.upazila !== "থানা ম্যাপ" ? " — " + f.upazila : "");
      const wrap = document.createElement("div");
      wrap.className = "row-actions";
      const view = document.createElement("a");
      view.className = "btn btn-outline";
      view.href = DOWNLOAD_API + "?file=" + encodeURIComponent(f.id);
      view.target = "_blank";
      view.rel = "noopener";
      view.textContent = "দেখুন";
      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "btn btn-solid";
      dl.textContent = "⬇ ডাউনলোড";
      dl.addEventListener("click", () => downloadFile(f.id, f.name));
      wrap.appendChild(view);
      wrap.appendChild(dl);
      li.appendChild(span);
      li.appendChild(wrap);
      ul.appendChild(li);
    }
    body.hidden = false;
  } catch (e) {
    toast("ম্যাপ তালিকা লোড করা যায়নি।");
  }
}


/* ---------- wiring ---------- */
function renderAll() {
  renderCascade();
}

function init() {
  document.querySelectorAll("[data-filter]").forEach((input) => {
    input.addEventListener("input", () => {
      const level = input.getAttribute("data-filter");
      const map = {
        division: "list-division", district: "list-district",
        upazila: "list-upazila", type: "list-type", mouza: "list-mouza",
        "map-division": "list-map-division", "map-district": "list-map-district",
      };
      filters[map[level]] = input.value;
      if (level.startsWith("map-")) renderMap();
      else renderCascade();
    });
  });
  $("khatian-filter").addEventListener("input", renderKhatian);
  $("global-search-input").addEventListener("input", renderGlobalSearch);
  $("reset-btn").addEventListener("click", () => {
    sel = { division: null, district: null, upazila: null, type: null, mouza: null };
    currentChunk = null;
    $("khatian-filter").value = "";
    renderAll();
  });
  $("map-empty").hidden = true;

  getJSON(DATA_BASE + "divisions.json")
    .then((idx) => {
      divisions = idx.divisions || [];
      const bar = $("stats-bar");
      bar.innerHTML = "মোট <span class=\"num\">" + bn(idx.totalFiles) +
        "</span>টি ফাইল • <span class=\"num\">" + bn(divisions.length) +
        "</span> বিভাগ • <span class=\"num\">৬২</span> জেলা • <span class=\"num\">৪৮৮</span> উপজেলা • <span class=\"num\">৪৭,০৭১</span> মৌজা • <span class=\"num\">১৫৭</span> থানা ম্যাপ";
      renderCascade();
      renderMap();
    })
    .catch(() => {
      toast("তালিকা লোড করা যায়নি — পরে আবার চেষ্টা করুন।");
      renderCascade();
      renderMap();
    });
}

document.addEventListener("DOMContentLoaded", init);
