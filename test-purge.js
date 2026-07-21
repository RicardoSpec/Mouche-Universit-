/* Purge du double IIFE — comparateur d'arborescence.
   Boote le repo d'origine et le repo purgé avec le MÊME seed, compare le DOM. */
const fs = require("fs"), path = require("path"), { JSDOM } = require("jsdom");

const ORIG = "/home/claude/audit/muscu";
const NEW  = "/home/claude/work/muscu";
const PKEY = "ricardospec_planning_v1", MKEY = "memoDSCG_v1", SKEY = "suiviMuscu_v1";

const SEED = {
  [PKEY]: JSON.stringify({
    states: { "2026-07-22": "cours", "2026-07-24": "conge" },
    events: [{ id: "ev:1", start: "2026-07-23", label: "RDV kiné" }],
    deadlines: [
      { id: "dscg:memo-target", date: "2026-07-27", label: "Mémoire — objectif de rendu", icon: "📝" },
      { id: "dscg:ue1", date: "2026-10-28", label: "Examen UE1 Droit", icon: "🎓" }
    ],
    removed: { "dl:2026-01-01:vieux": true },
    seeds: { dscgExc: true },
    cléInconnueDuFutur: { a: 1, b: [2, 3] },
    rev: 7
  }),
  [MKEY]: JSON.stringify({
    parts: {}, corr: [], rev: {}, note: {},
    done: { "2026-07-19": 2.5, "2026-07-20": 1.75 },
    ui: { open: {} }, tasks: [{ id: "t1", done: true }]
  }),
  [SKEY]: JSON.stringify({ config: { lastBackup: "2026-07-10" }, days: {} })
};

function boot(dir) {
  const errs = [];
  const dom = new JSDOM(fs.readFileSync(path.join(dir, "index.html"), "utf8"), {
    url: "https://ricardospec.github.io/coachmuscu/",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      Object.keys(SEED).forEach(k => w.localStorage.setItem(k, SEED[k]));
      w.scrollTo = () => {}; w.confirm = () => true; w.prompt = () => null; w.alert = () => {};
      w.fetch = () => Promise.reject(new Error("réseau coupé en test"));
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      w.Element.prototype.scrollIntoView = function () {};
      Object.defineProperty(w.navigator, "serviceWorker", { value: { register: () => Promise.resolve() }, configurable: true });
      w.addEventListener("error", e => errs.push(String(e.error || e.message)));
    }
  });
  const d = dom.window.document;
  ["data.js", "app.js"].forEach(f => {
    const s = d.createElement("script");
    s.textContent = fs.readFileSync(path.join(dir, f), "utf8");
    d.body.appendChild(s);
  });
  d.dispatchEvent(new dom.window.Event("DOMContentLoaded", { bubbles: true }));
  return { dom, win: dom.window, doc: d, errs };
}

function depth(el, n = 0) {
  let max = n;
  for (const c of el.children) max = Math.max(max, depth(c, n + 1));
  return max;
}
function domPath(el) {
  const p = [];
  while (el && el.tagName && el.tagName !== "HTML") {
    const i = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
    p.unshift(el.tagName.toLowerCase() + "[" + i + "]");
    el = el.parentElement;
  }
  return p.join(">");
}

const KEYS = ["heroCard", "dayHead", "dayLog", "dayRadar", "homeCal", "regularity", "statGrid",
  "weekViz", "progBlocks", "triTable", "sportSub", "appList", "settingsBody", "warnbar",
  "v-day", "v-prog2", "v-sport"];

function snap(b) {
  const doc = b.doc, o = { ids: {}, counts: {}, txt: {} };
  KEYS.forEach(id => {
    const el = doc.getElementById(id);
    o.ids[id] = el ? domPath(el) : "(absent)";
    o.txt[id] = el ? el.textContent.replace(/\s+/g, " ").trim().slice(0, 400) : "";
  });
  ["div", "span", "button", "table", "svg", "input", "select"].forEach(t => o.counts[t] = doc.querySelectorAll(t).length);
  o.counts.__depth = depth(doc.body);
  o.counts.__calDl = doc.querySelectorAll(".cal-dl").length;
  o.counts.__bnd = doc.querySelectorAll(".bnd").length;
  return o;
}

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log("  ✅ " + n)) : (fail++, console.log("  ❌ " + n + (x ? "\n       → " + x : "")));

console.log("\n── Boot des deux versions ────────────────────────");
const A = boot(ORIG), B = boot(NEW);
const realErr = e => !/réseau coupé|Not implemented|Could not parse CSS/i.test(e);
ok("origine : aucune erreur JS", A.errs.filter(realErr).length === 0, A.errs.filter(realErr).slice(0, 3).join(" | "));
ok("purgée  : aucune erreur JS", B.errs.filter(realErr).length === 0, B.errs.filter(realErr).slice(0, 3).join(" | "));

