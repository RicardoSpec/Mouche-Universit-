/* Mémoire DSCG v=17 — tests jsdom : tuile « Nutrition du jour » (lecture seule). */
const fs = require("fs"), path = require("path"), { JSDOM } = require("jsdom");
const PKEY = "ricardospec_planning_v1", KEY = "memoDSCG_v1";
const D = __dirname;
const html = fs.readFileSync(path.join(D, "index.html"), "utf8");
const TODAY = new Date().toISOString().slice(0, 10);
const HIER = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log("  ✅ " + n)) : (fail++, console.log("  ❌ " + n + (x ? "\n       → " + x : "")));
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), "attendu " + JSON.stringify(b) + " · obtenu " + JSON.stringify(a));

/* forme exacte produite par Coach Muscu */
const P = (nutri, extra) => JSON.stringify(Object.assign(
  { states: {}, events: [], deadlines: [], removed: {}, seeds: { dscgExc: true }, rev: 1 },
  nutri ? { nutri: nutri } : {}, extra || {}));

function boot(seed) {
  const errs = [];
  const dom = new JSDOM(html, {
    url: "https://ricardospec.github.io/Mouche-Universit-/",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.localStorage.clear();
      Object.keys(seed || {}).forEach(k => w.localStorage.setItem(k, seed[k]));
      w.scrollTo = () => {}; w.confirm = () => true; w.prompt = () => null; w.alert = () => {};
      w.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 0);
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      w.Element.prototype.scrollIntoView = function () {};
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
  return { dom, win: dom.window, doc: d, errs, tile: () => d.getElementById("nutriTile"),
    S: () => JSON.parse(dom.window.localStorage.getItem(PKEY) || "null"),
    M: () => JSON.parse(dom.window.localStorage.getItem(KEY) || "{}") };
}

console.log("\n── 1. Rien à afficher → rien affiché ─────────────");
{
  const b = boot({});
  ok("aucune erreur JS au boot", b.errs.length === 0, b.errs.join(" | "));
  ok("la tuile existe dans le DOM", !!b.tile());
  ok("mais elle est masquée", b.tile().hidden);
  eq("et vide", b.tile().innerHTML, "");
  b.dom.window.close();
}
{
  // un signal d'hier ne doit pas remonter comme celui du jour
  const b = boot({ [PKEY]: P({ [HIER]: { k: 2000, p: 140, t: 130 } }) });
  ok("signal d'hier seul → tuile masquée", b.tile().hidden);
  b.dom.window.close();
}

console.log("\n── 2. Signal du jour affiché ─────────────────────");
{
  const b = boot({ [PKEY]: P({ [TODAY]: { k: 2145, p: 132.4, t: 130 } }) });
  const t = b.tile();
  ok("tuile visible", !t.hidden);
  ok("titre correct", /Nutrition du jour/.test(t.textContent), t.textContent.slice(0, 80));
  ok("provenance indiquée", /via Coach Muscu/.test(t.textContent));
  ok("protéines affichées en français", /132,4 g/.test(t.textContent), t.textContent.slice(0, 160));
  ok("kcal affichées", /2145/.test(t.textContent));
  ok("cible tenue annoncée", /Cible de 130 g tenue/.test(t.textContent), t.textContent.slice(0, 200));
  ok("barre de progression rendue", !!t.querySelector(".ms-fill"));
  eq("barre pleine à 100 %", t.querySelector(".ms-fill").getAttribute("style"), "width:100%");
  const a = t.querySelector("a.link-more");
  ok("lien vers Coach Muscu", !!a && /coachmuscu/.test(a.getAttribute("href")), a && a.getAttribute("href"));
  b.dom.window.close();
}
{
  const b = boot({ [PKEY]: P({ [TODAY]: { k: 1500, p: 65, t: 130 } }) });
  const t = b.tile();
  ok("reste à couvrir annoncé", /Encore 65 g/.test(t.textContent), t.textContent.slice(0, 200));
  eq("barre à 50 %", t.querySelector(".ms-fill").getAttribute("style"), "width:50%");
  b.dom.window.close();
}
{
  const b = boot({ [PKEY]: P({ [TODAY]: { k: 3000, p: 260, t: 130 } }) });
  eq("barre plafonnée à 100 %", b.tile().querySelector(".ms-fill").getAttribute("style"), "width:100%");
  b.dom.window.close();
}

console.log("\n── 3. Signal abîmé → on n'affiche rien ───────────");
[
  ["nutri absent", P(null)],
  ["nutri non-objet", P(null, { nutri: "oups" })],
  ["jour non-objet", P({ [TODAY]: 42 })],
  ["protéines non numériques", P({ [TODAY]: { k: 100, p: "beaucoup", t: 130 } })],
  ["signal vide", P({ [TODAY]: {} })]
].forEach(([n, seed]) => {
  const b = boot({ [PKEY]: seed });
  ok(n + " → tuile masquée, aucune erreur", b.tile().hidden && b.errs.length === 0,
    "hidden=" + b.tile().hidden + " errs=" + b.errs.join("|"));
  b.dom.window.close();
});
{
  // cible absente ou absurde → on retombe sur 130
  const b = boot({ [PKEY]: P({ [TODAY]: { k: 900, p: 65 } }) });
  ok("cible manquante → repli sur 130 g", /130 g/.test(b.tile().textContent), b.tile().textContent.slice(0, 200));
  b.dom.window.close();
}

console.log("\n── 4. Lecture seule : rien n'est jamais écrit ────");
{
  const seed = P({ [TODAY]: { k: 2000, p: 120, t: 130 } }, { cléInconnue: { z: 1 } });
  const b = boot({ [PKEY]: seed });
  const after = b.S();
  eq("le signal nutri n'est pas modifié", after.nutri[TODAY], { k: 2000, p: 120, t: 130 });
  eq("clé inconnue préservée", after["cléInconnue"], { z: 1 });
  ok("aucun signal nutri recopié dans memoDSCG_v1", !("nutri" in b.M()));
  // une écriture légitime d'Université ne doit pas emporter le signal
  b.doc.getElementById("planGo").click();
  eq("planifier ne touche pas au signal", b.S().nutri[TODAY], { k: 2000, p: 120, t: 130 });
  const conge = b.doc.querySelector('#calGrid [data-iso="2026-07-23"]');
  if (conge) {
    conge.click();
    const opt = b.doc.querySelector('#sheetOpts .sh-opt[data-type="conge"]');
    if (opt) opt.click();
  }
  eq("changer un type de jour ne touche pas au signal", b.S().nutri[TODAY], { k: 2000, p: 120, t: 130 });
  b.dom.window.close();
}

console.log("\n── 5. Rafraîchissement quand l'autre app écrit ───");
{
  const b = boot({ [PKEY]: P(null) });
  ok("au départ : masquée", b.tile().hidden);
  // Coach Muscu écrit dans un autre onglet → événement storage
  const nouveau = P({ [TODAY]: { k: 1800, p: 118, t: 130 } });
  b.win.localStorage.setItem(PKEY, nouveau);
  const ev = new b.win.Event("storage");
  ev.key = PKEY; ev.newValue = nouveau;
  b.win.dispatchEvent(ev);
  ok("après l'événement storage : visible", !b.tile().hidden);
  ok("et à jour", /118 g/.test(b.tile().textContent), b.tile().textContent.slice(0, 160));
  b.dom.window.close();
}

console.log("\n── 6. Non-régression v=13 → v=16 ─────────────────");
{
  const b = boot({ [PKEY]: P({ [TODAY]: { k: 2000, p: 120, t: 130 } }) });
  eq("6 échéances dscg:* publiées", b.S().deadlines.length, 6);
  ok("cockpit rendu", /Aujourd'hui/.test(b.doc.getElementById("coachCard").textContent));
  ok("panneau de plan rendu", !!b.doc.getElementById("planAuto"));
  ok("calendrier rendu", b.doc.querySelectorAll("#calGrid .cal-cell").length > 27);
  const htm = fs.readFileSync(path.join(D, "index.html"), "utf8");
  eq("3 refs en ?v=17", (htm.match(/\?v=17/g) || []).length, 3);
  ok("cache SW renommé en v2", /mouche-univ-runtime-v2/.test(fs.readFileSync(path.join(D, "sw.js"), "utf8")));
  b.dom.window.close();
}

console.log("\n──────────────────────────────────────────────────");
console.log(fail === 0 ? `TOUT PASSE — ${pass} assertions ✅` : `${fail} ÉCHEC(S) sur ${pass + fail} ❌`);
process.exit(fail === 0 ? 0 : 1);
