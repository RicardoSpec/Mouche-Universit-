/* =============================================================
   app.js — Grand livre (budget personnel) — SOCLE (Lot A)
   Aucune donnée n'est embarquée dans le dépôt : les années sont
   importées depuis l'app et vivent dans le navigateur (localStorage).
   ============================================================= */
(function () {
  "use strict";

  /* ---------- Constantes ---------- */
  const MOIS = ["janvier","février","mars","avril","mai","juin",
                "juillet","août","septembre","octobre","novembre","décembre"];

  // Registre des postes : libellé + groupe (toutes années).
  const POSTES = {
    // Revenus
    salaire:{label:"Salaire (mois précédent)",groupe:"revenu"}, apl:{label:"APL",groupe:"revenu"},
    prime:{label:"Prime d'activité",groupe:"revenu"}, mobilijeune:{label:"Mobilijeune / aide",groupe:"revenu"},
    exceptionnel:{label:"Exceptionnel",groupe:"revenu"}, autre:{label:"Autre / aides",groupe:"revenu"},
    // Besoins
    courses:{label:"Courses",groupe:"besoin"}, abonnements:{label:"Abonnements divers",groupe:"besoin"},
    loyer:{label:"Loyer Cc",groupe:"besoin"}, medic:{label:"Médical (kiné, ysp)",groupe:"besoin"},
    // Désirs
    empruntAssu:{label:"Emprunt + assurance",groupe:"desir"}, camionAssu:{label:"Camion + assurance auto",groupe:"desir"},
    tanSncf:{label:"Tan + SNCF (+ essence)",groupe:"desir"}, sorties:{label:"Sorties, meubles, voyages",groupe:"desir"},
    essence:{label:"Essence",groupe:"desir"}, velo:{label:"Vélo / ordi",groupe:"desir"}, divers:{label:"Divers",groupe:"desir"},
    // Épargne (livrets / sûr)
    ldds:{label:"LDDS",groupe:"epargne"}, lep:{label:"LEP",groupe:"epargne"}, cel:{label:"CEL",groupe:"epargne"},
    pel:{label:"PEL",groupe:"epargne"}, pee:{label:"PEE",groupe:"epargne"}, assuranceVie:{label:"Assurance vie",groupe:"epargne"},
    epargnePilotee:{label:"Épargne pilotée",groupe:"epargne"}, economie:{label:"Économie + Pro",groupe:"epargne"},
    lcl:{label:"LCL (tampon)",groupe:"epargne"},
    // Investissement
    pea:{label:"PEA",groupe:"invest"}, coinbase:{label:"Coinbase",groupe:"invest"}, cto:{label:"CTO Bourso",groupe:"invest"},
    assuVieGreenGot:{label:"Assu-vie GreenGot",groupe:"invest"}, greengotActions:{label:"Actions Greengot",groupe:"invest"},
    lita:{label:"Lita.co solidaire",groupe:"invest"}, timeplanet:{label:"Time for the Planet",groupe:"invest"},
    per:{label:"PER",groupe:"invest"}, hoplunch:{label:"Hoplunch",groupe:"invest"},
    lclCoinbase:{label:"LCL / Coinbase",groupe:"invest"},
  };

  const GROUPES = {
    revenu:{label:"Revenus", cible:null},
    besoin:{label:"Besoins", cible:50},
    desir: {label:"Désirs",  cible:30},
    epargne:{label:"Épargne", cible:null},   // épargne + invest = 20 %
    invest:{label:"Investissement", cible:null},
  };
  const ORDRE = ["revenu","besoin","desir","epargne","invest"];

  /* ---------- Stockage local ---------- */
  const K = { years:"gl_years_v1", overlays:"gl_overlays_v1", tags:"gl_tags_v1", bank:"gl_tagbank_v1", pf:"gl_portfolio_v1" };
  const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? def; } catch { return def; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("Stockage indisponible", e); } };

  let YEARS    = load(K.years, {});      // YEARS[year] = { soldeDepart, lignes:{id:[12]}, soldeReel:[12] }
  let overlays = load(K.overlays, {});
  let tags     = load(K.tags, {});
  let tagBank  = load(K.bank, {});
  let PF       = load(K.pf, { accounts: [] });
  if (!PF.accounts) PF = { accounts: [] };

  // Banque d'étiquettes par catégorie (enrichie à la volée)
  const SEED_TAGS = {
    revenu: ["APL","Prime","Remboursement","Salaire","Vente","Cadeau reçu","Exceptionnel"],
    besoin: ["Carrefour","Super U","Leclerc","Monoprix","Lidl","TGTG","Icee","Naturalia","Biocoop","Boulangerie","Loyer","Assurance","Téléphone","Électricité","Banque","Pharmacie","Kiné"],
    desir:  ["Restau","Bar","Escalade","Voyage","Décathlon","Fnac","Cinéma","FDJ","Cadeau","Essence","TAN","SNCF","Vélo"],
    epargne:["LDDS","LEP","CEL","PEL","PEE","Assurance vie","Épargne pilotée"],
    invest: ["PEA","Coinbase","CTO","Greengot","Actions Greengot","Lita","Time for the Planet","PER"],
  };
  Object.keys(SEED_TAGS).forEach(g => { if (!tagBank[g]) tagBank[g] = SEED_TAGS[g].slice(); });
  save(K.bank, tagBank);

  /* ---------- État ---------- */
  let anneeCourante = null, moisCourant = 0;
  function refreshAnnees() {
    const ys = Object.keys(YEARS).map(Number).sort((a,b)=>a-b);
    if (!ys.includes(anneeCourante)) anneeCourante = ys[ys.length-1] ?? null;
    return ys;
  }

  /* ---------- Helpers valeurs ---------- */
  const fmtNb = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const fmt = n => (n===null||n===undefined||isNaN(n)) ? "" : fmtNb.format(Math.round(n)) + " €";
  const signe = n => n>0 ? "pos" : n<0 ? "neg" : "";

  function base(y,id,m){ const d=YEARS[y]; if(!d||!d.lignes[id]) return null; const v=d.lignes[id][m]; return v===undefined?null:v; }
  function hasOverlay(y,id,m){ return overlays[y]&&overlays[y][id]&&overlays[y][id][m]!==undefined; }
  function val(y,id,m){ if(hasOverlay(y,id,m)) return overlays[y][id][m]; const b=base(y,id,m); return b===null?0:b; }
  function valDisplay(y,id,m){ if(hasOverlay(y,id,m)) return overlays[y][id][m]; return base(y,id,m); }

  const postesGroupe = g => Object.keys(POSTES).filter(id=>POSTES[id].groupe===g);
  function totalGroupeMois(y,g,m){ return postesGroupe(g).reduce((s,id)=>s+val(y,id,m),0); }
  function totalGroupeAnnee(y,g){ let s=0; for(let m=0;m<12;m++) s+=totalGroupeMois(y,g,m); return s; }
  function posteUtilise(y,id){
    const d=YEARS[y]; const enBase=d&&d.lignes[id]&&d.lignes[id].some(v=>v!==null&&v!==0);
    const enOv=overlays[y]&&overlays[y][id]&&Object.keys(overlays[y][id]).length;
    return enBase||enOv;
  }

  /* ====================================================================
     Tableau de bord
     ==================================================================== */
  let showAllPostes = false;       // afficher aussi les postes vides (pour les remplir)
  let dashBound = false;           // délégation d'événements posée une seule fois

  function renderDashboard() {
    const host = el("[data-fill='dashboard']");
    if (anneeCourante === null) {
      host.innerHTML = `
        <div class="empty">
          <h2>Aucune année importée</h2>
          <p>Importe une année (fichier fourni) depuis l'onglet « Données » pour commencer,<br>
             ou restaure une sauvegarde globale.</p>
          <button class="btn" id="goData">Aller à « Données »</button>
        </div>`;
      el("#goData").onclick = () => activerTab("data");
      return;
    }
    const y = anneeCourante;
    const rev = totalGroupeAnnee(y,"revenu"), bes = totalGroupeAnnee(y,"besoin"),
          des = totalGroupeAnnee(y,"desir"), epa = totalGroupeAnnee(y,"epargne"), inv = totalGroupeAnnee(y,"invest");
    const solde = rev - bes - des - epa - inv;
    const pct = x => rev>0 ? Math.round(x/rev*100) : 0;
    const kpi = (cls,label,value,sub)=>`
      <div class="kpi kpi--${cls}"><div class="kpi__label">${label}</div>
      <div class="kpi__value num ${signe(value)}">${fmt(value)}</div><div class="kpi__sub">${sub}</div></div>`;
    const kpis = `<div class="kpis">
      ${kpi("revenu","Revenus "+y,rev,"Total encaissé")}
      ${kpi("besoin","Besoins",bes,`${pct(bes)} % · cible 50 %`)}
      ${kpi("desir","Désirs",des,`${pct(des)} % · cible 30 %`)}
      ${kpi("epargne","Épargne",epa,`${pct(epa)} % des revenus`)}
      ${kpi("invest","Investissement",inv,`${pct(inv)} % des revenus`)}
      ${kpi(solde>=0?"epargne":"desir","Solde annuel",solde,"Revenus − dépenses − épargne")}
    </div>`;

    const toolbar = `
      <div class="toolbar">
        <button class="btn" id="newYear">+ Créer une année</button>
        <label class="check"><input type="checkbox" id="showAll" ${showAllPostes?"checked":""}> Afficher tous les postes</label>
        <button class="btn btn--ghost" id="resetYear">Réinitialiser mes modifs ${y}</button>
        <span class="hint">Clique une cellule pour modifier le budget. Vide = retour à la valeur d'origine.</span>
      </div>`;

    host.innerHTML = kpis + toolbar + ledgerAnnuel(y) + patrimoineBlock();

    el("#newYear").onclick = creerAnnee;
    el("#showAll").onchange = e => { showAllPostes = e.target.checked; renderDashboard(); };
    el("#resetYear").onclick = () => {
      if (!overlays[y] || !Object.keys(overlays[y]).length) return;
      if (!confirm(`Effacer tes modifications de ${y} et revenir aux valeurs importées ?`)) return;
      delete overlays[y]; save(K.overlays, overlays); renderAll();
    };

    if (!dashBound) {
      dashBound = true;
      el("#panel-dashboard").addEventListener("change", e => {
        const inp = e.target.closest("input[data-cell]");
        if (!inp) return;
        const [id, mStr] = inp.dataset.cell.split("|"); const m = +mStr;
        const raw = inp.value.trim();
        if (raw === "") clearOverlay(anneeCourante, id, m);
        else setOverlay(anneeCourante, id, m, parseFloat(raw.replace(",", ".")) || 0);
        renderDashboard();
      });
    }
  }

  function setOverlay(y,id,m,n){ overlays[y]=overlays[y]||{}; overlays[y][id]=overlays[y][id]||{}; overlays[y][id][m]=n; save(K.overlays,overlays); }
  function clearOverlay(y,id,m){ if(hasOverlay(y,id,m)){ delete overlays[y][id][m]; if(!Object.keys(overlays[y][id]).length) delete overlays[y][id]; save(K.overlays,overlays); } }

  function ledgerAnnuel(y) {
    const head = `<thead><tr><th>Poste</th>${MOIS.map((m,i)=>`<th${i===moisCourant?' class="col-now"':''}>${m.slice(0,3)}</th>`).join("")}<th class="col-total">Total</th></tr></thead>`;
    let body = "";
    ORDRE.forEach(g => {
      const ids = postesGroupe(g).filter(id => showAllPostes || posteUtilise(y,id));
      if (!ids.length) return;
      body += `<tr class="group-row is-${g}"><th colspan="14">${GROUPES[g].label}</th></tr>`;
      ids.forEach(id => {
        let tot=0; const cells=[];
        for(let m=0;m<12;m++){
          const v = valDisplay(y,id,m); if(v!==null) tot+=v;
          const ov = hasOverlay(y,id,m) ? " is-edited" : "";
          cells.push(`<td class="cell${ov}"><input class="cell-input ${signe(v||0)}" data-cell="${id}|${m}" inputmode="decimal" value="${v===null?"":v}" aria-label="${POSTES[id].label} ${MOIS[m]}"></td>`);
        }
        body += `<tr><th><span class="dot dot--${g}"></span>${POSTES[id].label}</th>${cells.join("")}<td class="col-total ${signe(tot)}">${fmt(tot)}</td></tr>`;
      });
      const tm=[]; let ta=0;
      for(let m=0;m<12;m++){ const t=totalGroupeMois(y,g,m); tm.push(t); ta+=t; }
      body += `<tr class="total-row"><th>Total ${GROUPES[g].label.toLowerCase()}</th>${tm.map(t=>`<td class="${signe(t)}">${fmt(t)}</td>`).join("")}<td class="col-total ${signe(ta)}">${fmt(ta)}</td></tr>`;
    });
    return `<div class="ledger-wrap"><table class="ledger ledger--edit"><caption>Grand livre ${y} — éditable</caption>${head}<tbody>${body}</tbody></table></div>`;
  }

  // Créer une année : valeurs par défaut = moyenne mensuelle de l'an passé (objectif)
  function creerAnnee() {
    const ys = Object.keys(YEARS).map(Number).sort((a,b)=>a-b);
    const src = anneeCourante;
    const defaut = (ys.length ? Math.max(...ys) : new Date().getFullYear()) + 1;
    const saisie = prompt("Créer quelle année ? (les budgets seront initialisés sur la moyenne de "+src+")", String(defaut));
    if (!saisie) return;
    const ny = parseInt(saisie, 10);
    if (isNaN(ny)) return;
    if (YEARS[ny] && !confirm(`L'année ${ny} existe déjà. La remplacer par une base moyenne de ${src} ?`)) return;

    const lignes = {};
    Object.keys(POSTES).forEach(id => {
      if (!posteUtilise(src, id)) return;
      let s=0, n=0;
      for (let m=0;m<12;m++){ const v=valDisplay(src,id,m); if (v!==null){ s+=v; n++; } }
      if (n>0){ const moy = Math.round(s/n); lignes[id] = Array(12).fill(moy); }
    });
    const sr = YEARS[src] && YEARS[src].soldeReel || [];
    const dep = [...sr].reverse().find(v=>v!==null && v!==undefined);
    YEARS[ny] = { soldeDepart: dep ?? 0, lignes, soldeReel: [] };
    save(K.years, YEARS);
    anneeCourante = ny; moisCourant = 0;
    initYearSelect(); renderAll();
    activerTab("dashboard");
  }

  /* ====================================================================
     Placeholders (remplis aux lots suivants)
     ==================================================================== */
  /* ====================================================================
     Vue mensuelle (Lot D)
     ==================================================================== */
  /* ====================================================================
     Vue mensuelle (Lot G) — Prévu (renvoi tableau de bord) / Réel (étiquettes) / Écart
     ==================================================================== */
  const EXPANDED = new Set();
  let monthBound = false;

  // Réel d'un poste = somme des étiquettes ; sinon valeur importée (réalisé historique).
  function reelVal(y,id,m){ const s=tagsSum(y,m,id); if(s!==null) return s; const b=base(y,id,m); return b===null?0:b; }
  function reelGroupeMois(y,g,m){ return postesGroupe(g).reduce((s,id)=>s+reelVal(y,id,m),0); }

  // Solde du compte : réalisé (historique importé) pour passé/en cours, prévisionnel ensuite.
  function moisCourantReel(y){ const n=new Date(),cy=n.getFullYear(); if(y<cy) return 11; if(y>cy) return -1; return n.getMonth(); }
  function netMois(y,m){ return totalGroupeMois(y,"revenu",m)-totalGroupeMois(y,"besoin",m)-totalGroupeMois(y,"desir",m)-totalGroupeMois(y,"epargne",m)-totalGroupeMois(y,"invest",m); }
  function soldeBanque(y){
    const dep=YEARS[y].soldeDepart||0, sr=YEARS[y].soldeReel||[], cmi=moisCourantReel(y);
    const bal=[]; let anchor=dep;
    for(let m=0;m<12;m++){
      const realized = (sr[m]!==null&&sr[m]!==undefined) && (cmi===11 || m<=cmi);
      if(realized){ bal[m]=sr[m]; anchor=sr[m]; }
      else { anchor += netMois(y,m); bal[m]=anchor; }
    }
    return { bal, cmi };
  }

  function renderMonth(){
    const host = el("[data-fill='month']");
    if (anneeCourante === null) { host.innerHTML = `<div class="empty"><p>Importe d'abord une année.</p></div>`; return; }
    const y = anneeCourante, m = moisCourant;

    const chips = MOIS.map((mn,i)=>`<button class="mchip ${i===m?'is-active':''}" data-month="${i}">${mn.slice(0,3)}</button>`).join("");
    const caption = `
      <div class="month-caption">
        <span class="month-caption__name">${MOIS[m]} ${y}</span>
        <label class="check"><input type="checkbox" id="mShowAll" ${showAllPostes?"checked":""}> tous les postes</label>
      </div>`;

    const blocks = ORDRE.map(g=>blockHtml(y,m,g)).join("");

    // Synthèse + solde du compte sous le mois
    const { bal, cmi } = soldeBanque(y);
    const solde = bal[m];
    const realizedM = (cmi===11) || (m<=cmi);
    let resteP=0, resteR=0;
    ["besoin","desir","epargne","invest"].forEach(g=>postesGroupe(g).forEach(id=>{ const e=val(y,id,m)-reelVal(y,id,m); if(e>0) resteP+=e; }));
    postesGroupe("revenu").forEach(id=>{ const e=val(y,id,m)-reelVal(y,id,m); if(e>0) resteR+=e; });
    const summary = `
      <section class="month-summary">
        <div class="ms-card ms-card--solde">
          <span class="ms-card__label">Solde du compte · fin ${MOIS[m]}</span>
          <strong class="num ${signe(solde)}">${fmt(solde)}</strong>
          <em class="ms-card__tag">${realizedM?"réalisé":"prévisionnel"}</em>
        </div>
        <div class="ms-card"><span class="ms-card__label">Reste à payer</span><strong class="num">${fmt(resteP)}</strong></div>
        <div class="ms-card"><span class="ms-card__label">Reste à recevoir</span><strong class="num">${fmt(resteR)}</strong></div>
      </section>`;

    host.innerHTML = `<div class="mchips" role="tablist">${chips}</div>${caption}<div class="blocks">${blocks}</div>${summary}`;
    if (!monthBound) { monthBound = true; bindMonth(); }
  }

  function blockHtml(y,m,g){
    const ids = postesGroupe(g).filter(id => showAllPostes || posteUtilise(y,id) || base(y,id,m)!==null);
    const reelG = reelGroupeMois(y,g,m), prevuG = totalGroupeMois(y,g,m);
    const bubbles = ids.length ? ids.map(id=>bubbleHtml(y,m,id,g)).join("") : `<p class="muted" style="padding:.4rem .2rem">Aucun poste — coche « tous les postes » pour en ajouter.</p>`;
    return `
      <section class="mblock mblock--${g}">
        <header class="mblock__head">
          <span class="mblock__title">${GROUPES[g].label}</span>
          <span class="mblock__sum"><span class="num ${signe(reelG)}">${fmt(reelG)}</span> <span class="mblock__prevu">/ ${fmt(prevuG)}</span></span>
        </header>
        <div class="mblock__body">${bubbles}</div>
      </section>`;
  }

  function bubbleHtml(y,m,id,g){
    const prevu = val(y,id,m);
    const reel  = reelVal(y,id,m);
    const ecart = prevu - reel;
    const open  = EXPANDED.has(id);
    const bag   = (tags[y]&&tags[y][m]&&tags[y][m][id]) || {};
    const nb    = Object.keys(bag).length;
    const over  = reel > prevu;
    const resteLabel = g==="revenu" ? (over?"reçu en plus":"reste à recevoir") : (over?"dépassement":"reste à payer");
    const detail = open ? tagDetail(y,m,id,g,bag) : "";
    return `
      <div class="bubble bubble--${g}${open?' is-open':''}">
        <button class="bubble__head" data-toggle="${id}" aria-expanded="${open}">
          <span class="bubble__name">${POSTES[id].label}${nb?` <span class="mline__badge">${nb}</span>`:""}</span>
          <span class="bubble__prevu">prévu <strong class="num">${fmt(prevu)}</strong> <span class="bubble__chev">▸</span></span>
        </button>
        ${detail}
        <div class="bubble__foot">
          <span class="bubble__reel">réel <strong class="num ${signe(reel)}">${fmt(reel)}</strong></span>
          <span class="bubble__ecart ${over?'neg':'pos'}">${resteLabel} <strong class="num">${fmt(Math.abs(ecart))}</strong></span>
        </div>
      </div>`;
  }

  function tagDetail(y,m,id,g,bag){
    const entries = Object.keys(bag);
    const rows = entries.map(label=>{
      const a = bag[label];
      return `<div class="tagrow">
        <span class="tagrow__name">${label}</span>
        <input class="tagrow__amt num" data-tagamt="${id}|${label}" inputmode="decimal" value="${a===null||a===undefined?"":a}" placeholder="€">
        <button class="tagrow__del" data-tagdel="${id}|${label}" aria-label="Retirer">×</button>
      </div>`;
    }).join("");
    const sugg = (tagBank[g]||[]).map(t=>`<option value="${t}">`).join("");
    return `
      <div class="tagdetail">
        ${rows || `<p class="muted" style="margin:.2rem 0">Aucune dépense saisie. Ajoute une étiquette pour reporter le réel.</p>`}
        <div class="tagadd">
          <input class="tagadd__name" list="bank-${g}" data-addname="${id}" placeholder="étiquette (ex. Carrefour)">
          <datalist id="bank-${g}">${sugg}</datalist>
          <input class="tagadd__amt num" data-addamt="${id}" inputmode="decimal" placeholder="€">
          <button class="btn btn--xs" data-addbtn="${id}">+ ajouter</button>
        </div>
      </div>`;
  }

  function tagsSum(y,m,id){
    const t = tags[y]&&tags[y][m]&&tags[y][m][id]; if(!t) return null;
    let s=0, any=false; Object.values(t).forEach(v=>{ if(typeof v==="number"&&!isNaN(v)){s+=v;any=true;} }); return any?s:null;
  }
  function ensureBag(y,m,id){ tags[y]=tags[y]||{}; tags[y][m]=tags[y][m]||{}; tags[y][m][id]=tags[y][m][id]||{}; }

  function bindMonth(){
    const panel = el("#panel-month");

    panel.addEventListener("click", e => {
      const mc = e.target.closest("[data-month]");
      if (mc){ moisCourant = +mc.dataset.month; renderMonth(); return; }

      const tg = e.target.closest("[data-toggle]");
      if (tg){ const id=tg.dataset.toggle; EXPANDED.has(id)?EXPANDED.delete(id):EXPANDED.add(id); renderMonth(); return; }

      const del = e.target.closest("[data-tagdel]");
      if (del){ const [id,label]=del.dataset.tagdel.split("|"); if(tags[anneeCourante]?.[moisCourant]?.[id]){ delete tags[anneeCourante][moisCourant][id][label]; save(K.tags,tags); renderMonth(); } return; }

      const add = e.target.closest("[data-addbtn]");
      if (add){
        const id=add.dataset.addbtn;
        const nameInp = panel.querySelector(`[data-addname="${id}"]`);
        const amtInp  = panel.querySelector(`[data-addamt="${id}"]`);
        const name=(nameInp.value||"").trim(); if(!name) return;
        const amt = amtInp.value.trim()===""?null:(parseFloat(amtInp.value.replace(",","."))||0);
        const g = POSTES[id].groupe;
        tagBank[g]=tagBank[g]||[]; if(!tagBank[g].includes(name)){ tagBank[g].push(name); tagBank[g].sort((a,b)=>a.localeCompare(b,'fr')); save(K.bank,tagBank); }
        ensureBag(anneeCourante,moisCourant,id); tags[anneeCourante][moisCourant][id][name]=amt; save(K.tags,tags);
        renderMonth(); return;
      }
    });

    panel.addEventListener("change", e => {
      const ta = e.target.closest("[data-tagamt]");
      if (ta){
        const [id,label]=ta.dataset.tagamt.split("|"); const raw=ta.value.trim();
        ensureBag(anneeCourante,moisCourant,id);
        tags[anneeCourante][moisCourant][id][label]= raw===""?null:(parseFloat(raw.replace(",","."))||0);
        save(K.tags,tags); renderMonth(); return;
      }
    });

    panel.addEventListener("input", e => {
      if (e.target.id==="mShowAll"){ showAllPostes=e.target.checked; renderMonth(); }
    });
  }
  /* ====================================================================
     Portefeuille (Lot E)
     ==================================================================== */
  // Types de compte → poste budget pour le contrôle de cohérence
  const TYPES_COMPTE = {
    pea:        { label:"PEA",            poste:"pea" },
    pee:        { label:"PEE",            poste:"pee" },
    av_greengot:{ label:"Assurance-vie",  poste:"assuVieGreenGot" },
    crypto:     { label:"Crypto",         poste:"coinbase" },
    cto:        { label:"CTO",            poste:"cto" },
    livret:     { label:"Livret",         poste:"ldds" },
    autre:      { label:"Autre",          poste:"" },
  };
  let pfBound = false;

  // --- Parseur CSV tolérant (FR) ---
  function frNum(s){
    if (s===null||s===undefined) return NaN;
    let t = String(s).replace(/\u00a0/g," ").replace(/[€%\s]/g,"").trim();
    if (t==="") return NaN;
    const hasC = t.includes(","), hasD = t.includes(".");
    if (hasC && hasD) t = t.replace(/\./g,"").replace(",","."); // . = milliers, , = décimal
    else if (hasC) t = t.replace(",",".");                       // , = décimal
    // sinon on garde le . tel quel
    const n = parseFloat(t);
    return isNaN(n) ? NaN : n;
  }
  function splitLine(line, delim){
    const out=[]; let cur="", q=false;
    for (let i=0;i<line.length;i++){ const c=line[i];
      if (c==='"'){ if(q && line[i+1]==='"'){ cur+='"'; i++; } else q=!q; }
      else if (c===delim && !q){ out.push(cur); cur=""; }
      else cur+=c;
    }
    out.push(cur); return out.map(s=>s.trim());
  }
  function norm(s){ return (s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
  function detectDelim(text){
    const l = text.split(/\r?\n/).find(x=>x.trim()) || "";
    const counts = { ";":(l.match(/;/g)||[]).length, "\t":(l.match(/\t/g)||[]).length, ",":(l.match(/,/g)||[]).length };
    return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0] || ";";
  }
  function parseCSV(text){
    const delim = detectDelim(text);
    const lines = text.split(/\r?\n/).filter(l=>l.trim()!=="");
    if (!lines.length) return [];
    // Trouver la ligne d'en-tête : celle contenant un mot-clé de libellé + un de valeur/quantité
    const KW = {
      label:["libelle","valeur","instrument","nom","support","fonds","actif","designation","titre","name"],
      isin:["isin","code"],
      qty:["quantite","qte","nombre","parts","nb","qty","quantity"],
      pru:["pru","revient","achat","pmp","moyen","buying"],
      last:["cours","dernier","liquidative","vl","prix","last"],
      value:["valorisation","montant","marche","evaluation","total","evalue","amount"],
      pv:["+/-","plus-value","plus value","plusvalue","plus","pv","latente","gain","amountvariation"],
    };
    let hi=0, header=null;
    for (let i=0;i<Math.min(lines.length,8);i++){
      const cols = splitLine(lines[i],delim).map(norm);
      const hasLabel = cols.some(c=>KW.label.some(k=>c.includes(k)));
      const hasNum = cols.some(c=>[...KW.qty,...KW.value,...KW.last,...KW.pru].some(k=>c.includes(k)));
      if (hasLabel && hasNum){ hi=i; header=cols; break; }
    }
    if (!header) header = splitLine(lines[0],delim).map(norm);
    const find = keys => header.findIndex(c=>keys.some(k=>c.includes(k)));
    const idx = {
      label:find(KW.label), isin:find(KW.isin), qty:find(KW.qty),
      pru:find(KW.pru), last:find(KW.last), value:find(KW.value), pv:find(KW.pv),
    };
    if (idx.label<0) idx.label = 0;
    const rows=[];
    for (let i=hi+1;i<lines.length;i++){
      const c = splitLine(lines[i],delim);
      const label = (c[idx.label]||"").trim();
      if (!label) continue;
      const qty = idx.qty>=0?frNum(c[idx.qty]):NaN;
      const pru = idx.pru>=0?frNum(c[idx.pru]):NaN;
      const last= idx.last>=0?frNum(c[idx.last]):NaN;
      let value = idx.value>=0?frNum(c[idx.value]):NaN;
      let pv    = idx.pv>=0?frNum(c[idx.pv]):NaN;
      if (isNaN(value)) value = (!isNaN(qty)&&!isNaN(last))?qty*last : (!isNaN(qty)&&!isNaN(pru)?qty*pru:NaN);
      if (isNaN(pv) && !isNaN(qty)&&!isNaN(pru)&&!isNaN(value)) pv = value - qty*pru;
      if (isNaN(value)) continue;
      rows.push({ label, isin:idx.isin>=0?(c[idx.isin]||"").trim():"", qty:isNaN(qty)?null:qty,
                  pru:isNaN(pru)?null:pru, last:isNaN(last)?null:last, value, pv:isNaN(pv)?null:pv });
    }
    return rows;
  }

  // --- Agrégats compte ---
  const accValue = a => a.positions&&a.positions.length ? a.positions.reduce((s,p)=>s+(p.value||0),0) : (a.manual?.value||0);
  const accPV    = a => a.positions&&a.positions.length ? a.positions.reduce((s,p)=>s+(p.pv||0),0)
                        : (a.manual && a.manual.invested!=null ? (a.manual.value||0)-(a.manual.invested||0) : 0);
  const accCost  = a => accValue(a) - accPV(a);
  function versementsCumul(posteId){
    if (!posteId) return null;
    let s=0; Object.keys(YEARS).map(Number).forEach(y=>{ for(let m=0;m<12;m++) s+=val(y,posteId,m); });
    return s;
  }

  function renderPortfolio(){
    const host = el("[data-fill='portfolio']");
    const accs = PF.accounts;
    const totalVal = accs.reduce((s,a)=>s+accValue(a),0);
    const totalPV  = accs.reduce((s,a)=>s+accPV(a),0);

    const cards = accs.map(a=>{
      const v=accValue(a), pv=accPV(a), cost=accCost(a);
      const vers = versementsCumul(a.poste);
      const coh = vers!=null ? `
        <div class="acc__coherence">
          <span>Versements cumulés (budget) : <strong class="num">${fmt(vers)}</strong></span>
          <span>Capital investi (réel) : <strong class="num">${fmt(cost)}</strong></span>
          <span class="${Math.abs(vers-cost)<=Math.max(50,0.05*Math.abs(cost))?'pos':'neg'}">Écart : <strong class="num">${fmt(vers-cost)}</strong></span>
        </div>` : "";
      const posTable = (a.positions&&a.positions.length) ? `
        <div class="ledger-wrap"><table class="ledger"><thead><tr>
          <th>Ligne</th><th>Qté</th><th>PRU</th><th>Cours</th><th class="col-total">Valorisation</th><th>+/- value</th>
        </tr></thead><tbody>
        ${a.positions.map(p=>`<tr><th>${p.label}</th>
          <td>${p.qty??""}</td><td>${p.pru!=null?fmt(p.pru):""}</td><td>${p.last!=null?fmt(p.last):""}</td>
          <td class="col-total">${fmt(p.value)}</td><td class="${signe(p.pv||0)}">${p.pv!=null?fmt(p.pv):""}</td></tr>`).join("")}
        </tbody></table></div>` : (a.manual ? `<p class="muted">Saisie manuelle : valeur ${fmt(a.manual.value)}${a.manual.invested!=null?` · investi ${fmt(a.manual.invested)}`:""}.</p>` : `<p class="muted">Aucune position importée.</p>`);
      return `
        <div class="data-card acc">
          <div class="acc__head">
            <div><h3>${a.name}</h3><span class="muted">${TYPES_COMPTE[a.type]?.label||a.type}${a.updatedAt?` · maj ${a.updatedAt}`:""}</span></div>
            <button class="del" data-delacc="${a.id}">supprimer</button>
          </div>
          <div class="acc__totals">
            <span>Valeur : <strong class="num">${fmt(v)}</strong></span>
            <span>+/- value : <strong class="num ${signe(pv)}">${fmt(pv)}</strong></span>
          </div>
          ${coh}
          ${posTable}
          <div class="field" style="margin-top:.6rem">
            <input type="file" accept=".csv,text/csv" data-csv="${a.id}">
            <button class="btn btn--xs" data-import="${a.id}">Importer CSV</button>
            <button class="btn btn--ghost btn--xs" data-manual="${a.id}">Saisie manuelle</button>
          </div>
          <p class="msg" data-accmsg="${a.id}"></p>
        </div>`;
    }).join("");

    const typeOpts = Object.keys(TYPES_COMPTE).map(t=>`<option value="${t}">${TYPES_COMPTE[t].label}</option>`).join("");
    host.innerHTML = `
      <div class="pf-head">
        <div class="kpi kpi--invest"><div class="kpi__label">Patrimoine total</div><div class="kpi__value num">${fmt(totalVal)}</div><div class="kpi__sub">${accs.length} compte(s)</div></div>
        <div class="kpi ${totalPV>=0?'kpi--epargne':'kpi--desir'}"><div class="kpi__label">+/- value globale</div><div class="kpi__value num ${signe(totalPV)}">${fmt(totalPV)}</div><div class="kpi__sub">latente, tous comptes</div></div>
      </div>
      <div class="data-card" style="margin:1rem 0">
        <h3>Ajouter un compte</h3>
        <div class="field">
          <input id="accName" placeholder="Nom (ex. PEA Boursobank)">
          <select id="accType">${typeOpts}</select>
          <button class="btn" id="addAcc">Ajouter</button>
        </div>
        <p class="muted">Tu pourras ensuite importer son CSV (PEA, PEE, GreenGot, Coinbase…). Le format est détecté automatiquement ; si une colonne manque, dis-le-moi et j'ajuste.</p>
      </div>
      <div class="data-grid">${cards || `<p class="muted">Aucun compte pour l'instant.</p>`}</div>`;

    if (!pfBound){ pfBound=true; bindPortfolio(); }
  }

  function bindPortfolio(){
    const panel = el("#panel-portfolio");
    panel.addEventListener("click", e => {
      const add = e.target.closest("#addAcc");
      if (add){
        const name=(el("#accName").value||"").trim(); if(!name) return;
        const type=el("#accType").value;
        PF.accounts.push({ id:"a"+Date.now(), name, type, poste:TYPES_COMPTE[type]?.poste||"", positions:[], manual:null, updatedAt:"" });
        save(K.pf,PF); renderPortfolio(); return;
      }
      const del = e.target.closest("[data-delacc]");
      if (del){ const id=del.dataset.delacc; if(confirm("Supprimer ce compte ?")){ PF.accounts=PF.accounts.filter(a=>a.id!==id); save(K.pf,PF); renderPortfolio(); renderDashboard(); } return; }

      const imp = e.target.closest("[data-import]");
      if (imp){
        const id=imp.dataset.import, f=panel.querySelector(`[data-csv="${id}"]`).files[0];
        const msg=panel.querySelector(`[data-accmsg="${id}"]`);
        if(!f){ msg.className="msg err"; msg.textContent="Choisis un fichier CSV."; return; }
        const r=new FileReader();
        r.onload=()=>{ try{
          const rows=parseCSV(r.result);
          if(!rows.length){ msg.className="msg err"; msg.textContent="Aucune ligne reconnue. Envoie-moi l'en-tête du CSV et j'ajuste le parseur."; return; }
          const a=PF.accounts.find(x=>x.id===id);
          a.positions=rows; a.manual=null; a.updatedAt=new Date().toLocaleDateString("fr-FR");
          save(K.pf,PF); renderPortfolio(); renderDashboard();
        } catch{ msg.className="msg err"; msg.textContent="CSV illisible."; } };
        r.readAsText(f,"utf-8");
        return;
      }
      const man = e.target.closest("[data-manual]");
      if (man){
        const id=man.dataset.manual; const a=PF.accounts.find(x=>x.id===id);
        const v=prompt("Valeur actuelle du compte (€) :", a.manual?.value??""); if(v===null) return;
        const inv=prompt("Montant total investi (€, optionnel pour la +/- value) :", a.manual?.invested??"");
        a.positions=[]; a.manual={ value:frNum(v)||0, invested: inv===null||inv===""?null:(frNum(inv)||0) };
        a.updatedAt=new Date().toLocaleDateString("fr-FR");
        save(K.pf,PF); renderPortfolio(); renderDashboard(); return;
      }
    });
  }

  // Bloc patrimoine injecté en bas du tableau de bord
  function patrimoineBlock(){
    const accs = PF.accounts; if(!accs.length) return "";
    const totalVal=accs.reduce((s,a)=>s+accValue(a),0), totalPV=accs.reduce((s,a)=>s+accPV(a),0);
    const maj = accs.map(a=>a.updatedAt).filter(Boolean).sort().slice(-1)[0] || "—";
    const rows = accs.map(a=>{
      const vers=versementsCumul(a.poste), cost=accCost(a);
      const ec = vers!=null ? `<td class="${Math.abs(vers-cost)<=Math.max(50,0.05*Math.abs(cost))?'pos':'neg'}">${fmt(vers-cost)}</td>` : `<td class="muted">—</td>`;
      return `<tr><th>${a.name}</th><td>${fmt(accValue(a))}</td><td class="${signe(accPV(a))}">${fmt(accPV(a))}</td>${ec}</tr>`;
    }).join("");
    return `
      <section style="margin-top:1.5rem">
        <h2 style="font-family:var(--display);font-size:1.3rem;margin-bottom:.5rem">Patrimoine <span class="muted" style="font-size:.8rem">· données au ${maj}</span></h2>
        <div class="ledger-wrap"><table class="ledger"><thead><tr>
          <th>Compte</th><th>Valeur</th><th>+/- value</th><th>Écart vs versements budget</th>
        </tr></thead><tbody>${rows}
        <tr class="total-row"><th>Total</th><td>${fmt(totalVal)}</td><td class="${signe(totalPV)}">${fmt(totalPV)}</td><td></td></tr>
        </tbody></table></div>
        <p class="muted" style="margin-top:.4rem">L'« écart » compare les versements cumulés saisis dans ton budget au capital réellement investi (valeur − plus-value). Proche de 0 = cohérent.</p>
      </section>`;
  }

  /* ====================================================================
     Graphiques (Lot F) — Chart.js
     ==================================================================== */
  const CHARTS = {};
  let chartsSel = null;            // Set des postes sélectionnés (trésorerie)
  const PALETTE = ["#3e5c76","#b07a2b","#2e6e5e","#6b4e9e","#355e3b","#a23b2c","#2b6cb0","#8a6d3b","#1f7a6b","#7d5ba6","#b5651d","#4a7c59"];

  function destroyCharts(){ Object.values(CHARTS).forEach(c=>{ try{c.destroy();}catch{} }); }

  function renderCharts(){
    const host = el("[data-fill='charts']");
    if (typeof Chart === "undefined"){ host.innerHTML = `<div class="empty"><p>Chargement de la bibliothèque de graphiques… réessaie dans un instant.</p></div>`; return; }
    if (anneeCourante===null && !PF.accounts.length){ host.innerHTML = `<div class="empty"><p>Importe une année ou un compte pour voir des graphiques.</p></div>`; return; }
    destroyCharts();

    const y = anneeCourante;
    // postes épargne+invest réellement utilisés cette année
    const postesEpInv = y!=null ? [...postesGroupe("epargne"),...postesGroupe("invest")].filter(id=>posteUtilise(y,id)) : [];
    if (chartsSel===null) chartsSel = new Set(postesEpInv);

    const checks = postesEpInv.map(id=>`<label class="check"><input type="checkbox" data-selposte="${id}" ${chartsSel.has(id)?"checked":""}> ${POSTES[id].label}</label>`).join("");

    host.innerHTML = `
      <div class="charts-grid">
        <div class="data-card">
          <h3>Répartition du patrimoine</h3>
          ${PF.accounts.length ? `<canvas id="cDonut" height="220"></canvas>` : `<p class="muted">Ajoute des comptes dans l'onglet Portefeuille pour voir la répartition.</p>`}
        </div>
        <div class="data-card">
          <h3>Projection ${y??""} vers l'objectif 30 k€</h3>
          ${y!=null ? `<canvas id="cProj" height="220"></canvas>` : `<p class="muted">Sélectionne une année.</p>`}
        </div>
      </div>
      <div class="data-card" style="margin-top:1rem">
        <h3>Évolution cumulée — épargne & investissement ${y??""}</h3>
        <p class="muted">Cumul des versements mois après mois. Coche les postes à afficher.</p>
        <div class="charts-checks">${checks||'<span class="muted">Aucun poste cette année.</span>'}</div>
        ${y!=null ? `<canvas id="cTreso" height="260"></canvas>` : ""}
      </div>`;

    // --- Donut patrimoine ---
    if (PF.accounts.length){
      const accs = PF.accounts.filter(a=>accValue(a)>0);
      CHARTS.donut = new Chart(el("#cDonut"), {
        type:"doughnut",
        data:{ labels:accs.map(a=>a.name), datasets:[{ data:accs.map(a=>Math.round(accValue(a))), backgroundColor:accs.map((_,i)=>PALETTE[i%PALETTE.length]), borderWidth:2, borderColor:"#fff" }] },
        options:{ plugins:{ legend:{ position:"bottom" }, tooltip:{ callbacks:{ label:c=>`${c.label} : ${fmt(c.parsed)}` } } } }
      });
    }

    // --- Évolution cumulée (lignes par poste sélectionné) ---
    if (y!=null){
      const sel = postesEpInv.filter(id=>chartsSel.has(id));
      const datasets = sel.map((id,i)=>{
        let cum=0; const d=[];
        for(let m=0;m<12;m++){ cum+=val(y,id,m); d.push(Math.round(cum)); }
        const col=PALETTE[i%PALETTE.length];
        return { label:POSTES[id].label, data:d, borderColor:col, backgroundColor:col+"22", tension:.25, pointRadius:2, fill:false };
      });
      CHARTS.treso = new Chart(el("#cTreso"), {
        type:"line",
        data:{ labels:MOIS.map(m=>m.slice(0,3)), datasets },
        options:{ interaction:{mode:"index",intersect:false}, plugins:{ legend:{position:"bottom"}, tooltip:{ callbacks:{ label:c=>`${c.dataset.label} : ${fmt(c.parsed.y)}` } } },
          scales:{ y:{ ticks:{ callback:v=>fmtNb.format(v)+" €" } } } }
      });

      // --- Projection 30k ---
      const base = YEARS[y].soldeDepart || 0;
      const proj=[]; let cum=base;
      for(let m=0;m<12;m++){ cum += totalGroupeMois(y,"epargne",m)+totalGroupeMois(y,"invest",m); proj.push(Math.round(cum)); }
      const cible = Array(12).fill(30000);
      const finVal = proj[11];
      CHARTS.proj = new Chart(el("#cProj"), {
        type:"line",
        data:{ labels:MOIS.map(m=>m.slice(0,3)), datasets:[
          { label:"Capital cumulé (budget)", data:proj, borderColor:"#6b4e9e", backgroundColor:"#6b4e9e22", fill:true, tension:.25, pointRadius:2 },
          { label:"Objectif 30 k€", data:cible, borderColor:"#b07a2b", borderDash:[6,4], pointRadius:0, fill:false },
        ]},
        options:{ plugins:{ legend:{position:"bottom"},
          tooltip:{ callbacks:{ label:c=>`${c.dataset.label} : ${fmt(c.parsed.y)}` } },
          subtitle:{ display:true, text:`Fin ${y} estimée : ${fmt(finVal)} — ${finVal>=30000?"objectif atteint 🎯":"il manque "+fmt(30000-finVal)}`, color: finVal>=30000?"#2e6e5e":"#b23a28", font:{size:13,weight:"bold"} } },
          scales:{ y:{ ticks:{ callback:v=>fmtNb.format(v)+" €" } } } }
      });
    }

    el("#panel-charts").querySelectorAll("[data-selposte]").forEach(cb=>{
      cb.onchange = () => { const id=cb.dataset.selposte; cb.checked?chartsSel.add(id):chartsSel.delete(id); renderCharts(); };
    });
  }

  /* ====================================================================
     Onglet Données : import par année + sauvegarde globale
     ==================================================================== */
  function renderData() {
    const ys = Object.keys(YEARS).map(Number).sort((a,b)=>a-b);
    const annéesOptions = [];
    for (let yy=2020; yy<=2030; yy++) annéesOptions.push(`<option value="${yy}">${yy}</option>`);
    el("[data-fill='data']").innerHTML = `
      <div class="data-grid">
        <div class="data-card">
          <h3>Importer une année</h3>
          <p>Sélectionne le fichier d'année que je t'ai fourni, choisis l'année concernée, puis importe.
             Les données restent dans ce navigateur.</p>
          <div class="field">
            <input type="file" id="yearFile" accept="application/json,.json">
          </div>
          <div class="field">
            <label for="yearTarget">Année :</label>
            <select id="yearTarget">${annéesOptions.join("")}</select>
            <button class="btn" id="doYearImport">Importer cette année</button>
          </div>
          <p id="yearMsg" class="msg"></p>
          <ul class="year-list">
            ${ys.length ? ys.map(y=>`<li><span>${y}</span><button class="del" data-delyear="${y}">supprimer</button></li>`).join("") : `<li class="muted">Aucune année pour l'instant.</li>`}
          </ul>
        </div>
        <div class="data-card">
          <h3>Sauvegarde globale</h3>
          <p>Exporte tout (années, modifications, tags) dans un seul fichier. Si tu perds ton cache,
             réimporte-le ici pour tout récupérer.</p>
          <div class="field">
            <button class="btn" id="doExport">Exporter la sauvegarde</button>
          </div>
          <div class="field">
            <input type="file" id="backupFile" accept="application/json,.json">
            <button class="btn btn--ghost" id="doRestore">Restaurer</button>
          </div>
          <p id="backupMsg" class="msg"></p>
          <div class="field" style="margin-top:1rem">
            <button class="btn btn--ghost" id="doWipe">Effacer mes modifications</button>
          </div>
        </div>
      </div>`;

    // Import d'une année
    el("#doYearImport").onclick = () => {
      const f = el("#yearFile").files[0], msg = el("#yearMsg");
      if (!f) { msg.className="msg err"; msg.textContent="Choisis d'abord un fichier."; return; }
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(r.result);
          const obj = data.lignes ? data : (data.soldeDepart!==undefined ? data : null);
          if (!obj || !obj.lignes) throw new Error("format");
          const y = Number(el("#yearTarget").value);
          YEARS[y] = { soldeDepart: obj.soldeDepart ?? 0, lignes: obj.lignes, soldeReel: obj.soldeReel || [] };
          save(K.years, YEARS);
          anneeCourante = y; moisCourant = 0;
          msg.className="msg ok"; msg.textContent=`Année ${y} importée.`;
          initYearSelect(); renderAll();
        } catch { msg.className="msg err"; msg.textContent="Fichier illisible : ce n'est pas un fichier d'année valide."; }
      };
      r.readAsText(f);
    };
    // Préselectionner l'année si le fichier en contient une
    el("#yearFile").onchange = () => {
      const f = el("#yearFile").files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { const d=JSON.parse(r.result); if (d.year) el("#yearTarget").value=String(d.year); } catch {} };
      r.readAsText(f);
    };
    // Suppression d'une année
    els("[data-delyear]").forEach(b => b.onclick = () => {
      const y = Number(b.dataset.delyear);
      if (!confirm(`Supprimer l'année ${y} de ce navigateur ? (le fichier source reste disponible pour réimport)`)) return;
      delete YEARS[y]; delete overlays[y];
      save(K.years, YEARS); save(K.overlays, overlays);
      refreshAnnees(); initYearSelect(); renderAll();
    });

    // Sauvegarde globale
    el("#doExport").onclick = () => {
      const blob = new Blob([JSON.stringify({ years:YEARS, overlays, tags, tagBank, portfolio:PF }, null, 2)], { type:"application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `grand-livre-sauvegarde-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(a.href);
      el("#backupMsg").className="msg ok"; el("#backupMsg").textContent="Sauvegarde téléchargée.";
    };
    el("#doRestore").onclick = () => {
      const f = el("#backupFile").files[0], msg = el("#backupMsg");
      if (!f) { msg.className="msg err"; msg.textContent="Choisis un fichier de sauvegarde."; return; }
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (d.years) { YEARS=d.years; save(K.years,YEARS); }
          if (d.overlays) { overlays=d.overlays; save(K.overlays,overlays); }
          if (d.tags) { tags=d.tags; save(K.tags,tags); }
          if (d.tagBank) { tagBank=d.tagBank; save(K.bank,tagBank); }
          if (d.portfolio) { PF=d.portfolio; if(!PF.accounts) PF={accounts:[]}; save(K.pf,PF); }
          refreshAnnees(); msg.className="msg ok"; msg.textContent="Sauvegarde restaurée.";
          initYearSelect(); renderAll();
        } catch { msg.className="msg err"; msg.textContent="Fichier de sauvegarde illisible."; }
      };
      r.readAsText(f);
    };
    el("#doWipe").onclick = () => {
      if (!confirm("Effacer tes modifications et tags ? Les années importées restent intactes.")) return;
      overlays={}; tags={}; save(K.overlays,overlays); save(K.tags,tags);
      el("#backupMsg").className="msg ok"; el("#backupMsg").textContent="Modifications effacées.";
      renderAll();
    };
  }

  /* ====================================================================
     Échafaudage : année, onglets, menu
     ==================================================================== */
  function renderAll(){ renderDashboard(); renderMonth(); renderPortfolio(); renderCharts(); renderData(); }

  function initYearSelect() {
    const ys = refreshAnnees(), sel = el("#yearSelect");
    if (!ys.length) { sel.innerHTML = `<option>—</option>`; sel.disabled = true; return; }
    sel.disabled = false;
    sel.innerHTML = ys.map(y=>`<option value="${y}">${y}</option>`).join("");
    sel.value = anneeCourante;
    sel.onchange = () => { anneeCourante = Number(sel.value); moisCourant = 0; renderAll(); };
  }

  function activerTab(name) {
    els(".tab").forEach(b=>b.classList.toggle("is-active", b.dataset.tab===name));
    els(".panel").forEach(p=>p.classList.remove("is-active"));
    el("#panel-"+name).classList.add("is-active");
  }
  function initTabs(){ els(".tab").forEach(b=> b.onclick = ()=>activerTab(b.dataset.tab)); }

  function initMenu() {
    const burger = el("#burger"), menu = el("#appmenu");
    const close = () => { menu.hidden = true; burger.classList.remove("is-open"); burger.setAttribute("aria-expanded","false"); };
    const toggle = () => { const open = menu.hidden; menu.hidden = !open; burger.classList.toggle("is-open", open); burger.setAttribute("aria-expanded", String(open)); };
    burger.onclick = e => { e.stopPropagation(); toggle(); };
    document.addEventListener("click", e => { if (!menu.hidden && !menu.contains(e.target) && e.target!==burger) close(); });
    document.addEventListener("keydown", e => { if (e.key==="Escape") close(); });
  }

  const el = s => document.querySelector(s);
  const els = s => Array.from(document.querySelectorAll(s));

  /* ---------- Démarrage ---------- */
  refreshAnnees();
  initMenu();
  initTabs();
  initYearSelect();
  renderAll();

})();
