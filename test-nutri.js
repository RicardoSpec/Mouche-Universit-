/* Coach Muscu v=138 — tests jsdom : publication du signal nutrition. */
const fs = require("fs"), path = require("path"), { JSDOM } = require("jsdom");
const PKEY = "ricardospec_planning_v1", SKEY = "suiviMuscu_v1", MKEY = "memoDSCG_v1";
const D = __dirname;
const TODAY = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log("  ✅ " + n)) : (fail++, console.log("  ❌ " + n + (x ? "\n       → " + x : "")));
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), "attendu " + JSON.stringify(b) + " · obtenu " + JSON.stringify(a));

const MEAL = d => ({
  days: { [d]: { mealItems: { dj: [
    { name: "Blanc de poulet", qty: 200, unit: "g", nut: { base: 100, baseUnit: "g", kcal: 165, prot: 31 } },
    { name: "Riz", qty: 150, unit: "g", nut: { base: 100, baseUnit: "g", kcal: 130, prot: 2.7 } }
  ] } } },
  sessions: {}, tri: {}
});

function boot(seed) {
  const errs = [];
  const dom = new JSDOM(fs.readFileSync(path.join(D, "index.html"), "utf8"), {
    url: "https://ricardospec.github.io/coachmuscu/",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.clear();
      Object.keys(seed || {}).forEach(k => w.localStorage.setItem(k, seed[k]));
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
    s.textContent = fs.readFileSync(path.join(D, f), "utf8");
    d.body.appendChild(s);
  });
  d.dispatchEvent(new dom.window.Event("DOMContentLoaded", { bubbles: true }));
  return { dom, win: dom.window, doc: d, errs, P: () => JSON.parse(dom.window.localStorage.getItem(PKEY) || "null") };
}
const real = e => !/réseau coupé|Not implemented|Could not parse CSS/i.test(e);

console.log("\n── 1. Le signal est publié ───────────────────────");
let SIGNAL;
{
  const b = boot({ [SKEY]: JSON.stringify(MEAL(TODAY)) });
  ok("aucune erreur JS au boot", b.errs.filter(real).length === 0, b.errs.filter(real).join(" | "));
  const p = b.P();
  ok("clé nutri créée dans le store partagé", !!p && !!p.nutri, JSON.stringify(p && Object.keys(p)));
  const s = p.nutri[TODAY];
  ok("signal du jour présent", !!s, JSON.stringify(p.nutri));
  eq("champs exactement {k,p,t}", Object.keys(s || {}).sort(), ["k", "p", "t"]);
  eq("cible = 130 g", s.t, 130);
  ok("kcal cohérentes (330 + 195)", s.k === 525, "k=" + s.k);
  ok("protéines > 0", s.p > 0, "p=" + s.p);
  ok("valeurs numériques finies", [s.k, s.p, s.t].every(v => typeof v === "number" && isFinite(v)));
  SIGNAL = s;
  b.dom.window.close();
}