console.log("\n── Arborescence identique ────────────────────────");
const sa = snap(A), sb = snap(B);
KEYS.forEach(id => ok("chemin DOM · #" + id, sa.ids[id] === sb.ids[id], sa.ids[id] + "  ≠  " + sb.ids[id]));
Object.keys(sa.counts).forEach(k =>
  ok("compte · " + k + " = " + sb.counts[k], sa.counts[k] === sb.counts[k], "origine " + sa.counts[k] + " ≠ purgée " + sb.counts[k]));

console.log("\n── Contenu rendu identique ───────────────────────");
KEYS.forEach(id => {
  if (!sa.txt[id] && !sb.txt[id]) return;
  ok("texte · #" + id, sa.txt[id] === sb.txt[id],
    "\n         origine: " + sa.txt[id].slice(0, 120) + "\n         purgée : " + sb.txt[id].slice(0, 120));
});

console.log("\n── Navigation par clics réels ────────────────────");
["v-prog2", "v-sport", "v-day"].forEach(v => {
  const ta = A.doc.querySelector('.tab[data-view="' + v + '"]'), tb = B.doc.querySelector('.tab[data-view="' + v + '"]');
  if (ta) ta.click(); if (tb) tb.click();
  const va = A.doc.getElementById(v), vb = B.doc.getElementById(v);
  ok("onglet " + v + " · même état actif", (va && va.className) === (vb && vb.className), (va && va.className) + " ≠ " + (vb && vb.className));
  ok("onglet " + v + " · même contenu", (va ? va.textContent.replace(/\s+/g, " ").length : -1) === (vb ? vb.textContent.replace(/\s+/g, " ").length : -2));
});
["dayPrev", "dayNext"].forEach(id => {
  const ba = A.doc.getElementById(id), bb = B.doc.getElementById(id);
  if (ba) ba.click(); if (bb) bb.click();
  ok("clic #" + id + " · même libellé de jour",
    (A.doc.getElementById("dayLabel") || {}).textContent === (B.doc.getElementById("dayLabel") || {}).textContent);
});

console.log("\n── Anti-clobber du stockage ──────────────────────");
[["memoDSCG_v1 intact octet pour octet", MKEY], ["suiviMuscu_v1 lisible", SKEY]].forEach(([n, k]) => {
  if (k === MKEY) ok(n, B.win.localStorage.getItem(k) === SEED[k],
    "\n         seed  : " + SEED[k].slice(0, 100) + "\n         après : " + String(B.win.localStorage.getItem(k)).slice(0, 100));
});
const pA = JSON.parse(A.win.localStorage.getItem(PKEY)), pB = JSON.parse(B.win.localStorage.getItem(PKEY));
const seedP = JSON.parse(SEED[PKEY]);
ok("clé inconnue préservée", JSON.stringify(pB["cléInconnueDuFutur"]) === JSON.stringify(seedP["cléInconnueDuFutur"]));
ok("tombstone préservé", pB.removed["dl:2026-01-01:vieux"] === true);
ok("states préservés", pB.states["2026-07-22"] === "cours" && pB.states["2026-07-24"] === "conge");
ok("events préservés", JSON.stringify(pB.events) === JSON.stringify(seedP.events));
ok("échéances dscg:* préservées", pB.deadlines.filter(d => /^dscg:/.test(d.id)).length === 2);
const stripRev = o => { const c = JSON.parse(JSON.stringify(o)); delete c.rev; return c; };
ok("store partagé identique entre les deux versions (hors rev)", JSON.stringify(stripRev(pA)) === JSON.stringify(stripRev(pB)),
  "\n         origine: " + JSON.stringify(stripRev(pA)).slice(0, 160) + "\n         purgée : " + JSON.stringify(stripRev(pB)).slice(0, 160));
ok("rev repose un horodatage plausible", typeof pB.rev === "number" && pB.rev > 1.7e12);

console.log("\n── Effets du doublon supprimés ───────────────────");
const src = fs.readFileSync(path.join(NEW, "app.js"), "utf8");
ok("un seul \"use strict\"", (src.match(/"use strict"/g) || []).length === 1);
ok("un seul enregistrement du service worker", (src.match(/serviceWorker\.register/g) || []).length === 1);
ok("un seul écouteur storage", (src.match(/addEventListener\("storage"/g) || []).length === 1);
ok("un seul init()", (src.match(/\n\s*function init\(\)\{/g) || []).length === 1);
ok("taille divisée par ~2", src.length < 290000, src.length + " o");

console.log("\n── Ancres redevenues uniques ─────────────────────");
["function renderHero(){", "function pMutate(", "function dscgDone(){", "function init(){", "var PKEY=\"ricardospec_planning_v1\""]
  .forEach(a => ok("ancre unique · " + a.slice(0, 34), src.split(a).length - 1 === 1, "occurrences : " + (src.split(a).length - 1)));

A.dom.window.close(); B.dom.window.close();
console.log("\n──────────────────────────────────────────────────");
console.log(fail === 0 ? `TOUT PASSE — ${pass} assertions ✅` : `${fail} ÉCHEC(S) sur ${pass + fail} ❌`);
process.exit(fail === 0 ? 0 : 1);