console.log("\n── 2. Aucune écriture si rien ne change ──────────");
{
  /* Preuve observable du garde-fou : on sème 20 jours d'historique + le signal du jour
     DÉJÀ correct. Si publishNutri écrivait quand même, il élaguerait à 14 jours.
     Le fait que les 21 clés survivent prouve qu'il n'a pas appelé pMutate.
     (Le `rev` du store, lui, bouge à chaque boot : c'est un comportement préexistant
     de Coach Muscu, une de ses routines d'init écrit sans condition.) */
  const hist = {};
  for (let i = 1; i <= 20; i++)
    hist[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = { k: 1, p: 1, t: 130 };
  hist[TODAY] = SIGNAL;
  const seedP = { states: {}, events: [], deadlines: [], removed: {}, seeds: {}, nutri: hist, rev: 1 };
  const b = boot({ [SKEY]: JSON.stringify(MEAL(TODAY)), [PKEY]: JSON.stringify(seedP) });
  const n = b.P().nutri;
  eq("signal du jour inchangé", n[TODAY], SIGNAL);
  eq("aucune écriture : les 21 jours semés sont intacts", Object.keys(n).length, 21);
  b.dom.window.close();
}
{
  /* et à l'inverse : un signal périmé DOIT être réécrit */
  const seedP = { states: {}, events: [], deadlines: [], removed: {}, seeds: {},
    nutri: { [TODAY]: { k: 1, p: 1, t: 130 } }, rev: 1 };
  const b = boot({ [SKEY]: JSON.stringify(MEAL(TODAY)), [PKEY]: JSON.stringify(seedP) });
  eq("signal périmé corrigé", b.P().nutri[TODAY], SIGNAL);
  b.dom.window.close();
}

console.log("\n── 3. Rétention à 14 jours ───────────────────────");
{
  const old = {};
  for (let i = 1; i <= 20; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    old[d] = { k: 100 + i, p: 100 + i, t: 130 };
  }
  const seedP = { states: {}, events: [], deadlines: [], removed: {}, seeds: {}, nutri: old, rev: 1 };
  const b = boot({ [SKEY]: JSON.stringify(MEAL(TODAY)), [PKEY]: JSON.stringify(seedP) });
  const n = b.P().nutri;
  ok("au plus 14 jours conservés", Object.keys(n).length <= 14, "n=" + Object.keys(n).length);
  ok("le jour courant fait partie des gardés", !!n[TODAY]);
  const keys = Object.keys(n).sort();
  ok("ce sont les plus récents qui restent", keys[keys.length - 1] === TODAY, keys.join(","));
  b.dom.window.close();
}

console.log("\n── 4. Anti-clobber du store partagé ──────────────");
{
  const seedP = {
    states: { "2026-07-23": "conge" },
    events: [{ id: "ev:1", start: "2026-07-25", label: "RDV" }],
    deadlines: [
      { id: "dscg:memo-target", date: "2026-07-27", label: "Mémoire — objectif de rendu", icon: "📝" },
      { id: "dscg:ue1", date: "2026-10-28", label: "Examen UE1 Droit", icon: "🎓" }
    ],
    removed: { "dscg:ue3": true, "cm:vieux": true },
    seeds: { dscgExc: true }, cléInconnueDuFutur: { a: [1, 2] }, rev: 5
  };
  const memo = { parts: {}, corr: [], rev: {}, note: {}, done: { "2026-07-20": 1.75 }, ui: { open: {} }, tasks: [{ id: "t1" }] };
  const b = boot({ [SKEY]: JSON.stringify(MEAL(TODAY)), [PKEY]: JSON.stringify(seedP), [MKEY]: JSON.stringify(memo) });
  const p = b.P();
  ok("le signal a bien été écrit", !!p.nutri[TODAY]);
  eq("states intacts", p.states["2026-07-23"], "conge");
  eq("events intacts", p.events, seedP.events);
  eq("échéances dscg:* intactes", p.deadlines.filter(d => /^dscg:/.test(d.id)).length, 2);
  eq("tombstone dscg:ue3 intact", p.removed["dscg:ue3"], true);
  eq("tombstone cm:vieux intact", p.removed["cm:vieux"], true);
  eq("seeds intacts", p.seeds.dscgExc, true);
  eq("clé inconnue préservée", p["cléInconnueDuFutur"], seedP["cléInconnueDuFutur"]);
  eq("memoDSCG_v1 intact octet pour octet", b.win.localStorage.getItem(MKEY), JSON.stringify(memo));
  b.dom.window.close();
}

console.log("\n── 5. Jour sans repas noté ───────────────────────");
{
  const b = boot({ [SKEY]: JSON.stringify({ days: {}, sessions: {}, tri: {} }) });
  const p = b.P();
  ok("aucun signal fabriqué à partir de rien", !p.nutri || !p.nutri[TODAY], JSON.stringify(p.nutri));
  ok("aucune erreur JS", b.errs.filter(real).length === 0, b.errs.filter(real).join(" | "));
  b.dom.window.close();
}

console.log("\n── 6. Non-régression de la purge ─────────────────");
{
  const src = fs.readFileSync(path.join(D, "app.js"), "utf8");
  eq("un seul \"use strict\"", (src.match(/"use strict"/g) || []).length, 1);
  eq("un seul init()", (src.match(/\n\s*function init\(\)\{/g) || []).length, 1);
  eq("une seule définition de publishNutri", (src.match(/function publishNutri\(\)/g) || []).length, 1);
  const sw = fs.readFileSync(path.join(D, "sw.js"), "utf8");
  ok("cache SW renommé", /coachmuscu-runtime-v70/.test(sw), sw.match(/coachmuscu-runtime-v\d+/));
  const html = fs.readFileSync(path.join(D, "index.html"), "utf8");
  eq("3 refs en ?v=138", (html.match(/\?v=138/g) || []).length, 3);
}

console.log("\n──────────────────────────────────────────────────");
console.log(fail === 0 ? `TOUT PASSE — ${pass} assertions ✅` : `${fail} ÉCHEC(S) sur ${pass + fail} ❌`);
process.exit(fail === 0 ? 0 : 1);
