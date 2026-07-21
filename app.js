/* =========================================================
   Coach Muscu — app.js
   Toute la logique (stockage, rendu, interactions).
   Dépend de data.js (PROGRAM, PROGRAM2, PROGRAM_BLOCKS, BLOCK_ORDER,
   CODES, TRI, TRI_DISC, BRISTOL, SPORTS, PROG_OPTS, MUSCU_START, TRI_START).
   ========================================================= */
"use strict";
(function(){

  /* ---------------- Stockage local ---------------- */
  var KEY="suiviMuscu_v1";
  var STORAGE_OK=(function(){try{var k="__t_"+Date.now();localStorage.setItem(k,"1");localStorage.removeItem(k);return true;}catch(e){return false;}})();
  var memStore=null;
  function load(){if(!STORAGE_OK)return memStore;try{var r=localStorage.getItem(KEY);return r?JSON.parse(r):null;}catch(e){return null;}}
  function save(){try{var s=JSON.stringify(state);if(STORAGE_OK)localStorage.setItem(KEY,s);else memStore=state;}catch(e){}}

  var state=load()||{sessions:{},days:{},tri:{}};

  /* ============================================================
     STORE PARTAGÉ entre toutes les apps ricardospec.github.io
     (même origine = même localStorage). Clé dédiée, distincte de
     celle de chaque app, pour le calendrier commun :
       states   : { "YYYY-MM-DD": "cours|conge|repos|indispo" }  // voir DAY_TYPES (vocabulaire commun)
       events   : [ {id,start,end,label,type} ]
       deadlines: [ {id,date,label,icon} ]
     RÈGLE ANTI-CLOBBER : on relit TOUJOURS la version fraîche du
     disque avant d'écrire, et on ne modifie que l'entrée concernée
     (upsert par id). Aucune écriture n'écrase le store en bloc.
     ============================================================ */
  var PKEY="ricardospec_planning_v1";
  var pMem=null;
  function pLoad(){
    var o=null;
    if(STORAGE_OK){try{var r=localStorage.getItem(PKEY);o=r?JSON.parse(r):null;}catch(e){o=null;}}
    else o=pMem;
    if(!o||typeof o!=="object")o={};
    o.states=o.states||{};o.events=o.events||[];o.deadlines=o.deadlines||[];
    return o;
  }
  function pWrite(o){o.rev=Date.now();try{var s=JSON.stringify(o);if(STORAGE_OK)localStorage.setItem(PKEY,s);else pMem=o;}catch(e){}}
  function pMutate(fn){var o=pLoad();fn(o);pWrite(o);return o;}   // relit frais puis écrit

  function getDayState(iso){return pLoad().states[iso]||"";}
  function setDayState(iso,st){pMutate(function(o){if(st)o.states[iso]=st;else delete o.states[iso];});}
  function pDeadlines(){return pLoad().deadlines.slice().sort(function(a,b){return a.date<b.date?-1:1;});}
  function pEvents(){return pLoad().events;}
  function eventsOn(iso){return pEvents().filter(function(e){return iso>=e.start&&iso<=(e.end||e.start);});}

  /* Upsert idempotent des entrées statiques connues de CETTE app (deadlines/events),
     par id stable : présent une seule fois, ne duplique pas avec l'autre app. */
  function pEnsureSeed(){
    pMutate(function(o){
      o.removed=o.removed||{};
      (typeof DEADLINES!=="undefined"?DEADLINES:[]).forEach(function(d){
        var id=d.id||("dl:"+d.date+":"+d.label);
        if(o.removed[id])return;
        if(!o.deadlines.some(function(x){return x.id===id;}))o.deadlines.push({id:id,date:d.date,label:d.label,icon:d.icon||"🎯"});
      });
      (typeof EVENTS!=="undefined"?EVENTS:[]).forEach(function(e){
        var id=e.id||("ev:"+e.start+":"+e.label);
        if(o.removed[id])return;
        if(!o.events.some(function(x){return x.id===id;}))o.events.push({id:id,start:e.start,end:e.end||"",label:e.label,type:e.type||"perso"});
      });
    });
  }
  /* Édition des échéances (objectifs) — toujours via pMutate (anti-clobber). */
  function pAddDeadline(d){pMutate(function(o){o.deadlines.push({id:"u:"+Date.now().toString(36)+Math.random().toString(36).slice(2,5),date:d.date,label:d.label,icon:d.icon||"🎯"});});}
  function pUpdateDeadline(id,patch){pMutate(function(o){o.deadlines.forEach(function(x){if(x.id===id){if(patch.date!==undefined)x.date=patch.date;if(patch.label!==undefined)x.label=patch.label;if(patch.icon!==undefined)x.icon=patch.icon;}});});}
  function pRemoveDeadline(id){pMutate(function(o){o.deadlines=o.deadlines.filter(function(x){return x.id!==id;});o.removed=o.removed||{};o.removed[id]=true;});}
  /* Migration one-shot : renomme une échéance seedée dont le libellé a changé.
     L'id de seed dérive du libellé ("dl:date:label") : sans ça, pEnsureSeed
     ajouterait une 2e entrée à côté de l'ancienne. À lancer AVANT pEnsureSeed. */
  var DL_RENAME=[{date:"2026-07-25",from:"Départ Vercors",to:"Départ Cannes"}];
  function pRenameDeadlinesOnce(){
    pMutate(function(o){
      o.seeds=o.seeds||{};o.removed=o.removed||{};
      DL_RENAME.forEach(function(r){
        var flag="rn:"+r.date+":"+r.to;if(o.seeds[flag])return;
        var oldId="dl:"+r.date+":"+r.from,newId="dl:"+r.date+":"+r.to;
        var hasNew=o.deadlines.some(function(x){return x.id===newId;});
        var kept=[];
        o.deadlines.forEach(function(x){
          var stale=(x.id===oldId)||(x.date===r.date&&x.label===r.from);
          if(!stale){kept.push(x);return;}
          if(hasNew)return;                       /* doublon : on ne garde que le nouveau */
          if(x.label===r.from)x.label=r.to;        /* libellé perso déjà saisi : on n'y touche pas */
          x.id=newId;hasNew=true;kept.push(x);     /* id migré : évite le doublon au prochain seed */
        });
        o.deadlines=kept;
        if(o.removed[oldId])o.removed[newId]=true; /* suppression volontaire : on la respecte */
        o.seeds[flag]=true;
      });
    });
  }
  /* Migration unique : récupère les anciens états de jour stockés dans cette app
     (state.days[iso].status) vers le store partagé, sans écraser ce qui existe. */
  function pMigrateStates(){
    pMutate(function(o){Object.keys(state.days).forEach(function(iso){var st=state.days[iso].status;if(st&&!o.states[iso])o.states[iso]=st;});});
  }
  function pMigrateDayTypes(){if(typeof DAY_TYPE_MIGRATE==="undefined")return;pMutate(function(o){var s=o.states||{};Object.keys(s).forEach(function(iso){var nv=DAY_TYPE_MIGRATE[s[iso]];if(nv)s[iso]=nv;});});}
  function seedPlanOnce(){if(typeof PLAN_SEED==="undefined")return;pMutate(function(o){if(!o.seeds)o.seeds={};if(o.seeds.planGsheetJuil26)return;Object.keys(PLAN_SEED).forEach(function(iso){if(!o.states[iso])o.states[iso]=PLAN_SEED[iso];});o.seeds.planGsheetJuil26=true;});}
  if(!state.sessions)state.sessions={};
  if(!state.days)state.days={};
  if(!state.tri)state.tri={};

  /* ---------------- Dates ---------------- */
  var MOIS=["jan.","fév.","mars","avr.","mai","juin","juil.","août","sep.","oct.","nov.","déc."];
  var JOURS=["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
  function isoOf(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
  function todayStr(){return isoOf(new Date());}
  function addDays(iso,n){var d=new Date(iso+"T00:00:00");d.setDate(d.getDate()+n);return d;}
  function ddmm(d){return String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0");}
  function frDateFull(iso){var d=new Date(iso+"T00:00:00");var s=JOURS[d.getDay()]+" "+d.getDate()+" "+MOIS[d.getMonth()];return s.charAt(0).toUpperCase()+s.slice(1);}
  function cumWeeks(block){var n=0;for(var i=0;i<BLOCK_ORDER.length;i++){if(BLOCK_ORDER[i]===block)break;n+=PROGRAM_BLOCKS[BLOCK_ORDER[i]].weeks;}return n;}
  function muscuWeekDate(block,w){return ddmm(addDays(MUSCU_START,(cumWeeks(block)+w-1)*7));}
  function triWeekDate(w){return ddmm(addDays(TRI_START,(w-1)*7));}
  function num(v){return parseFloat((v===undefined||v===null?"":v).toString().replace(",","."));}
  function fr1(n){return n.toFixed(1).replace(".",",");}
  function nFmt(n){return (n%1===0)?(""+n):fr1(n);}
  function effPortion(it){if(!it||!it.nut)return "";var b=num(it.nut.base),q=num(it.qty);var n=(!isNaN(q)&&q>0)?q:b;if(isNaN(n)||n<=0)return "";var u=it.nut.baseUnit||it.unit||"g";if(u==="g"||u==="ml")return nFmt(n)+" "+u;var out="×"+nFmt(n);var fk=(""+(it.name||"")).trim().toLowerCase();var g=(state.foodFix&&state.foodFix[fk])?num(state.foodFix[fk].gPerU):NaN;if(!isNaN(g)&&g>0)out+=" · ≈"+nFmt(n*g)+" g";return out;}

  /* ---------------- Divers ---------------- */
  function slugify(s){return (""+s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");}
  function esc(s){return (""+(s==null?"":s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

  /* ---------------- Repas / aliments ---------------- */
  var MEALS=[{k:"pd",label:"Petit-déjeuner"},{k:"dj",label:"Déjeuner"},{k:"co",label:"Collation"},{k:"dn",label:"Dîner"}];
  var FOOD_UNITS=["g","ml","unité","portion","c. à s.","c. à c."];
  function unitOptions(sel){return FOOD_UNITS.map(function(u){return '<option value="'+u+'"'+(sel===u?' selected':'')+'>'+u+'</option>';}).join("");}
  /* ---------- Base d'aliments de référence (fichier base_aliments.json, enrichissable) ---------- */
  var FOOD_DB=[];
  function normFood(f,cat){if(!f||!f.name)return null;function s(v){return v==null?"":(""+v).trim();}var u=s(f.unit)||"g";
    return {name:s(f.name),unit:u,cat:cat,nut:{base:s(f.base),baseUnit:u,kcal:s(f.kcal),prot:s(f.prot),gluc:s(f.gluc),lip:s(f.lip),portion:s(f.portion)}};}
  function loadFoodDB(){
    try{
      if(typeof fetch!=="function")return;
      fetch("base_aliments.json",{cache:"no-store"}).then(function(r){return r&&r.ok?r.json():null;}).then(function(j){
        if(!j)return;var arr=[];["staples","suivi"].forEach(function(cat){(j[cat]||[]).forEach(function(f){var n=normFood(f,cat);if(n)arr.push(n);});});
        FOOD_DB=arr;
      }).catch(function(){});
    }catch(e){}
  }
  function foodFixMap(){if(!state.foodFix||typeof state.foodFix!=="object")state.foodFix={};return state.foodFix;}
  function countLoggedFood(k){var n=0;Object.keys(state.days).forEach(function(d){var mi=state.days[d].mealItems;if(!mi)return;MEALS.forEach(function(m){(mi[m.k]||[]).forEach(function(it){if(it&&it.name&&(""+it.name).trim().toLowerCase()===k)n++;});});});return n;}
  function migrateFood(k){var def=foodCatalog()[k];if(!def||!def.nut)return 0;var n=def.nut,c=0;Object.keys(state.days).forEach(function(d){var mi=state.days[d].mealItems;if(!mi)return;MEALS.forEach(function(m){(mi[m.k]||[]).forEach(function(it){if(it&&it.name&&(""+it.name).trim().toLowerCase()===k){it.unit=def.unit;it.nut={base:n.base,baseUnit:n.baseUnit,kcal:n.kcal,prot:n.prot,gluc:n.gluc,lip:n.lip,portion:n.portion};c++;}});});});return c;}
  function loggedFoods(){var seen={},out=[];Object.keys(state.days).sort().forEach(function(d){var mi=state.days[d].mealItems;if(!mi)return;MEALS.forEach(function(m){(mi[m.k]||[]).forEach(function(it){if(it&&it.name){var nm=(""+it.name).trim(),k=nm.toLowerCase();if(k&&!seen[k]){seen[k]=1;out.push(nm);}}});});});out.sort(function(a,b){return a.toLowerCase()<b.toLowerCase()?-1:1;});return out;}
  function foodCatalog(){var cat={};
    (FOOD_DB||[]).forEach(function(f){var k=(""+f.name).trim().toLowerCase();if(k)cat[k]={name:(""+f.name).trim(),unit:f.unit||"g",nut:f.nut||null,ref:true,cat:f.cat};});
    Object.keys(state.days).sort().forEach(function(d){var mi=state.days[d].mealItems;if(!mi)return;MEALS.forEach(function(m){(mi[m.k]||[]).forEach(function(it){if(it&&it.name&&(""+it.name).trim()){var k=(""+it.name).trim().toLowerCase();var ex=cat[k];if(!ex||!ex.ref)cat[k]={name:(""+it.name).trim(),unit:it.unit||"g",nut:it.nut||null};}});});});
    var fx=state.foodFix||{};Object.keys(fx).forEach(function(k){var f=fx[k]||{};if(!cat[k]){if(!(f.uf&&f.name))return;cat[k]={name:(""+f.name).trim(),unit:"g",nut:null};}var bn=cat[k].nut||{};function pick(v,dv){return (v!=null&&v!=="")?v:dv;}var u=pick(f.unit,bn.baseUnit||cat[k].unit||"g");
      cat[k]={name:cat[k].name,unit:u,nut:{base:pick(f.base,bn.base||"1"),baseUnit:u,kcal:pick(f.kcal,bn.kcal||""),prot:pick(f.prot,bn.prot||""),gluc:pick(f.gluc,bn.gluc||""),lip:pick(f.lip,bn.lip||""),portion:bn.portion||""},ref:cat[k].ref,cat:cat[k].cat,fixed:true};});
    return cat;}
  function foodNames(){var c=foodCatalog();return Object.keys(c).map(function(k){return c[k].name;}).sort(function(a,b){return a.toLowerCase()<b.toLowerCase()?-1:1;});}
   /* ---- Qualité alimentaire : badges factuels (protéine / NOVA / vigilance) ---- */
  function fqKey(name){return (""+(name==null?"":name)).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[×xX]\s*\d+\s*$/,"").replace(/\s+/g," ").trim();}
function fqTokens(s){var STOP={de:1,du:1,des:1,au:1,aux:1,a:1,la:1,le:1,les:1,l:1,et:1,en:1,d:1,un:1,une:1};s=fqKey(s).replace(/[^a-z0-9]+/g," ");return s.split(" ").filter(function(t){return t.length>=2&&!STOP[t]&&!/^\d+$/.test(t);});}
  function fqTokMatch(a,b){return a===b||(a.length>=4&&b.length>=4&&(a===b+"s"||b===a+"s"));}
  function foodQualMap(){if(!state.foodQual||typeof state.foodQual!=="object")state.foodQual={};return state.foodQual;}
  var _fqIdx=null;
  function fqInvalidate(){_fqIdx=null;}                            /* à appeler après toute édition de state.foodQual */
  function fqIndex(){if(_fqIdx)return _fqIdx;_fqIdx=[];var m={};
    if(typeof FOOD_QUALITY!=="undefined")Object.keys(FOOD_QUALITY).forEach(function(k){m[k]=FOOD_QUALITY[k];});
    if(state&&state.foodQual)Object.keys(state.foodQual).forEach(function(k){m[k]=state.foodQual[k];}); /* overrides perso participent aussi au matching */
    Object.keys(m).forEach(function(k){var t=fqTokens(k);if(t.length)_fqIdx.push({k:k,t:t,q:m[k]});});
    _fqIdx.sort(function(a,b){return (b.t.length-a.t.length)||(b.k.length-a.k.length);});return _fqIdx;}
  function foodQuality(name){
    var k=fqKey(name);
    var uq=(state&&state.foodQual&&state.foodQual[k]);if(uq)return uq; /* 0) override perso (state.foodQual) prioritaire */
    if(typeof FOOD_QUALITY==="undefined")return null;
    var q=FOOD_QUALITY[k];if(q)return q;                           /* 1) correspondance exacte (seed) */
    var toks=fqTokens(name);if(!toks.length||toks.length>5)return null; /* 2) mots-clés — on saute les descriptions trop composées */
    var idx=fqIndex();
    for(var i=0;i<idx.length;i++){var e=idx[i];                    /* trié du + spécifique au - spécifique → 1re correspondance = la meilleure */
      if(e.t.every(function(kt){return toks.some(function(nt){return fqTokMatch(kt,nt);});}))return e.q;}
    var pfam=protFamilyByName(name);if(pfam)return {p:2,n:0,w:0};   /* 3) céréale/légumineuse reconnue → protéine incomplète (complémentarité) */
    return null;
  }
 

  /* Familles de protéines incomplètes → suggestion de complémentarité (sur la journée). */
  var PROT_FAMILY={
    c:["riz","ble","pate","semoule","boulgour","boulghour","pain","baguette","avoine","mais","polenta","epeautre","orge","sarrasin","millet"],
    l:["lentille","pois","chiche","haricot","flageolet","feve","houmous","dhal","dal"]
  };
  var PROT_COMPLETE_PLANT=["soja","tofu","edamame","quinoa"]; /* protéines végétales complètes → jamais « à compléter » */
  function protFamilyByName(name){
    var toks=fqTokens(name);
    if(toks.some(function(t){return PROT_COMPLETE_PLANT.indexOf(t)>=0;}))return null;
    function hit(fam){return toks.some(function(t){return PROT_FAMILY[fam].some(function(k){return fqTokMatch(k,t);});});}
    if(hit("l"))return "l";                                         /* légumineuse d'abord (« pois chiche » avant « pois ») */
    if(hit("c"))return "c";
    return null;
  }
  function protFamily(name,q){
    if(q&&(q.f==="c"||q.f==="l"))return q.f;                        /* override explicite (noms opaques : taboulé, falafel) */
    return protFamilyByName(name);
  }
  function protComplementReason(name,q){
    var fam=protFamily(name,q);
    if(fam==="c")return "Céréale — complète avec une légumineuse (lentilles, pois chiches, haricots) sur la journée.";
    if(fam==="l")return "Légumineuse — complète avec une céréale (riz, pâtes, semoule, pain) sur la journée.";
    return "Protéine végétale incomplète — associe céréale + légumineuse sur la journée.";
  }
  function dayProtFams(iso){var x=state.days[iso],has={c:false,l:false};if(x&&x.mealItems)MEALS.forEach(function(m){(x.mealItems[m.k]||[]).forEach(function(it){var q=foodQuality(it.name);if(q&&q.p===2){var f=protFamily(it.name,q);if(f==="c")has.c=true;else if(f==="l")has.l=true;}});});return has;}
  function protComplementState(name,q,iso){
    var fam=protFamily(name,q);
    if(!iso)return {done:false,reason:protComplementReason(name,q)};
    var has=dayProtFams(iso);
    if(fam==="c")return has.l?{done:true,reason:"✓ Complétée aujourd'hui — une légumineuse est déjà au menu."}:{done:false,reason:"Céréale — à compléter : ajoute une légumineuse (lentilles, pois chiches…) dans la journée."};
    if(fam==="l")return has.c?{done:true,reason:"✓ Complétée aujourd'hui — une céréale est déjà au menu."}:{done:false,reason:"Légumineuse — à compléter : ajoute une céréale (riz, pâtes, pain…) dans la journée."};
    return (has.c&&has.l)?{done:true,reason:"✓ Complétée aujourd'hui (céréale + légumineuse présentes)."}:{done:false,reason:"Protéine végétale incomplète — associe céréale + légumineuse dans la journée."};
  }
  function foodQualityBadges(name,iso){
    var q=foodQuality(name);if(!q)return "";
    var P={1:["💪","Protéine complète (profil d'acides aminés complet)"]};
    var N={1:["🟢","Brut / peu transformé (NOVA 1)"],2:["🟡","Transformé (NOVA 3)"],3:["🔴","Ultra-transformé (NOVA 4)"]};
    function badge(ic,r,cls){return '<span class="fq'+(cls?(" "+cls):"")+'" data-r="'+esc(r)+'" title="'+esc(r)+'" role="button" tabindex="0" aria-label="'+esc(r)+'">'+ic+'</span>';}
    var out="";
    if(q.p===1)out+=badge(P[1][0],P[1][1]);
    else if(q.p===2){var st=protComplementState(name,q,iso);out+=badge(st.done?"🌿":"🌱",st.reason,st.done?"fq-done":"");}
    if(N[q.n])out+=badge(N[q.n][0],N[q.n][1]);
    if(q.w)out+=badge("⚠️",q.w);
    return out?'<span class="fq-badges">'+out+'</span>':"";
  }
  function foodQualityLegend(){return '<div class="fq-legend">💪 complète · 🌱 à compléter · 🌿 complété · 🟢🟡🔴 transformation · ⚠️ vigilance <span class="fq-legend-hint">— touche un picto pour la raison</span></div>';}
  var fqTapWired=false;
  function fqToast(msg){var t=document.getElementById("fqToast");if(!t){t=document.createElement("div");t.id="fqToast";t.className="fq-toast";document.body.appendChild(t);}t.textContent=msg;t.classList.add("show");clearTimeout(fqToast._t);fqToast._t=setTimeout(function(){t.classList.remove("show");},2600);}
  function wireFqTaps(){if(fqTapWired||typeof document==="undefined")return;fqTapWired=true;document.addEventListener("click",function(e){var b=(e.target&&e.target.closest)?e.target.closest(".fq"):null;if(!b)return;e.preventDefault();e.stopPropagation();var r=b.getAttribute("data-r");if(r)fqToast(r);});}
  function scaleNut(it){if(!it||!it.nut)return null;var base=num(it.nut.base);var q=num(it.qty);var f;
    if(!isNaN(q)&&q>0&&!isNaN(base)&&base>0&&(it.unit||"")===(it.nut.baseUnit||""))f=q/base; /* quantité explicite compatible */
    else f=1; /* défaut : 1 portion (valeurs de base), unités ignorées */
    var r={};var kc=num(it.nut.kcal),pr=num(it.nut.prot);if(!isNaN(kc))r.kcal=kc*f;if(!isNaN(pr))r.prot=pr*f;if(r.kcal===undefined&&r.prot===undefined)return null;return r;}
  function dayTotals(d){var x=state.days[d];if(!x)return null;var k=0,p=0,pComp=0,pC=0,pL=0,pOth=0,any=false;
    if(x.mealItems)MEALS.forEach(function(m){(x.mealItems[m.k]||[]).forEach(function(it){var s=scaleNut(it);if(s){any=true;if(s.kcal)k+=s.kcal;if(s.prot){p+=s.prot;var q=foodQuality(it.name),fam=q?protFamily(it.name,q):null;if(q&&q.p===1)pComp+=s.prot;else if(q&&q.p===2&&fam==="c")pC+=s.prot;else if(q&&q.p===2&&fam==="l")pL+=s.prot;else pOth+=s.prot;}}});});
    if(x.supps&&typeof SUPPS!=="undefined")SUPPS.forEach(function(sp){if(x.supps[sp.id]){var mul=(x.supps2&&x.supps2[sp.id])?2:1;if(sp.prot){p+=sp.prot*mul;pComp+=sp.prot*mul;any=true;}if(sp.kcal){k+=sp.kcal*mul;any=true;}}});
    var pair=2*Math.min(pC,pL),unpaired=(pC+pL)-pair,eff=pComp+pOth+pair+(pComp>0?unpaired:0);
    return any?{kcal:k,prot:p,protEff:eff,pComp:pComp,pOther:pOth,pC:pC,pL:pL,pair:pair}:null;}

  /* ---------------- Objectifs ---------------- */
  var MUSCU_DEADLINE="2026-07-27";
  var RACE_DATE="2026-09-11";
  function blockDone(b){var n=0,wk=PROGRAM_BLOCKS[b].weeks;for(var w=1;w<=wk;w++)for(var i=0;i<CODES.length;i++)if(sess(b,w,CODES[i]).done)n++;return n;}
  function daysUntil(iso){return Math.round((new Date(iso+"T00:00:00")-new Date(todayStr()+"T00:00:00"))/86400000);}

  /* ---------------- Séances (multi-blocs) ---------------- */
  function sessKey(b,w,c){return b==="b1"?(w+"_"+c):(b+"_"+w+"_"+c);}
  function sess(b,w,c){var k=sessKey(b,w,c);if(!state.sessions[k])state.sessions[k]={done:false,sets:{}};return state.sessions[k];}
  /* ---------- Personnalisation durable des séances (override dans state.config) ---------- */
  function progCfg(){if(!state.config)state.config={};if(!state.config.program)state.config.program={};return state.config.program;}
  function progOf(b,c){return progCfg()[b+"_"+c]||PROGRAM_BLOCKS[b].prog[c];}
  function progIsCustom(b,c){return !!progCfg()[b+"_"+c];}
  function progOverride(b,c){var key=b+"_"+c,pc=progCfg();if(!pc[key])pc[key]=JSON.parse(JSON.stringify(PROGRAM_BLOCKS[b].prog[c]));return pc[key];}
  function progReset(b,c){delete progCfg()[b+"_"+c];save();}
  function nextSession(){for(var bi=0;bi<BLOCK_ORDER.length;bi++){var b=BLOCK_ORDER[bi];var wk=PROGRAM_BLOCKS[b].weeks;for(var w=1;w<=wk;w++){for(var i=0;i<CODES.length;i++){if(!sess(b,w,CODES[i]).done)return{block:b,w:w,c:CODES[i]};}}}return null;}
  function doneCount(){var n=0;BLOCK_ORDER.forEach(function(b){var wk=PROGRAM_BLOCKS[b].weeks;for(var w=1;w<=wk;w++)for(var i=0;i<CODES.length;i++)if(sess(b,w,CODES[i]).done)n++;});return n;}
  function totalSessions(){var n=0;BLOCK_ORDER.forEach(function(b){n+=PROGRAM_BLOCKS[b].weeks*CODES.length;});return n;}
  function triDoneCount(){var n=0;TRI.forEach(function(wk){TRI_DISC.forEach(function(p){var r=state.tri[wk.w+"_"+p[0]];if(r&&r.done)n++;});});return n;}

  /* Charges de la dernière séance identique (même code, semaine/bloc antérieurs) */
  function setKey(exId,v){return v?exId+"::"+v:exId;}
  /* Base de saisie du poids par exo : total (poids affiché en kg) · bras (poids d'UN haltère) · ajout (charge ajoutée au poids du corps).
     Déduite de la variante ; à défaut de la base par défaut de l'exo (data.js) ; forçage manuel possible via state.muscuBase[setKey]. */
  var BASE_UNIT={total:"kg",bras:"kg/bras",ajout:"+kg"};
  function baseFromVariant(v){if(v==="Haltères")return "bras";if(v==="Poids du corps")return "ajout";return "total";}
  function baseFor(exId,variant,defBase){
    var f=state.muscuBase&&state.muscuBase[setKey(exId,variant)];   /* 1) forçage manuel prioritaire */
    if(f&&BASE_UNIT[f])return f;
    if(variant)return baseFromVariant(variant);                     /* 2) déduit de la variante choisie */
    return (defBase&&BASE_UNIT[defBase])?defBase:"total";           /* 3) base par défaut de l'exo, sinon total */
  }
  function baseUnitFor(exId,variant,defBase){return BASE_UNIT[baseFor(exId,variant,defBase)];}
  function baseHint(mode){
    if(mode==="bras")return "Note le poids d'<b>UN</b> haltère (par bras). Peu importe l'exécution — bras par bras (alterné), les deux en même temps ou côte à côte — c'est toujours le poids d'un <b>seul</b> haltère. Ex. deux haltères de 12 kg → tu notes <b>12</b>, pas 24.";
    if(mode==="ajout")return "Note seulement la <b>charge ajoutée</b> à ton poids du corps (lest, disque, gilet). Mets <b>0</b> si tu es au poids du corps.";
    return "Note le <b>poids total de l'engin</b> : barre chargée (barre + disques), plaque sélectionnée sur la machine, ou charge à la poulie.";
  }
  function prevSets(b,w,c,exId){
    function pick(bl,wk){var ss=state.sessions[sessKey(bl,wk,c)];if(ss&&ss.sets&&ss.sets[exId]){var a=ss.sets[exId];for(var i=0;i<a.length;i++){if(a[i]&&(a[i].kg!==""||a[i].r!==""))return a;}}return null;}
    for(var ww=w-1;ww>=1;ww--){var r=pick(b,ww);if(r)return r;}
    var idx=BLOCK_ORDER.indexOf(b);
    for(var bi=idx-1;bi>=0;bi--){var bb=BLOCK_ORDER[bi];var wk=PROGRAM_BLOCKS[bb].weeks;for(var w2=wk;w2>=1;w2--){var r2=pick(bb,w2);if(r2)return r2;}}
    return null;
  }
  /* Progression (muscu) — deux métriques par exo, une par semaine, pour (code c + exId/variante) du bloc b :
     · principale = 1RM ESTIMÉ (Epley : kg × (1 + reps/30)), meilleure série de la séance. Haltères : on prend le kg/bras tel quel.
     · secondaire = VOLUME/SÉANCE = Σ(reps × kg), ×2 pour haltères BILATÉRAL (tonnage réel des deux bras).
     Bascule au tap sur le bandeau. Epley décroche au-delà de ~15 reps → marqueur « ≈ » discret. */
  function epley(kg,r){return kg*(1+(r>0?r:0)/30);}
  function volFactor(base,name){return (base==="bras" && !/1\s*bras|un\s*bras|unilat|altern/i.test(name||""))?2:1;}
  function exoBest1RM(arr){var best=null;for(var i=0;i<arr.length;i++){var kg=num(arr[i]&&arr[i].kg),r=num(arr[i]&&arr[i].r);if(!isNaN(kg)&&kg>0){var e=epley(kg,isNaN(r)?0:r);if(best===null||e>best.e)best={e:e,r:isNaN(r)?0:r};}}return best;}
  function exoVol(arr,factor){var v=0,any=false;for(var i=0;i<arr.length;i++){var kg=num(arr[i]&&arr[i].kg),r=num(arr[i]&&arr[i].r);if(!isNaN(kg)&&kg>0&&!isNaN(r)&&r>0){v+=kg*r;any=true;}}return any?v*factor:null;}
  function exoSeries(b,c,exId,mode,factor){
    var wk=PROGRAM_BLOCKS[b].weeks,out=[];
    for(var w=1;w<=wk;w++){var ss=state.sessions[sessKey(b,w,c)];if(ss&&ss.sets&&ss.sets[exId]){
      if(mode==="vol"){var v=exoVol(ss.sets[exId],factor);if(v!=null)out.push({w:w,val:v});}
      else{var t=exoBest1RM(ss.sets[exId]);if(t)out.push({w:w,val:t.e,reps:t.r});}
    }}
    return out;
  }
   /* ---- Équivalence inter-variantes : boussole de poids quand une variante n'a pas d'historique ----
     1RM estimé constant (Epley) sur la charge TOTALE, coefficient de transfert par matériel,
     puis retour au poids conseillé pour la fourchette de reps visée. */
  function vCoef(name,base){var n=(name||"").toLowerCase();if(/machine|convergen|smith|guid/.test(n))return 1.15;if(/halt|dumbbell/.test(n))return 0.90;if(/poulie|cable|câble/.test(n))return 1.00;if(/barre|barbell/.test(n))return 1.00;if(/corps|bodyweight|lest/.test(n))return 1.00;return base==="bras"?0.90:1.00;}
  function toTotalLoad(kg,base,name,bw){if(base==="bras")return kg*volFactor(base,name);if(base==="ajout")return bw!=null?kg+bw:null;return kg;}
  function fromTotalLoad(t,base,name,bw){if(base==="bras")return t/volFactor(base,name);if(base==="ajout")return bw!=null?(t-bw):null;return t;}
  function midReps(t){var m=String(t||"").split("×")[1]||"";var mm=m.match(/(\d+)\s*[-–]\s*(\d+)/);if(mm)return Math.round((+mm[1]+ +mm[2])/2);var s=m.match(/(\d+)/);return s?+s[1]:0;}
  function variantSuggest(b,w,c,ex,curV,curBase,curKey){
    var bw=lastWeight();
    var vopts=(ex.variants&&ex.variants.length?ex.variants:EXO_VARIANTS);
    var cand={};cand[ex.id]="";
    vopts.forEach(function(V){cand[setKey(ex.id,V)]=V;});
    for(var sk in state.sessions){var ss=state.sessions[sk];if(ss&&ss.sets){for(var key in ss.sets){if(key===ex.id||key.indexOf(ex.id+"::")===0){if(!(key in cand))cand[key]=key.indexOf("::")>=0?key.slice(key.indexOf("::")+2):"";}}}}
    var refRM=null,refFrom=null,refR=0;
    for(var k in cand){
      if(k===curKey)continue;
      var rec=prevSets(b,w,c,k);if(!rec)continue;
      var vN=cand[k],vBase=baseFor(ex.id,vN,ex.base),bestE=null,bestR=0;
      for(var i=0;i<rec.length;i++){var kg=num(rec[i]&&rec[i].kg),r=num(rec[i]&&rec[i].r);if(isNaN(kg)||kg<=0)continue;var tot=toTotalLoad(kg,vBase,ex.name,bw);if(tot==null)continue;var e=epley(tot,isNaN(r)?0:r);if(bestE===null||e>bestE){bestE=e;bestR=isNaN(r)?0:r;}}
      if(bestE===null)continue;
      var ref=bestE/vCoef(vN,vBase);
      if(refRM===null||ref>refRM){refRM=ref;refFrom=vN;refR=bestR;}
    }
    if(refRM===null)return null;
    var tR=midReps(ex.target)||refR||8;
    var sugTotal=refRM*vCoef(curV,curBase)/(1+tR/30);
    var disp=fromTotalLoad(sugTotal,curBase,ex.name,bw);
    if(disp==null||!isFinite(disp))return null;
    var step=curBase==="bras"?1:2.5;disp=Math.max(0,Math.round(disp/step)*step);
    var kgs=(Math.abs(disp-Math.round(disp))<1e-9)?String(Math.round(disp)):String(disp);
    return {kg:kgs,r:tR,from:refFrom};
  }
  var progMode={};  /* exId nu -> "vol" pour la vue volume (défaut : 1RM), conservé entre re-rendus */
  var PG_TAG='style="font-weight:700;color:var(--muted);font-size:10px;margin-left:5px;letter-spacing:.02em"';
  function progHTML(b,c,exId,base,name){
    var bareId=exId.split("::")[0];
    var mode=progMode[bareId]==="vol"?"vol":"1rm";
    var factor=volFactor(base,name);
    var arr=exoSeries(b,c,exId,mode,factor);
    if(!arr.length&&mode==="vol"){mode="1rm";arr=exoSeries(b,c,exId,"1rm",factor);}  /* volume indispo (reps manquantes) → retombe sur 1RM, jamais de bandeau vide */
    if(!arr.length)return "";
    var max=-Infinity,min=Infinity,maxReps=0;arr.forEach(function(p){if(p.val>max){max=p.val;maxReps=p.reps||0;}if(p.val<min)min=p.val;});
    var spark="",trend="";
    if(arr.length>=2){
      var W=104,H=26,pad=3,n=arr.length,span=(max-min)||1;
      var pts=arr.map(function(p,i){var x=pad+i*((W-2*pad)/(n-1));var y=H-pad-((p.val-min)/span)*(H-2*pad);return x.toFixed(1)+","+y.toFixed(1);});
      var lp=pts[pts.length-1].split(",");
      spark='<svg class="prog-spark" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"><polyline points="'+pts.join(" ")+'"/><circle cx="'+lp[0]+'" cy="'+lp[1]+'" r="2.6"/></svg>';
      var d=Math.round(arr[arr.length-1].val-arr[0].val);trend=d>0?'<span class="pg-up">+'+d+'</span>':(d<0?'<span class="pg-dn">'+d+'</span>':'<span class="pg-eq">stable</span>');
    }
    var rec=Math.round(max);
    if(mode==="vol"){
      return '<div class="exo-prog" data-prog="'+esc(bareId)+'" role="button" tabindex="0" title="Toucher : voir le 1RM estimé"><span class="pg-rec">📦 '+rec+' kg<span '+PG_TAG+'>vol max</span></span>'+spark+trend+'</div>';
    }
    var note=maxReps>15?'<span '+PG_TAG+' title="Estimation Epley moins fiable au-delà de ~15 reps">≈</span>':'';
    return '<div class="exo-prog" data-prog="'+esc(bareId)+'" role="button" tabindex="0" title="Toucher : voir le volume par séance"><span class="pg-rec">🏆 '+rec+' kg<span '+PG_TAG+'>1RM est.'+note+'</span></span>'+spark+trend+'</div>';
  }

  function exoHistHTML(b,c,setK,lastTxt,isSec,secLbl){
    var wk=PROGRAM_BLOCKS[b].weeks,rows=[],mx=0;
    for(var w=1;w<=wk;w++){var ss=state.sessions[sessKey(b,w,c)];if(!ss||!ss.sets||!ss.sets[setK])continue;var sets=ss.sets[setK],top=0,lbl="";
      if(isSec){for(var i=0;i<sets.length;i++){var r=num(sets[i]&&sets[i].r);if(!isNaN(r)&&r>top)top=r;}if(top<=0)continue;lbl=top+" "+(secLbl||"s");}
      else{var best=exoBest1RM(sets);if(!best)continue;top=Math.round(best.e);lbl=top+" kg";}
      rows.push({w:w,top:top,lbl:lbl});if(top>mx)mx=top;}
    var last=lastTxt?'<div class="hist-last">Dernière fois : '+esc(lastTxt)+'</div>':"";
    if(!rows.length)return lastTxt?('<details class="base-hint" open><summary>📊 Historique</summary><div class="exo-hist">'+last+'</div></details>'):'<details class="base-hint"><summary>📊 Historique</summary><div class="exo-hist-empty">Pas encore d\'historique — remplis tes séries, elles s\'afficheront ici.</div></details>';
    var bars=rows.map(function(r){var pct=mx>0?Math.max(6,Math.round(r.top/mx*100)):6;return '<div class="hist-row"><span class="hist-wk">S'+r.w+'</span><span class="hist-bar-wrap"><span class="hist-bar" style="width:'+pct+'%"></span></span><span class="hist-val">'+esc(r.lbl)+'</span></div>';}).join("");
    var cap=isSec?'<div class="hist-cap">Barres = meilleur temps tenu par semaine.</div>':'<div class="hist-cap">Barres = 1RM estimé par semaine (repère de progression).</div>';
    return '<details class="base-hint" open><summary>📊 Historique</summary><div class="exo-hist">'+bars+cap+last+'</div></details>';
  }

  /* ---------------- Journée ---------------- */
  function day(d){
    if(!state.days[d])state.days[d]={program:"",sports:[],note:"",weight:"",meals:{pd:"",dj:"",dn:"",co:""},protein:false,meditation:false,sleep:"",stools:[],water:0};
    var x=state.days[d];
    if(!x.meals)x.meals={pd:"",dj:"",dn:"",co:""};
    if(!x.sports)x.sports=[];
    if(x.meditation===undefined)x.meditation=false;
    if(x.sleep===undefined)x.sleep="";
    if(!x.stools)x.stools=[];
    if(x.water===undefined)x.water=0;
    if(!x.wAdd||typeof x.wAdd!=="object")x.wAdd={};
    if(!x.supps)x.supps={};
    if(x.status===undefined)x.status="";
    if(!x.mealItems){x.mealItems={pd:[],dj:[],dn:[],co:[]};["pd","dj","dn","co"].forEach(function(kk){var t=(x.meals&&x.meals[kk])||"";if((""+t).trim())x.mealItems[kk].push({name:(""+t).trim(),qty:"",unit:"g",nut:null});});}
    else{["pd","dj","dn","co"].forEach(function(kk){if(!x.mealItems[kk])x.mealItems[kk]=[];});}
    return x;
  }

  /* ---------------- Minuteur de repos ---------------- */
  var restInt=null, restEnd=0;
  function restFor(t){if(/\bs\b/.test(t)||/s\/|s$/.test(t))return 30;if(/6-8|max/.test(t))return 120;if(/8-10/.test(t))return 90;if(/10-12/.test(t))return 75;return 60;}
  function fmtTime(s){var m=Math.floor(s/60);var ss=s%60;return m+":"+String(ss).padStart(2,"0");}
  function restTick(){var disp=document.getElementById("restDisp");if(!disp){clearInterval(restInt);restInt=null;return;}var rem=Math.max(0,Math.round((restEnd-Date.now())/1000));disp.textContent=fmtTime(rem);if(rem<=0){clearInterval(restInt);restInt=null;disp.classList.add("done");if(navigator.vibrate){try{navigator.vibrate([200,100,200]);}catch(e){}}}}
  function startRest(sec){restEnd=Date.now()+sec*1000;var disp=document.getElementById("restDisp");if(disp)disp.classList.remove("done");if(restInt)clearInterval(restInt);restTick();restInt=setInterval(restTick,250);}
  function stopRest(){if(restInt){clearInterval(restInt);restInt=null;}var disp=document.getElementById("restDisp");if(disp){disp.textContent="0:00";disp.classList.remove("done");}}

  /* ---------------- Bandeau contextuel (phase) ---------------- */
  function phaseTip(iso){
    if(iso<"2026-06-22")return {t:"Avant le Vercors 🧗",p:"Priorité escalade : monte le volume de grimpe pour arriver prêt. Garde 2 séances muscu max par semaine d'ici là."};
    if(iso<="2026-06-28")return {t:"Semaine Vercors 🧗",p:"Profite de la grimpe ! La muscu démarre à 4 séances au retour, le 27/06."};
    if(iso<="2026-07-31")return {t:"Bloc 1 — Construction",p:"Surcharge progressive : dès que tu boucles le haut de la fourchette de reps sur toutes les séries, ajoute du poids. Objectif 27 juillet. Le triathlon démarre le 6/7 en parallèle."};
    if(iso<="2026-08-28")return {t:"Bloc 2 — Plage ☀️",p:"Focus épaules / dos / bras : c'est ce qui ressort le plus. En parallèle le triathlon monte en charge — surveille la fatigue."};
    if(iso<="2026-09-13")return {t:"Affûtage triathlon 🏁",p:"On réduit le volume, on garde un peu d'intensité. Sommeil et récup prioritaires. Course les 11-13 septembre à Dinard !"};
    return {t:"Bravo 👏",p:"Gros été bouclé. Note tes ressentis et planifie la suite."};
  }
  /* Bandeau phase sur Aujourd'hui : phase courante + prochain objectif lu depuis le calendrier (éditable). */
  function renderPhase(){
    var host=document.getElementById("todayPhase");if(!host)return;
    var ph=phaseTip(todayStr());
    var upcoming=pDeadlines().filter(function(x){return x.date>=todayStr();});
    var nextHTML="";
    if(upcoming.length){var dl=upcoming[0],dd=diffDays(dl.date,todayStr());var jx=dd<=0?"aujourd'hui":(dd===1?"demain":"J-"+dd);
      nextHTML='<div class="phase-next">🎯 Prochain objectif : '+esc(dl.icon||"🎯")+' '+esc(dl.label)+' — <b>'+jx+'</b> ('+esc(frDateShort(dl.date))+')</div>';}
    host.innerHTML='<div class="phase-banner"><div class="phase-t">'+esc(ph.t)+'</div><div class="phase-p">'+esc(ph.p)+'</div>'+nextHTML+'</div>';
  }

  /* ---------------- Navigation onglets ---------------- */
  var currentSel=null, currentTri=null, dayDate=todayStr();
  /* ===== BANDEAU REPLIABLE — PATRON UNIQUE =====
     bndOpen  : registre UNIQUE de l'état ouvert/fermé de TOUS les bandeaux.
     bndHead  : génère le bouton-titre (peau + data-bnd) — ne jamais écrire ce <button> à la main.
     bndBody  : génère le corps repliable (data-bndb, .collapsed).
     wireBnd  : UN seul écouteur de clic, délégué sur document, posé une fois au démarrage.
     Ajouter un bandeau = 1 clé dans bndOpen + 1 appel à bndHead/bndBody. Rien d'autre. */
  var bndOpen={homecal:false,hero:false,radar:true,nutri:false,bal:false,
              eg:true,cm:false,wb:false,sp:false,rx:false,px:false,cr:false,tr:false,jprot:false,
              axhelp:false,tenut:false,rgS:true,rgR:true,rgP:false};
  var BND_RENDER={};
  function bndHead(key,skin,o){
    o=o||{};
    var cls="bnd bnd-"+skin+(o.stick?" bnd-stick":"")+(bndOpen[key]?" open":"");
    var inner;
    if(o.ic!=null){
      inner='<span class="bnd-ic">'+o.ic+'</span><span class="bnd-txt"><span class="bnd-k">'+o.k+'</span><span class="bnd-v">'+o.v+'</span></span>';
    }else{
      inner='<span class="bnd-ttl">'+o.ttl+'</span>'
           +(o.sum!=null ?'<span class="bnd-sum'+(o.cls?" "+o.cls:"")+'">'+o.sum+'</span>':"")
           +(o.meta!=null?'<span class="bnd-meta'+(o.cls?" "+o.cls:"")+'">'+o.meta+'</span>':"");
    }
    return '<button type="button" class="'+cls+'" data-bnd="'+key+'"'
         +(o.render?' data-bndr="'+o.render+'"':"")+(o.attrs||"")+'>'
         +inner+'<span class="bnd-chev">\u25be</span></button>';
  }
  function bndBody(key,cls,inner){
    return '<div class="bnd-body'+(cls?" "+cls:"")+(bndOpen[key]?"":" collapsed")+'" data-bndb="'+key+'">'+(inner||"")+'</div>';
  }
  function wireBnd(){
    BND_RENDER={homecal:renderCalendars,hero:renderHero,
               bal:function(){renderDayBalance(dayDate);},
               nutri:function(){renderDayNutri(dayDate);},
               dayRadar:renderDayRadar};
    document.addEventListener("click",function(e){
      var b=e.target&&e.target.closest?e.target.closest("[data-bnd]"):null;
      if(!b)return;
      var k=b.getAttribute("data-bnd");
      bndOpen[k]=!bndOpen[k];
      var r=b.getAttribute("data-bndr");
      if(r){var fn=BND_RENDER[r];if(fn)fn();return;}
      b.classList.toggle("open",bndOpen[k]);
      var body=document.querySelector('[data-bndb="'+k+'"]');
      if(body)body.classList.toggle("collapsed",!bndOpen[k]);
    });
  }
  var sessExpanded={}; /* exId -> déplié, conservé entre re-rendus d'une même séance */
  var radarPeriod=30, fuelOpen=false, radarDetail=false;
  var EXO_VARIANTS=["Barre","Haltères","Machine","Poulie","Poids du corps"]; /* variantes génériques par matériel (fallback si ex.variants absent) */
  var mealOpen={}; /* repas repliés par défaut dans le journal (par clé de repas pd/dj/dn/co) */
  var blockOpen=null;  /* blocs de séance repliables (Sport) : bloc en cours ouvert par défaut */
  var bkpNudgeHidden=false;  /* rappel sauvegarde masqué pour la session */
  var onbHidden=false,onbMin=false,onbIdx=0,onbRxOff=0,onbTimer=null;  /* alerte "profil à compléter" */ 
  function activateTab(id){
    var t;
    document.querySelectorAll(".tab").forEach(function(x){x.classList.toggle("on",x.getAttribute("data-view")===id);});
    document.querySelectorAll(".view").forEach(function(v){v.classList.toggle("active",v.id===id);});
    setTimeout(syncStickTop,0);
    if(id==="v-day"){renderDay();renderCalendars();}
    else if(id==="v-sport"){renderProgram();renderTri();renderSportTabs();renderLearn();}
    else if(id==="v-prog2")renderProgress();
    window.scrollTo(0,0);
    var sp0=document.getElementById("stickyProt");if(sp0&&id!=="v-day")sp0.classList.remove("show");
  }
  /* Sous-onglets de l'onglet Sport : construits à partir des activités actives (Réglages). */
  var sportSel="muscu";
  function sportActs(){var a=[];if(actEnabled("muscu"))a.push("muscu");if(actEnabled("tri"))a.push("tri");return a;}
  function renderSportTabs(){
    var host=document.getElementById("sportSub");if(!host)return;
    var pm=document.getElementById("sportMuscu"),pt=document.getElementById("sportTri");
    var acts=sportActs();
    if(!acts.length){host.innerHTML='<p class="hint" style="margin:0">Aucune activité active — active la muscu ou le triathlon dans les Réglages.</p>';if(pm)pm.hidden=true;if(pt)pt.hidden=true;return;}
    if(acts.indexOf(sportSel)<0)sportSel=acts[0];
    if(acts.length<2){host.innerHTML='<div class="sport-solo">'+esc((sportSel==="muscu"?"💪 ":"🏊 ")+actName(sportSel))+'</div>';}
    else{host.innerHTML=acts.map(function(k){return '<button class="subtab'+(k===sportSel?" on":"")+'" data-sport="'+k+'">'+esc((k==="muscu"?"💪 ":"🏊 ")+actName(k))+'</button>';}).join("");}
    if(pm)pm.hidden=(sportSel!=="muscu");if(pt)pt.hidden=(sportSel!=="tri");
    host.querySelectorAll("[data-sport]").forEach(function(b){b.onclick=function(){sportSel=b.getAttribute("data-sport");renderSportTabs();window.scrollTo(0,0);};});
  }
  function goSport(sel){sportSel=sel;activateTab("v-sport");}
  function renderLearn(){var h=document.getElementById("learnPane");if(!h)return;
    var b=dscgBlockHTML(todayStr());
    h.innerHTML=b||'<div class="card pad"><div class="reg-empty">Ton app de r\u00e9visions DSCG n\'est pas encore reli\u00e9e. Elle appara\u00eetra ici d\u00e8s qu\'elle sera pr\u00eate.</div></div>';}

   /* ---- Navigation par glissement horizontal entre onglets (aujourd'hui / sport / journal / progrès) ---- */
  function swipeOverlayOpen(){
    var ids=["drawer","settings","calSheet","axisView"];for(var i=0;i<ids.length;i++){var el=document.getElementById(ids[i]);if(el&&el.classList.contains("open"))return true;}
    var sc=document.getElementById("crsScanModal");if(sc&&!sc.hidden)return true;return false;
  }
  function swipeInHScroll(el){
    for(var n=el;n&&n!==document.body;n=n.parentElement){if(n.scrollWidth>n.clientWidth+2){var ov=getComputedStyle(n).overflowX||"";if(ov==="auto"||ov==="scroll")return true;}}return false;
  }
  function wireSwipe(){
    var sx=0,sy=0,ok=false;
    document.addEventListener("touchstart",function(e){
      if(e.touches.length!==1){ok=false;return;}
      var t=e.touches[0];sx=t.clientX;sy=t.clientY;
      ok=!swipeOverlayOpen()&&!swipeInHScroll(e.target)&&!(e.target&&/^(input|textarea|select)$/i.test(e.target.tagName));
    },{passive:true});
    document.addEventListener("touchend",function(e){
      if(!ok)return;ok=false;
      var t=e.changedTouches&&e.changedTouches[0];if(!t)return;
      var dx=t.clientX-sx,dy=t.clientY-sy;
      if(Math.abs(dx)<70||Math.abs(dx)<Math.abs(dy)*1.8)return;
      if(swipeOverlayOpen())return;
      var tabs=[].slice.call(document.querySelectorAll(".tab")).map(function(x){return x.getAttribute("data-view");});
      var act=document.querySelector(".view.active");var cur=act?tabs.indexOf(act.id):-1;if(cur<0)return;
      var nx=dx<0?cur+1:cur-1;if(nx<0||nx>=tabs.length)return;
      activateTab(tabs[nx]);window.scrollTo(0,0);
    },{passive:true});
  }

  /* ---------------- En-tête ---------------- */
  function renderChip(){var n=nextSession();document.getElementById("wkChip").textContent=(n?(PROGRAM_BLOCKS[n.block].short+" · S"+n.w):"Fini")+" · "+doneCount()+"/"+totalSessions();}

  /* ---------------- Aujourd'hui ---------------- */
  /* Prochaine séance planifiée, TOUS sports actifs confondus (lue depuis le calendrier). */
  function nextScheduled(){
    rebuildSchedule();var cur=todayStr(),g=0;
    while(g<420){g++;var list=sessionsOn(cur);for(var i=0;i<list.length;i++){if(!list[i].done)return {iso:cur,s:list[i]};}cur=isoOf(addDays(cur,1));}
    return null;
  }
  /* Heures de révision d'un jour (même règle que l'app DSCG) — pour le repère 📚. */
  function studyHoursOf(iso){var st=getDayState(iso);if(st==="indispo")return 0;if(st==="conge")return 6;if(st==="cours")return 0.5;var wd=new Date(iso+"T00:00:00").getDay();return (wd===0||wd===6)?6:0.5;}
  /* Heures de révision RÉELLES saisies dans Mouche-Université (clé memoDSCG_v1 — LECTURE SEULE, jamais d'écriture). */
  /* Raccourci vers l'app de révisions (URL prise dans APPS, pas de duplication).
     memoDSCG_v1 reste en LECTURE SEULE : on affiche, on n'écrit jamais. */
  function dscgApp(){var L=(typeof APPS!=="undefined"?APPS:[]);for(var i=0;i<L.length;i++)if(L[i]&&L[i].ready&&L[i].url&&/mouche/i.test(L[i].url))return L[i];return null;}
  function dscgLineTxt(iso){
    var r=dscgDone(),h=r.hasOwnProperty(iso)?r[iso]:null,t=studyHoursOf(iso);
    if(h!=null)return "\u2713 "+nFmt(h)+" h r\u00e9vis\u00e9e"+(h>=2?"s":"")+(t>0?(" \u00b7 objectif "+nFmt(t)+" h"):"");
    return t>0?("Objectif du jour : "+nFmt(t)+" h"):"Pas de r\u00e9vision pr\u00e9vue aujourd\u2019hui";
  }
  function dscgBlockHTML(iso){
    var a=dscgApp();if(!a)return "";
    var r=dscgDone(),done=r.hasOwnProperty(iso)&&r[iso]>0;
    return '<div class="field supps-field">'+
      '<a class="dscg-link'+(done?" done":"")+'" href="'+esc(a.url)+'"><span class="dscg-ic">\ud83d\udcda</span>'+
      '<span class="dscg-txt"><span class="dscg-ttl">R\u00e9visions DSCG</span><span class="dscg-sub">'+esc(dscgLineTxt(iso))+'</span></span>'+
      '<span class="dscg-arrow">\u203a</span></a></div>';
  }
  function dscgDone(){
    try{
      var o=JSON.parse(localStorage.getItem("memoDSCG_v1")||"{}");var d=o&&o.done;
      if(!d||typeof d!=="object")return {};
      var out={};Object.keys(d).forEach(function(k){var v=d[k];if(/^\d{4}-\d{2}-\d{2}$/.test(k)&&typeof v==="number"&&isFinite(v)&&v>=0)out[k]=v;});
      return out;
    }catch(e){return {};}
  }
  function whenLabel(iso){var d=diffDays(iso,todayStr());if(d<=0)return "aujourd'hui";if(d===1)return "demain";return frDateShort(iso)+" · J-"+d;}

  function renderHero(){
    var hero=document.getElementById("heroCard");if(!hero)return;
    var next=nextScheduled();
    if(!next){hero.className="hero";hero.innerHTML='<div class="hero-body" style="padding-top:18px"><div class="lbl">Bravo</div><h2>Tout est bouclé 🎉</h2><div class="meta">Plus de séance planifiée pour l\'instant.</div></div>';return;}
    var s=next.s, muscu=(s.kind==="muscu");
    var icon=muscu?"🏋️":triIcon(s.disc);
    var when=whenLabel(next.iso);
    var body="";
    if(bndOpen.hero){
      if(muscu){var blk=PROGRAM_BLOCKS[s.block],p=progOf(s.block,s.code);
        body='<div class="stitle">'+esc(blk.name)+' · Semaine '+s.w+' · '+esc(p.sub)+'</div>'+
             '<h2>'+esc(p.title.split("—")[0].trim())+' <span class="num">'+s.code+'</span></h2>'+
             '<div class="meta">'+p.exos.length+' exercices · '+when+'</div>'+
             '<div class="row2"><button class="btn accent" id="goSession">Ouvrir la séance</button><button class="btn ghost" id="quickDone">Marquer faite</button></div>';
      }else{
        body='<div class="stitle">'+esc(actName("tri"))+' · Semaine '+s.w+'</div>'+
             '<h2>'+icon+' '+esc(triLabel(s.disc))+'</h2>'+
             '<div class="meta">'+when+'</div>'+
             '<div class="row2"><button class="btn accent" id="goSessionTri">Ouvrir la séance</button><button class="btn ghost" id="quickDoneTri">Marquer faite</button></div>';
      }
    }
    if(bndOpen.hero){
      var fp={type:muscu?"muscu":({nat:"natation",velo:"velo",course:"course"}[s.disc]||"course"),dur:60};
      if(!muscu){var _r=(state.tri||{})[s.w+"_"+s.disc],_du=_r?num(_r.dur):NaN;if(!isNaN(_du)&&_du>0)fp.dur=Math.round(_du);}
      body+='<button type="button" class="btn ghost hero-fuel">\ud83c\udf4c Comment m\'alimenter <b>'+(fuelOpen?"\u2212":"\uff0b")+'</b></button>'+
        (fuelOpen?'<div class="hero-fuelbody"><div class="hf-h">'+esc(s.label)+' \u00b7 '+fp.dur+' min (estim\u00e9)</div>'+fuelHTML(fp)+'<div class="hf-more">Ajuster type / dur\u00e9e \u2192 R\u00e9glages \u25b8 Carburant de s\u00e9ance</div></div>':'');
    }
    hero.className="hero"+(bndOpen.hero?" open":" folded");
    hero.innerHTML=bndHead("hero","card",{render:"hero",ic:icon,k:"Prochaine séance",v:esc(s.label)+' · '+when})
      +(bndOpen.hero?'<div class="hero-body">'+body+'</div>':'');
    var _hf=hero.querySelector(".hero-fuel");if(_hf)_hf.onclick=function(){fuelOpen=!fuelOpen;renderHero();};
    if(bndOpen.hero){
      if(muscu){
        var gs=hero.querySelector("#goSession");if(gs)gs.onclick=function(){sessExpanded={};currentSel={block:s.block,w:s.w,c:s.code};goSport("muscu");var sd=document.getElementById("sessionDetail");if(sd&&sd.scrollIntoView)sd.scrollIntoView({behavior:"smooth",block:"start"});};
        var qd=hero.querySelector("#quickDone");if(qd)qd.onclick=function(){var r=sess(s.block,s.w,s.code);r.done=true;if(!r.date)r.date=todayStr();save();renderChip();renderHero();renderCalendars();};
      }else{
        var gt=hero.querySelector("#goSessionTri");if(gt)gt.onclick=function(){currentTri={w:s.w,dz:s.disc};goSport("tri");var td=document.getElementById("triDetail");if(td&&td.scrollIntoView)td.scrollIntoView({behavior:"smooth",block:"start"});};
        var qt=hero.querySelector("#quickDoneTri");if(qt)qt.onclick=function(){var k=s.w+"_"+s.disc;var r=state.tri[k]||(state.tri[k]={});r.done=true;if(!r.date)r.date=todayStr();save();renderChip();renderHero();renderCalendars();};
      }
    }
  }

  /* ---- Bilan énergétique : profil (taille/âge/sexe), métabolisme de base (Mifflin-St Jeor), dépense ---- */
  var ACT_LEVELS=[
    {k:"lit",  label:"Au lit / malade (× 1,2)",                    f:1.2},
    {k:"sed",  label:"Sédentaire — bureau, peu de pas (× 1,4)",    f:1.4},
    {k:"semi", label:"Semi-actif — ménage, déplacements (× 1,6)",  f:1.6},
    {k:"actif",label:"Très actif — physique toute la journée (× 1,8)", f:1.8}
  ];
  function profileGet(){if(!state.profile||typeof state.profile!=="object")state.profile={sex:"h",height:"",age:"",weight:""};return state.profile;}
  function lastWeight(){var ds=Object.keys(state.days).sort();for(var i=ds.length-1;i>=0;i--){var w=num(state.days[ds[i]].weight);if(!isNaN(w)&&w>0)return w;}var pw=num(profileGet().weight);return (!isNaN(pw)&&pw>0)?pw:null;}
  function bmr(){var p=profileGet(),h=num(p.height),a=num(p.age),w=lastWeight();if(isNaN(h)||h<=0||isNaN(a)||a<=0||w==null)return null;var b=10*w+6.25*h-5*a+(p.sex==="f"?-161:5);return b>0?b:null;}
  function actLevel(d){var x=state.days[d],k=(x&&x.actLvl)||"sed";for(var i=0;i<ACT_LEVELS.length;i++)if(ACT_LEVELS[i].k===k)return ACT_LEVELS[i];return ACT_LEVELS[1];}
  /* Dépense des activités (Compendium of Physical Activities : MET × poids × durée ; raccourci distance pour marche/course). */
  var MET={muscu:5,run:9,bike:7,swim:8,walk:3.5};
  var MUSCU_MIN=60; /* durée par défaut d'une séance muscu (pas d'horodatage stocké) */
  function kcalMET(met,kg,min){return met*kg*(min/60);}
  function actKcal(kind,dist,min,kg){dist=num(dist);min=num(min);
    if(kind==="run"){if(!isNaN(dist)&&dist>0)return kg*dist;if(!isNaN(min)&&min>0)return kcalMET(MET.run,kg,min);return 0;}
    if(kind==="walk"){if(!isNaN(min)&&min>0)return kcalMET(MET.walk,kg,min);if(!isNaN(dist)&&dist>0)return 0.5*kg*dist;return 0;}
    if(kind==="bike"){if(!isNaN(min)&&min>0)return kcalMET(MET.bike,kg,min);if(!isNaN(dist)&&dist>0)return kcalMET(MET.bike,kg,(dist/18)*60);return 0;}
    if(kind==="swim"){if(!isNaN(min)&&min>0)return kcalMET(MET.swim,kg,min);if(!isNaN(dist)&&dist>0)return kcalMET(MET.swim,kg,(dist/1000)*25);return 0;}
    if(kind==="muscu")return kcalMET(MET.muscu,kg,MUSCU_MIN);
    return 0;}
  function sessionsKcal(d,kg){var tot=0;
    Object.keys(state.sessions||{}).forEach(function(k){var s=state.sessions[k];if(s&&s.done&&s.date===d)tot+=actKcal("muscu",0,0,kg);});
    var mp={nat:"swim",velo:"bike",course:"run"};
    Object.keys(state.tri||{}).forEach(function(k){var r=state.tri[k];if(r&&r.done&&r.date===d){var kd=mp[k.split("_")[1]];if(kd)tot+=actKcal(kd,r.dist,r.dur,kg);}});
    return tot;}
  function dayActKcal(d,kg){var x=state.days[d],a=x&&x.act;if(!a)return 0;var t=0;if(a.walk)t+=actKcal("walk",a.walk.d,a.walk.t,kg);if(a.bike)t+=actKcal("bike",a.bike.d,a.bike.t,kg);return t;}
  function actExtra(d){var kg=lastWeight();if(kg==null)return 0;return Math.round(sessionsKcal(d,kg)+dayActKcal(d,kg));}
  function actOverride(d){var x=state.days[d];var v=x&&x.actKcal;if(v==null||v==="")return null;var n=num(v);return (isFinite(n)&&n>=0)?Math.round(n):null;}
  function expend(d){var b=bmr();if(b==null)return null;var ov=actOverride(d);if(ov!=null)return Math.round(b)+ov;return Math.round(b*actLevel(d).f)+actExtra(d);}
  function adjIntake(d){var x=state.days[d];if(x&&x.kcalAdj!=null&&x.kcalAdj!==""){var v=num(x.kcalAdj);if(!isNaN(v)&&v>=0)return Math.round(v);}var t=dayTotals(d);return t?Math.round(t.kcal):0;}

  function renderDayBalance(d,hostOverride){
    var host=hostOverride||document.getElementById("dayBalance");if(!host)return;
    var b=bmr(),t=dayTotals(d),intake=adjIntake(d),lv=actLevel(d),out=expend(d),net=(out!=null)?(intake-out):null;
    function lab(n){return Math.abs(n)<75?" · équilibre":(n<0?" · déficit":" · surplus");}
    var hv=(b==null)?"profil à compléter":((net>0?"+":"")+net+" kcal"+lab(net));
    var head=hostOverride?"":bndHead("bal","card",{render:"bal",ic:"⚖️",k:"Bilan énergie",v:hv});
    var body="";
    if(hostOverride||bndOpen.bal){
      if(b==null){
        body='<div class="bal-body"><div class="bal-empty">Ajoute ta <b>taille</b>, ton <b>âge</b> et ton <b>sexe</b> dans Réglages ▸ Profil pour estimer ta dépense.</div><div class="bal-row"><span>🍽️ Apport du jour</span><b>'+intake+' kcal</b></div></div>';
      }else{
        var kg=lastWeight(),extra=actExtra(d),sess=(kg!=null?Math.round(sessionsKcal(d,kg)):0),a=(state.days[d]&&state.days[d].act)||{},x=state.days[d]||{},ov=actOverride(d);
        function aRow(kind,label,v){v=v||{};return '<div class="bal-act"><span class="bal-act-l">'+label+'</span><input type="number" inputmode="decimal" step="0.1" class="bal-a-d" data-act="'+kind+'" value="'+esc(v.d||"")+'" placeholder="km"><input type="number" inputmode="numeric" class="bal-a-t" data-act="'+kind+'" value="'+esc(v.t||"")+'" placeholder="min"></div>';}
        var lvls=ACT_LEVELS.map(function(l){return '<button type="button" class="bal-lvl'+(l.k===lv.k?" on":"")+'" data-lvl="'+l.k+'">'+esc(l.label.split(" (")[0].split(" — ")[0])+'</button>';}).join("");
        body='<div class="bal-body">'+
          '<div class="bal-net'+(net<0?" neg":(net>75?" pos":""))+'"><span class="bal-net-v">'+(net>0?"+":"")+net+'</span><span class="bal-net-u">kcal net'+lab(net)+'</span></div>'+
          '<div class="bal-row"><span>🍽️ Apport</span><b>'+intake+' kcal</b></div>'+
          '<div class="bal-row"><span>🔥 Dépense</span><b>'+out+' kcal</b></div>'+
          '<div class="bal-sub">'+(ov!=null?('métabolisme '+Math.round(b)+' + actives Watch '+ov):('métabolisme '+Math.round(b)+' × '+nFmt(lv.f)+(extra>0?(' + activités '+extra):'')))+'</div>'+
          '<div class="bal-lvls-l">⌚ Actives mesurées (Watch)</div>'+
          '<div class="bal-acts"><div class="bal-act"><span class="bal-act-l">kcal actives</span><input type="number" inputmode="numeric" step="1" class="bal-watch-in" value="'+esc(x.actKcal||"")+'" placeholder="ex. 650"></div></div>'+
          '<div class="bal-lvls-l">Niveau de vie hors sport</div><div class="bal-lvls">'+lvls+'</div>'+
          '<div class="bal-lvls-l">Activités du jour</div>'+
          '<div class="bal-acts">'+aRow("walk","🚶 Marche",a.walk)+aRow("bike","🚴 Vélo",a.bike)+'</div>'+
          (ov!=null?'<div class="bal-sub" style="color:var(--primary)">Override Watch actif : niveau de vie et activités ci-dessus non comptés.</div>':'')+
          (sess>0?'<div class="bal-sub">séances enregistrées comptées : '+sess+' kcal</div>':'')+
          '<div class="bal-note">Estimation ±15-20 %. La tendance sur la semaine compte plus que le chiffre du jour ; pour ta prépa triathlon, l\'enjeu est de bien alimenter l\'effort, pas de creuser un déficit.</div>'+
        '</div>';
      }
    }
    host.innerHTML=head+body;

    host.querySelectorAll(".bal-lvl").forEach(function(bt){bt.onclick=function(){day(d).actLvl=bt.getAttribute("data-lvl");save();renderDayBalance(d,hostOverride);};});
    host.querySelectorAll(".bal-a-d,.bal-a-t").forEach(function(inp){inp.onchange=function(){var kind=inp.getAttribute("data-act"),dd=day(d);if(!dd.act)dd.act={};if(!dd.act[kind])dd.act[kind]={d:"",t:""};dd.act[kind][inp.classList.contains("bal-a-d")?"d":"t"]=inp.value;save();renderDayBalance(d,hostOverride);};});
    var wi=host.querySelector(".bal-watch-in");if(wi)wi.onchange=function(){var dd=day(d),v=wi.value.trim();if(v==="")delete dd.actKcal;else dd.actKcal=v;save();renderDayBalance(d,hostOverride);};
  }
  function protAvg7(){var s=0,n=0;for(var i=0;i<7;i++){var d=isoOf(addDays(todayStr(),-i));var t=dayTotals(d);if(t){s+=(t.protEff!=null?t.protEff:t.prot);n++;}}return n?{avg:s/n,n:n}:null;}
  function balAvg7(){var s=0,n=0;for(var i=0;i<7;i++){var d=isoOf(addDays(todayStr(),-i));var out=expend(d);if(out==null)continue;var xx=state.days[d]||{},hasAdj=(xx.kcalAdj!=null&&xx.kcalAdj!=="");if(!dayTotals(d)&&!hasAdj)continue;s+=(adjIntake(d)-out);n++;}return n?{avg:s/n,n:n}:null;}
  function protBreakHTML(t){
    var comp=Math.round(t.pComp+t.pOther),mn=Math.min(t.pC,t.pL),uC=t.pC-mn,uL=t.pL-mn;
    var rows='<div class="pb-row pb-comp"><span class="pb-k">✅ Complètes</span>'+
      '<details class="base-hint inl"><summary>i</summary><div>Total brut du jour : <b>'+fr1(t.prot)+' g</b>. Seules les protéines <b>complètes</b> (viande, poisson, œuf, laitages, soja) et les <b>appariées</b> céréale + légumineuse comptent vers ta cible : prise seule, une protéine végétale manque d\'un acide aminé essentiel, et le muscle ne peut pas se construire avec une brique incomplète.</div></details>'+
      '<b>'+comp+' g</b></div>';
    if(t.pair>0)rows+='<div class="pb-row pb-pair"><span>🔗 Appariées céréale+légumineuse</span><b>+'+Math.round(t.pair)+' g</b></div>';
    if(uC>0.5)rows+='<div class="pb-row pb-un"><span>🌾 Céréale seule <i>(+ légumineuse pour compter)</i></span><b>'+Math.round(uC)+' g</b></div>';
    if(uL>0.5)rows+='<div class="pb-row pb-un"><span>🫘 Légumineuse seule <i>(+ céréale pour compter)</i></span><b>'+Math.round(uL)+' g</b></div>';
    return '<div class="pb">'+rows+'</div>';
  }
  /* Comble-écart protéines : à partir des g manquants, propose des quantités
     concrètes tirées du catalogue (base_aliments.json + aliments déjà notés).
     Filtre "protéine-forward" : au moins 25 % des calories issues des protéines
     — sinon on proposerait du pain ou des pâtes pour combler des protéines. */
  /* Famille d'aliment protéiné : sert à diversifier les propositions
     (sans ça, le tri par apport décroissant ne sort que de la viande). */
  function pfType(name){
    var s=fqKey(name).replace(/\u0153/g,"oe");
    if(/whey|isolat|caseine|proteine/.test(s))return "poudre";
    if(/skyr|yaourt|fromage|cottage|faisselle|ricotta|petit-suisse|lait|kefir/.test(s))return "laitier";
    if(/thon|saumon|poisson|cabillaud|sardine|maquereau|crevette|colin|merlu|truite|hareng/.test(s))return "poisson";
    if(/poulet|dinde|boeuf|steak|jambon|porc|veau|agneau|viande|bavette|escalope/.test(s))return "viande";
    if(/\boeufs?\b|omelette|blancs? d.?\s?oeuf/.test(s))return "oeuf";
    if(/tofu|tempeh|lentille|pois chiche|haricot|soja|seitan|edamame|spiruline|huitre/.test(s))return "vegetal";
    return "autre";
  }
  function protFill(remaining){
    var cat=foodCatalog(),out=[],seen={};
    Object.keys(cat).forEach(function(k){
      var f=cat[k],n=f.nut;if(!n)return;
      var base=num(n.base),prot=num(n.prot),kcal=num(n.kcal);
      if(isNaN(base)||base<=0||isNaN(prot)||prot<=0)return;
      if(!isNaN(kcal)&&kcal>0&&(prot*4)/kcal<0.25)return;      /* trop dilué : glucidique avant tout */
      var nm=(""+f.name).trim();var key=fqKey(nm);if(seen[key])return;seen[key]=1;
      var bu=(n.baseUnit||f.unit||"g"),solid=/^(g|ml)$/i.test(bu),dens=prot/base;
      var portion=num(n.portion);
      if(isNaN(portion)||portion<=0)portion=solid?100:1;        /* portion type de la base, sinon défaut */
      var gives=portion*dens;
      if(gives>50){portion=portion*(50/gives);}                 /* jamais une portion démesurée */
      portion=solid?Math.max(10,Math.round(portion/10)*10):Math.max(1,Math.round(portion));
      gives=portion*dens;
      if(gives<8)return;                                        /* apport trop faible pour peser */
      var kc=(!isNaN(kcal)&&kcal>0)?portion*(kcal/base):null;
      var q=foodQuality(nm);
      out.push({name:nm,qty:portion,unit:bu,prot:gives,kcal:kc,
        complete:!!(q&&q.p===1),incomplete:!!(q&&q.p===2),ultra:!!(q&&q.n===3),
        eff:(kc!=null&&gives>0)?kc/gives:999});
    });
    out.sort(function(a,b){
      if(Math.round(b.prot)!==Math.round(a.prot))return b.prot-a.prot;  /* le plus gros apport d'abord */
      if(a.ultra!==b.ultra)return a.ultra?1:-1;                 /* à apport égal : le moins transformé */
      return a.eff-b.eff;                                       /* puis le moins calorique */
    });
    var byType={},varied=[];                                    /* 1 par famille : évite 4 viandes d'affilée */
    out.forEach(function(o){var t=pfType(o.name);if(byType[t])return;byType[t]=1;varied.push(o);});
    while(varied.length<4&&varied.length<out.length){
      for(var i=0;i<out.length&&varied.length<4;i++)if(varied.indexOf(out[i])<0)varied.push(out[i]);
    }
    return varied.slice(0,4);
  }
   /* Comble-écart : ajout en 1 tap. Le repas cible est déduit de l'heure ; l'ajout
     reste annulable tant qu'aucun autre n'a été fait. unit = nut.baseUnit imposé,
     sinon scaleNut retombe sur f=1 et la quantité serait ignorée. */
  var pfAdded=null;
  function pfMealNow(){var h=new Date().getHours();return h<11?"pd":(h<15?"dj":(h<18?"co":(h<23?"dn":"co")));}
  function pfMealLabel(k){return k==="pd"?"au petit-d\u00e9jeuner":(k==="dj"?"au d\u00e9jeuner":(k==="dn"?"au d\u00eener":"\u00e0 la collation"));}
  function pfAdd(name,qty){
    var k=(""+name).trim().toLowerCase(),c=foodCatalog()[k];if(!c||!c.nut)return;
    var d=todayStr(),x=day(d);if(!x.mealItems)x.mealItems={};
    var mk=pfMealNow();if(!x.mealItems[mk])x.mealItems[mk]=[];
    var nt=c.nut,u=nt.baseUnit||c.unit||"g";
    x.mealItems[mk].push({name:c.name,qty:String(qty),unit:u,nut:{base:nt.base,baseUnit:u,kcal:nt.kcal,prot:nt.prot,gluc:nt.gluc,lip:nt.lip,portion:nt.portion}});
    pfAdded={n:c.name,m:mk,i:x.mealItems[mk].length-1};save();pfRefresh();
  }
  function pfUndo(){
    if(!pfAdded)return;var d=todayStr(),x=day(d),a=(x.mealItems&&x.mealItems[pfAdded.m])||[];
    if(a[pfAdded.i]&&a[pfAdded.i].name===pfAdded.n)a.splice(pfAdded.i,1);
    pfAdded=null;save();pfRefresh();
  }
  function pfRefresh(){renderDayNutri(dayDate);var h=document.getElementById("dayLog");if(h&&h.innerHTML)buildDayForm(h,dayDate);renderDayRadar();}
  function protFillHTML(remaining){
    if(!(remaining>0))return "";
    var l=protFill(remaining);
    if(!l.length)return '<div class="pf-box"><div class="pf-h">Combler les '+remaining+' g</div><div class="pf-empty">Aucun aliment protéiné exploitable dans ta base pour l\u2019instant. Note un repas ou ouvre R\u00e9glages ▸ Aliments pour en compl\u00e9ter un.</div></div>';
    var rows=l.map(function(o){
      var qt=(/^(g|ml)$/i.test(o.unit)?(Math.round(o.qty)+"\u2009"+o.unit):(Math.round(o.qty)+"\u00d7"));
      var badge=(o.complete?'<span class="pf-b">\ud83d\udcaa</span>':(o.incomplete?'<span class="pf-b">\ud83c\udf31</span>':""))+(o.ultra?'<span class="pf-b">\ud83d\udd34</span>':"");
      var kc=o.kcal!=null?('<span class="pf-kcal">'+Math.round(o.kcal)+' kcal</span>'):"";
      return '<button type="button" class="pf-row" data-pf="'+esc(o.name)+'" data-q="'+Math.round(o.qty)+'"><span class="pf-q">'+qt+'</span><span class="pf-n">'+esc(o.name)+badge+'</span><span class="pf-p">+'+Math.round(o.prot)+'\u2009g</span>'+kc+'<span class="pf-add">\uff0b</span></button>';    }).join("");
     var okBar=pfAdded?('<div class="pf-ok">\u2713 '+esc(pfAdded.n)+' ajout\u00e9 <b>'+pfMealLabel(pfAdded.m)+'</b><button type="button" class="pf-undo">Annuler</button></div>'):"";
    var best=Math.round(l[0].prot),n=Math.max(1,Math.ceil(remaining/best));
    var howMany=n>1?('Il t\u2019en faut environ <b>'+n+'</b> de ce calibre pour combler l\u2019\u00e9cart \u2014 r\u00e9partis-les sur tes prochains repas plut\u00f4t qu\u2019en une fois : au-del\u00e0 de ~40 g par prise, le surplus sert surtout de carburant.')
      :('Une seule portion suffit \u00e0 combler l\u2019\u00e9cart.');
    return '<div class="pf-box">'+okBar+'<div class="pf-h">Combler les '+remaining+' g \u00b7 portions types</div>'+rows+      '<div class="pf-note">'+howMany+'</div>'+
      '<div class="pf-note">\ud83d\udcaa profil complet \u00b7 \ud83c\udf31 \u00e0 compl\u00e9ter dans la journ\u00e9e (c\u00e9r\u00e9ale + l\u00e9gumineuse) \u00b7 \ud83d\udd34 ultra-transform\u00e9 : pratique en d\u00e9pannage, pas la base.</div></div>';
  }
  function nutriTip(tot){
    if(!tot)return 'Note tes repas pour suivre ta cible protéines — c\'est ton levier n°1 pour la forme plage.';
    var ep=(tot.protEff!=null?tot.protEff:tot.prot);
    if(ep>=130)return '✓ Cible tenue. Les protéines sont ton point clé d\'ici la plage — garde ce rythme.';
    var r=Math.round(130-ep);
    return 'Encore ~'+r+' g. Un panier TGTG penche souvent sucre/gras : le complément protéiné se choisit ci-dessous.';
  }
  function wireTgtg(bt,pn,d,afterAdd){
    if(!bt||!pn)return;
    bt.addEventListener("click",function(){
      if(!pn.hidden){pn.hidden=true;return;}
      var tot=dayTotals(d),reste=Math.round(130-((tot&&tot.prot)||0));
      if(reste<=0){pn.innerHTML='<div class="tgtg-ok">✓ Cible protéines atteinte — rien à rattraper aujourd\'hui.</div>';pn.hidden=false;return;}
      var cat=foodCatalog(),opts=[];
      Object.keys(cat).forEach(function(k){var it=cat[k];if(!it.nut)return;var p=num(it.nut.prot);if(isNaN(p)||p<8)return;opts.push({name:it.name,unit:it.unit,nut:it.nut,p:p,st:it.cat==="staples"?1:0});});
      opts.sort(function(a,b){return (b.st-a.st)||(b.p-a.p);});opts=opts.slice(0,4);
      if(!opts.length){pn.innerHTML='<div class="tgtg-ok">Aucun aliment protéiné dans ta base — enrichis base_aliments.json.</div>';pn.hidden=false;return;}
      pn.innerHTML='<div class="tgtg-head">Il te reste ~'+reste+' g de protéines — ajoute en un tap :</div>'+
        opts.map(function(o,i){return '<button type="button" class="tgtg-opt" data-i="'+i+'"><span class="to-n">'+esc(o.name)+'</span><span class="to-p">+'+nFmt(o.p)+' g</span><span class="to-b">'+esc(o.nut.base)+' '+esc(o.nut.baseUnit||o.unit||"g")+'</span></button>';}).join("");
      pn.hidden=false;
      pn.querySelectorAll(".tgtg-opt").forEach(function(b){b.onclick=function(){var o=opts[+b.getAttribute("data-i")];
        var xx=day(d);if(!xx.mealItems)xx.mealItems={pd:[],dj:[],dn:[],co:[]};if(!xx.mealItems.co)xx.mealItems.co=[];
        xx.mealItems.co.push({name:o.name,qty:""+o.nut.base,unit:o.nut.baseUnit||o.unit||"g",nut:JSON.parse(JSON.stringify(o.nut))});
        save();if(afterAdd)afterAdd();};});
    });
  }
  function lookupBarcode(code,cb){code=(""+(code||"")).replace(/\D/g,"");if(!code){cb(null,"Entre un code-barres.");return;}if(typeof fetch==="undefined"){cb(null,"Recherche indisponible sur ce navigateur.");return;}
    fetch("https://world.openfoodfacts.org/api/v2/product/"+encodeURIComponent(code)+".json?fields=product_name,product_name_fr,nutriments").then(function(r){return r.json();}).then(function(data){
      if(data&&data.status===1&&data.product){var pr=data.product,n=pr.nutriments||{};var nm=((pr.product_name_fr||pr.product_name||"")+"").trim()||("Produit "+code);
        var nut={base:"100",baseUnit:"g",kcal:(n["energy-kcal_100g"]!=null?Math.round(n["energy-kcal_100g"]):""),prot:(n.proteins_100g!=null?n.proteins_100g:""),gluc:(n.carbohydrates_100g!=null?n.carbohydrates_100g:""),lip:(n.fat_100g!=null?n.fat_100g:""),portion:""};
        cb({name:nm,nut:nut});
      }else{cb(null,"Produit non trouvé — saisis les valeurs à la main.");}
    }).catch(function(){cb(null,"Pas de connexion — réessaie, ou saisis à la main.");});
  }
  var crsScanner=null;
  function loadScanLib(cb){if(window.Html5Qrcode){cb(true);return;}var s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";s.onload=function(){cb(!!window.Html5Qrcode);};s.onerror=function(){cb(false);};document.head.appendChild(s);}
  function scanStatus(m){var e=document.getElementById("crsScanStatus");if(e)e.textContent=m||"";}
  function closeScanner(){var modal=document.getElementById("crsScanModal");var zw=document.getElementById("crsZoomWrap");if(zw)zw.hidden=true;var tb=document.getElementById("crsTorch");if(tb){tb.hidden=true;tb.setAttribute("data-on","0");tb.textContent="🔦 Torche";}if(crsScanner){try{crsScanner.stop().then(function(){try{crsScanner.clear();}catch(e){}}).catch(function(){});}catch(e){}crsScanner=null;}if(modal)modal.hidden=true;}
  function setupZoomTorch(){if(!crsScanner||!crsScanner.getRunningTrackCapabilities)return;var caps;try{caps=crsScanner.getRunningTrackCapabilities();}catch(e){caps=null;}if(!caps)return;
    var zEl=document.getElementById("crsZoom"),zWrap=document.getElementById("crsZoomWrap");
    if(caps.zoom&&zEl&&zWrap&&(caps.zoom.max||1)>(caps.zoom.min||1)){var zmin=caps.zoom.min||1,zmax=caps.zoom.max||1;zEl.min=zmin;zEl.max=zmax;zEl.step=caps.zoom.step||0.1;var zInit=Math.min(zmax,zmin+(zmax-zmin)*0.4);zEl.value=zInit;zWrap.hidden=false;try{crsScanner.applyVideoConstraints({advanced:[{zoom:zInit}]});}catch(e){}zEl.oninput=function(){try{var p=crsScanner.applyVideoConstraints({advanced:[{zoom:parseFloat(zEl.value)}]});if(p&&p.catch)p.catch(function(){});}catch(e){}};}
    var tBtn=document.getElementById("crsTorch");
    if(caps.torch&&tBtn){tBtn.hidden=false;tBtn.setAttribute("data-on","0");tBtn.onclick=function(){var on=tBtn.getAttribute("data-on")!=="1";try{var p=crsScanner.applyVideoConstraints({advanced:[{torch:on}]});if(p&&p.then){p.then(function(){tBtn.setAttribute("data-on",on?"1":"0");tBtn.textContent=on?"🔦 Torche (on)":"🔦 Torche";}).catch(function(){});}else{tBtn.setAttribute("data-on",on?"1":"0");}}catch(e){}};}
  }
  function openScanner(onResult){var modal=document.getElementById("crsScanModal");if(!modal)return;modal.hidden=false;scanStatus("Chargement du scanner…");
    var cbtn=document.getElementById("crsScanClose");if(cbtn)cbtn.onclick=function(){closeScanner();};
    function finish(res,msg,code){if(res){closeScanner();if(onResult)onResult(res);fqToast("✓ Trouvé : "+(res.name||"produit"));}else{modal.hidden=false;scanStatus((code?("Code "+code+" — "):"")+(msg||"Produit non trouvé — saisis les valeurs à la main."));}}
    var mi=document.getElementById("crsManualCode"),mg=document.getElementById("crsManualGo");
    if(mi)mi.value="";
    function manualGo(){if(!mi)return;var c=(mi.value||"").replace(/\D/g,"");if(!c){scanStatus("Entre le numéro inscrit sous le code-barres.");mi.focus();return;}scanStatus("Recherche du produit…");lookupBarcode(c,function(res,msg){finish(res,msg,c);});}
    if(mg)mg.onclick=manualGo;
    if(mi)mi.onkeydown=function(e){if(e.key==="Enter"){e.preventDefault();manualGo();}};
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){scanStatus("Caméra non disponible ici — saisis le numéro du code-barres ci-dessous.");return;}
    loadScanLib(function(ok){if(!ok||!window.Html5Qrcode){scanStatus("Scanner non chargé (connexion ?) — tu peux saisir le numéro ci-dessous.");return;}
      try{crsScanner=new window.Html5Qrcode("crsCam");
        var fmts;try{var F=window.Html5QrcodeSupportedFormats;fmts=[F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E];}catch(e){fmts=undefined;}
        var vc={facingMode:"environment",width:{ideal:1280},height:{ideal:720},advanced:[{focusMode:"continuous"}]};
        var cfg={fps:12,qrbox:function(w,h){var bw=Math.floor(Math.min(w*0.9,340));return {width:bw,height:Math.floor(Math.min(bw*0.55,h*0.7))};},aspectRatio:1.7778,experimentalFeatures:{useBarCodeDetectorIfSupported:false},formatsToSupport:fmts};
        crsScanner.start(vc,cfg,function(txt){var code=(""+txt).replace(/\D/g,"");closeScanner();scanStatus("Recherche du produit…");lookupBarcode(code,function(res,msg){finish(res,msg,code);});},function(){}).then(function(){scanStatus("Cadre le code-barres, ou saisis le numéro ci-dessous.");setupZoomTorch();}).catch(function(){scanStatus("Caméra refusée ou indisponible — saisis le numéro ci-dessous.");});
      }catch(e){scanStatus("Scanner indisponible — saisis le numéro ci-dessous.");}
    });
  }
  var mealDistMode="prot";
  function mdLbl(l){return l==="Petit-déjeuner"?"Petit-déj":l;}
  function dayMealDistHTML(d){
    var x=state.days[d];if(!x)return "";
    var mi=x.mealItems||{};
    var hasMeal=MEALS.some(function(m){return mi[m.k]&&mi[m.k].length;});
    var hasSupp=x.supps&&typeof SUPPS!=="undefined"&&SUPPS.some(function(sp){return sp.prot&&x.supps[sp.id];});
    if(!hasMeal&&!hasSupp)return "";
    var mode=mealDistMode==="kcal"?"kcal":"prot";
    var rows=MEALS.map(function(m){var v=0;(mi[m.k]||[]).forEach(function(it){var s=scaleNut(it);if(s)v+=(mode==="kcal"?(s.kcal||0):(s.prot||0));});
      if(x.supps&&typeof SUPPS!=="undefined")SUPPS.forEach(function(sp){if(!sp.prot||!x.supps[sp.id])return;if((((x.suppMeal&&x.suppMeal[sp.id])||"co"))!==m.k)return;var mul=(x.supps2&&x.supps2[sp.id])?2:1;v+=(mode==="kcal"?(num(sp.kcal)||0):sp.prot)*mul;});
      return {label:m.label,v:v};});
    var toggle='<div class="md-modes"><button type="button" class="md-mode'+(mode==="prot"?" on":"")+'" data-mode="prot">Protéines</button><button type="button" class="md-mode'+(mode==="kcal"?" on":"")+'" data-mode="kcal">kcal</button></div>';
    var peak=rows.reduce(function(a,r){return Math.max(a,r.v);},0);
    if(mode==="kcal"){
      var tot=Math.round(rows.reduce(function(a,r){return a+r.v;},0));var mxk=(peak*1.1)||1;
      var kb=rows.map(function(r){var kc=Math.round(r.v);var w=Math.max(2,Math.round(r.v/mxk*100));return '<div class="md-row"><span class="md-lbl">'+esc(mdLbl(r.label))+'</span><span class="md-track"><span class="md-fill kc" style="width:'+w+'%"></span></span><span class="md-val">'+kc+'</span></div>';}).join("");
      return '<div class="mealdist">'+toggle+'<div class="mealdist-h">Répartition énergie · '+tot+' kcal au total</div>'+kb+'<div class="mealdist-cap">Où va ton énergie sur la journée. Pas de « plafond » par repas comme les protéines — mais pense à bien alimenter autour de tes séances.</div></div>';
    }
    var bw=lastWeight();var lo=bw?Math.round(0.3*bw):24,hi=bw?Math.round(0.55*bw):41;var mxp=(Math.max(hi,peak)*1.1)||1;
    var bars=rows.map(function(r){var pr=Math.round(r.v);var zone=r.v<=0?"z0":(r.v<lo?"lo":(r.v>hi?"hi":"ok"));var w=Math.max(2,Math.round(r.v/mxp*100));return '<div class="md-row"><span class="md-lbl">'+esc(mdLbl(r.label))+'</span><span class="md-track"><span class="md-fill '+zone+'" style="width:'+w+'%"></span></span><span class="md-val">'+pr+' g</span></div>';}).join("");
    return '<div class="mealdist">'+toggle+'<div class="mealdist-h">Répartition protéines · repère ~'+lo+'–'+hi+' g/repas</div>'+bars+'<div class="mealdist-cap">🟢 dans la zone · 🟡 un peu léger · 🔵 gros apport d\'un coup — ça compte pour ton total, mais stimule moins la synthèse musculaire : mieux vaut étaler sur la journée.</div></div>';
  }
  function renderDayNutri(d,hostOverride){
    var isTd=(d===todayStr());
    var tot=dayTotals(d);
    var nut=hostOverride||document.getElementById("dayNutri");
    if(nut){
      var eff=tot?(tot.protEff!=null?tot.protEff:tot.prot):0;
      var reste=tot?Math.round(130-eff):130;
      var vtxt=(tot?fr1(eff):"0")+' g'+(tot?(eff>=130?' · ✓ cible':' · encore '+reste+' g'):' · à noter');
      var head=hostOverride?"":bndHead("nutri","card",{render:"nutri",ic:"🥩",k:"Protéines du jour",v:vtxt});
      var body="";
      if(hostOverride||bndOpen.nutri){
        var a7=protAvg7();
        var avgLine=a7?'<div class="nutri-avg">Moyenne 7 j : <b>'+fr1(a7.avg)+' g</b>/j'+(a7.avg>=130?' ✓':'')+'</div>':'';
        if(tot){
          var statTxt=eff>=130?'<span class="ok">✓ cible atteinte</span>':'<span class="low">encore '+reste+' g pour la cible</span>';
          body='<div class="nutri-body"><div class="nutri-card"><div class="nutri-left"><span class="nutri-v">'+fr1(eff)+'</span><span class="nutri-u">g complètes</span></div><div class="nutri-right"><div class="nutri-kcal">'+Math.round(tot.kcal)+' kcal</div><div class="nutri-goal">cible 130–150 g · '+statTxt+'</div></div></div>'+protBreakHTML(tot)+dayMealDistHTML(d)+avgLine+'<div class="nutri-tip">'+nutriTip(tot)+'</div>'+(isTd?protFillHTML(reste):'')+'<button type="button" class="btn ghost nutri-tgtg"'+(isTd?'':' hidden')+'>🥡 J\'ai mangé un TGTG</button><div class="tgtg-panel" hidden></div></div>';
        }else{
          body='<div class="nutri-body"><div class="nutri-card empty">Pas encore de repas noté aujourd\'hui — ajoute-les plus bas pour suivre tes protéines (cible 130–150 g).</div>'+avgLine+'<div class="nutri-tip">'+nutriTip(null)+'</div><button type="button" class="btn ghost nutri-tgtg">🥡 J\'ai mangé un TGTG</button><div class="tgtg-panel" hidden></div></div>';
        }
      }
      nut.innerHTML=head+body;

     nut.querySelectorAll(".md-mode").forEach(function(b){b.onclick=function(){mealDistMode=b.getAttribute("data-mode");renderDayNutri(d,hostOverride);};});
      nut.querySelectorAll(".pf-row").forEach(function(b){b.onclick=function(){pfAdd(b.getAttribute("data-pf"),b.getAttribute("data-q"));};});
      var pu=nut.querySelector(".pf-undo");if(pu)pu.onclick=function(){pfUndo();};      var tg=nut.querySelector(".nutri-tgtg"),tp=nut.querySelector(".tgtg-panel");if(tg&&tp)wireTgtg(tg,tp,d,function(){renderDayNutri(d,hostOverride);buildDayForm(document.getElementById("dayLog"),d);});
    }
    var sp=isTd?document.getElementById("stickyProt"):null;
    if(sp){
      if(tot){var ef=(tot.protEff!=null?tot.protEff:tot.prot);var rst=Math.round(130-ef);var st2=ef>=130?'<span class="ok">✓ cible</span>':'<span class="low">encore '+rst+' g</span>';
        sp.innerHTML='<div class="sprot"><span class="sprot-v">'+fr1(ef)+' g</span><span class="sprot-goal">protéines · cible 130–150 · '+st2+'</span></div>';
      }else sp.innerHTML='<div class="sprot"><span class="sprot-v">0 g</span><span class="sprot-goal">protéines aujourd\'hui</span></div>';
    }
    renderDayBalance(d);
  }
   /* ===== OBJECTIFS DU RADAR, DATÉS =====
     state.goals = [{from:"AAAA-MM-JJ", g:{prot:130,…}}, …]
     Un objectif s'applique à partir de sa date. Changer un objectif aujourd'hui
     ne réécrit donc JAMAIS l'évaluation des jours passés : le 12 juin garde les
     objectifs du 12 juin. C'est la seule façon d'avoir un historique honnête. */
  var GOAL_DEF={sport:1,prot:130,sleep:8,water:8,anchors:1,kcal:null};
  var GOAL_LBL={sport:["\ud83c\udfc3","Sport","activit\u00e9s par jour"],
                prot:["\ud83e\udd69","Prot\u00e9ines","g par jour"],
                sleep:["\ud83d\ude34","Sommeil","heures par nuit"],
                water:["\ud83d\udca7","Eau","verres par jour"],
                anchors:["\ud83d\udd01","\u00c0-c\u00f4t\u00e9s","ancrages tenus par jour"],
                kcal:["\u2696\ufe0f","Bilan kcal","kcal d'\u00e9cart vis\u00e9 par jour"]};
  function goalsAt(d){
    var g={};for(var k in GOAL_DEF)g[k]=GOAL_DEF[k];
    var h=(state.goals||[]).slice().sort(function(p,q){return p.from<q.from?-1:1;});
    h.forEach(function(e){if(e.from<=d&&e.g)for(var k in e.g)if(e.g[k]!=null&&e.g[k]!=="")g[k]=num(e.g[k]);});
    if(g.kcal==null){var kg=num(state.kcalGoal);g.kcal=isNaN(kg)?300:kg;}
    return g;
  }
  function goalsSetToday(patch){
    var t=todayStr();state.goals=state.goals||[];
    var e=null;for(var i=0;i<state.goals.length;i++)if(state.goals[i].from===t)e=state.goals[i];
    if(!e){e={from:t,g:{}};state.goals.push(e);}
    for(var k in patch)e.g[k]=patch[k];
    state.goals.sort(function(p,q){return p.from<q.from?-1:1;});
    save();
  }
  function radarDay(d){
    var x=state.days[d]||{};
    function clamp(v){return v<0?0:(v>1?1:v);}
    var sportsN=(x.sports&&x.sports.length)?x.sports.length:0;
    var muscuT=Object.keys(state.sessions||{}).some(function(k){var s=state.sessions[k];return s&&s.done&&s.date===d;})?1:0;
    var triT=Object.keys(state.tri||{}).some(function(k){var r=state.tri[k];return r&&r.done&&r.date===d;})?1:0;
    var sportU=sportsN+muscuT+triT;
    var prot=Math.round(pEff(dayTotals(d)));
    var sl=num(x.sleep);if(isNaN(sl))sl=0;
    var eau=(typeof x.water==="number"&&x.water>0)?x.water:0;
    var G=goalsAt(d);
    var anch=customRoutines(),cDone,cTot;
    /* cTot = l'OBJECTIF du jour (ex. « au moins 1 »), pas le nombre d'ancrages créés :
       ajouter une 4e routine ne doit pas faire chuter les jours déjà validés. */
    if(anch.length){cTot=Math.max(1,G.anchors);cDone=anch.filter(function(a){return crDoneOn(a.id,d);}).length;}
    else{cTot=1;cDone=habitDoneOn(d)?1:0;}
    function mk(ic,lab,real,tgt,valTxt){var rr=tgt>0?real/tgt:0;return {ic:ic,lab:lab,r:clamp(rr),pct:Math.round(rr*100),met:rr>=0.98,valTxt:valTxt};}
    var axes=[
      mk("\ud83c\udfc3","Sport",sportU,G.sport,sportU+" / "+G.sport+" activit\u00e9"+(G.sport>1?"s":"")),
      mk("\ud83e\udd69","Prot\u00e9ines",prot,G.prot,prot+" / "+G.prot+" g"),
      mk("\ud83d\ude34","Sommeil",sl,G.sleep,fr1(sl)+" / "+G.sleep+" h"),
      mk("\ud83d\udca7","Eau",eau,G.water,eau+" / "+G.water+" verres"),
      mk("\ud83d\udd01","\u00c0-c\u00f4t\u00e9s",cDone,cTot,cDone+" / "+cTot+" tenus")
    ];
    var exp=expend(d);
    if(exp!=null){
      var net=adjIntake(d)-exp,goal=G.kcal;if(isNaN(goal))goal=300;
      /* On note l'\u00c9CART \u00e0 l'objectif, pas le rapport : \u2212\u00a050 kcal quand on vise +\u00a0200
         n'est pas \u00ab\u00a00\u00a0%\u00a0\u00bb, et +\u00a0600 quand on vise +\u00a0200 n'est pas \u00ab\u00a0100\u00a0%\u00a0\u00bb non plus.
         Toл\u00e9rance : l'objectif lui-m\u00eame, avec un plancher de 400 kcal. */
      var tol=Math.max(Math.abs(goal),400),gap=Math.abs(net-goal),rr=1-gap/tol;
      axes.push({ic:"\u2696\ufe0f",lab:"Bilan kcal",r:clamp(rr),pct:Math.round(clamp(rr)*100),met:gap<=tol*0.25,
        valTxt:(net>0?"+":"")+Math.round(net)+" / vis\u00e9 "+(goal>0?"+":"")+Math.round(goal)+" kcal ("+(net-goal>0?"+":"")+Math.round(net-goal)+")"});
    }
    return axes;
  }
  function radarSVG(A,pct){
    var N=A.length,cx=130,cy=104,R=64,LR=R+20;
    function pt(i,rr){var a=-Math.PI/2+i*2*Math.PI/N;return [cx+R*rr*Math.cos(a),cy+R*rr*Math.sin(a)];}
    function poly(fn){return A.map(function(_,i){var p=pt(i,fn(i));return p[0].toFixed(1)+","+p[1].toFixed(1);}).join(" ");}
    var rings=[0.25,0.5,0.75].map(function(L){return '<polygon class="rad-ring" points="'+poly(function(){return L;})+'"/>';}).join("");
    var outer='<polygon class="rad-goal" points="'+poly(function(){return 1;})+'"/>';
    var spokes=A.map(function(_,i){var p=pt(i,1);return '<line class="rad-spoke" x1="'+cx+'" y1="'+cy+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'"/>';}).join("");
    var real='<polygon class="rad-real" points="'+poly(function(i){return A[i].r;})+'"/>';
    var dots=A.map(function(a,i){var p=pt(i,a.r);return '<circle class="rad-dot'+(a.met?' met':'')+'" cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.6"/>';}).join("");
    /* Chaque logo est une zone de tap de 15 px de rayon (un <text> seul est trop
       petit au doigt) : le cercle transparent porte le data-ax, le texte le laisse passer. */
    var labs=A.map(function(a,i){var an=-Math.PI/2+i*2*Math.PI/N,lx=cx+LR*Math.cos(an),ly=cy+LR*Math.sin(an);
      return '<circle class="rad-hit" cx="'+lx.toFixed(1)+'" cy="'+ly.toFixed(1)+'" r="15" data-ax="'+esc(a.lab)+'"/>'
           +'<text class="rad-ilab" x="'+lx.toFixed(1)+'" y="'+(ly+4).toFixed(1)+'" text-anchor="middle">'+a.ic+'</text>';}).join("");
    var weak=A.slice().sort(function(p,q){return p.r-q.r;})[0];
    var hub=(pct==null)?'':'<circle class="rad-hub" cx="'+cx+'" cy="'+cy+'" r="22" data-ax="'+esc(weak?weak.lab:"")+'"/><text class="rad-hubv" x="'+cx+'" y="'+(cy+7)+'" text-anchor="middle" data-ax="'+esc(weak?weak.lab:"")+'">'+pct+'<tspan class="rad-hubu">%</tspan></text>';
    return '<svg class="radar-svg" viewBox="0 0 260 208" role="img" aria-label="Radar">'+rings+outer+spokes+real+dots+hub+labs+'</svg>';
  }
  function radarBlockHTML(d,rk){
    var A=radarDay(d);
    var overall=Math.round(A.reduce(function(s,a){return s+a.r;},0)/A.length*100);
    var legend=A.map(function(a){return '<div class="rl-item tapp'+(a.met?' met':'')+'" data-ax="'+esc(a.lab)+'"><span class="rl-ic">'+a.ic+'</span><span class="rl-txt"><span class="rl-lab">'+esc(a.lab)+'</span><span class="rl-val">'+esc(a.valTxt)+'</span></span><span class="rl-chk">'+(a.met?"\u2713":(a.pct+"%"))+'</span></div>';}).join("");
    var head=bndHead("radar","card",{render:rk,stick:true,ic:"\ud83d\udd78\ufe0f",k:"Ma journ\u00e9e",v:overall+" %"});
    var body=bndOpen.radar?('<div class="radar-body">'+radarSVG(A,overall)+
      '<button type="button" class="radar-det'+(radarDetail?' open':'')+'">D\u00e9tail<span class="bnd-chev">\u25be</span></button>'+
      (radarDetail?('<div class="radar-legend">'+legend+'</div><div class="radar-sub">R\u00e9alis\u00e9 vs objectif \u2014 plus la forme touche le bord, plus ta journ\u00e9e est compl\u00e8te.</div>'):'')+'</div>'):'';
    return head+body;
  }
  function renderDayRadar(){var h=document.getElementById("dayRadar");if(!h)return;h.innerHTML=radarBlockHTML(dayDate,"dayRadar");var dt=h.querySelector(".radar-det");if(dt)dt.onclick=function(){radarDetail=!radarDetail;renderDayRadar();};}
  function radarPeriodAxes(per){
    var accum={},order=[],days=0,end=new Date();
    for(var i=0;i<per;i++){var dt=new Date(end);dt.setDate(dt.getDate()-i);var iso=isoOf(dt);if(!state.days[iso])continue;var A=radarDay(iso);if(!A.length)continue;days++;A.forEach(function(a){if(!(a.lab in accum)){accum[a.lab]={ic:a.ic,sum:0,n:0};order.push(a.lab);}accum[a.lab].sum+=a.r;accum[a.lab].n++;});}
    var axes=order.map(function(lab){var o=accum[lab];var r=o.n?o.sum/o.n:0;return {ic:o.ic,lab:lab,r:r,pct:Math.round(r*100),met:false,valTxt:Math.round(r*100)+"%"};});
    return {axes:axes,days:days};
  }
  function radarPeriodHTML(){
    var per=radarPeriod||30;var pr=radarPeriodAxes(per);
    var sels=[1,7,30,90].map(function(p){return '<button type="button" class="seg rp-per'+(per===p?" on":"")+'" data-p="'+p+'">'+p+' j</button>';}).join("");
    var head='<div class="radar-head"><div class="sec-title">Moyenne par dimension</div>'+(pr.days?'<div class="radar-score">'+Math.round(pr.axes.reduce(function(s,a){return s+a.r;},0)/pr.axes.length*100)+'<span>%</span></div>':'')+'</div>';
    var selBar='<div class="fuel-seg rp-bar">'+sels+'</div>';
    if(!pr.days)return '<div class="card pad radar-card">'+head+selBar+'<div class="zn-hint">Pas encore de donn\u00e9es sur cette p\u00e9riode.</div></div>';
    var legend=pr.axes.map(function(a){return '<div class="rl-item tapp" data-ax="'+esc(a.lab)+'"><span class="rl-ic">'+a.ic+'</span><span class="rl-txt"><span class="rl-lab">'+esc(a.lab)+'</span></span><span class="rl-chk">'+a.pct+'%</span></div>';}).join("");
    return '<div class="card pad radar-card">'+head+selBar+radarSVG(pr.axes,Math.round(pr.axes.reduce(function(s,a){return s+a.r;},0)/pr.axes.length*100))+
      '<button type="button" class="radar-det'+(radarDetail?' open':'')+'">D\u00e9tail<span class="bnd-chev">\u25be</span></button>'+
      (radarDetail?('<div class="radar-legend">'+legend+'</div><div class="radar-sub">Moyenne sur '+per+' j \u00b7 '+pr.days+' jour(s) suivi(s). Chaque axe = ta moyenne vs objectif.</div>'):'')+'</div>';
  }
  function renderProgressRadar(){var h=document.getElementById("progRadar");if(!h)return;h.innerHTML=radarPeriodHTML();
    h.querySelectorAll(".rp-per").forEach(function(b){b.onclick=function(){radarPeriod=parseInt(b.getAttribute("data-p"),10);renderProgressRadar();renderStatGrid();};});
    var dt=h.querySelector(".radar-det");if(dt)dt.onclick=function(){radarDetail=!radarDetail;renderProgressRadar();};}

  /* ================== VUE DÉTAIL D'UNE DIMENSION DU RADAR ==================
     Ouverte en tapant un logo du radar, le centre du radar (→ axe le plus faible)
     ou une ligne de la légende. État : quel axe, quelle fenêtre, quel jour de fin.
     axPeriod=1 équivaut à « ce jour précis », choisi via le calendrier. */
  var axLab=null, axPeriod=7, axDate=null, axCal=null, axShown=false;

  var AXIS_HELP={
    "Sport":{q:"Le nombre d'activit\u00e9s enregistr\u00e9es dans la journ\u00e9e : les sports coch\u00e9s, plus une s\u00e9ance de muscu ou de triathlon marqu\u00e9e comme faite. Objectif\u00a0: au moins une.",
      w:"Sur un objectif mixte muscu + triathlon, c'est la <b>r\u00e9gularit\u00e9</b> qui construit la forme, pas l'intensit\u00e9 d'une s\u00e9ance isol\u00e9e. Une semaine \u00e0 5 jours actifs mod\u00e9r\u00e9s vaut mieux que 2 jours tr\u00e8s durs suivis de 5 jours vides\u00a0: le corps s'adapte pendant la r\u00e9cup\u00e9ration, mais seulement si le signal revient assez souvent.",
      h:"Une marche rapide, une s\u00e9ance de mobilit\u00e9 ou 20 min de v\u00e9lo comptent. Vise \u00e0 ne jamais laisser deux jours vides d'affil\u00e9e."},
    "Prot\u00e9ines":{q:"Les prot\u00e9ines <b>efficaces</b> du jour (protEff)\u00a0: les prot\u00e9ines compl\u00e8tes, plus les compl\u00e9mentarit\u00e9s c\u00e9r\u00e9ale + l\u00e9gumineuse qui comptent double. Cible\u00a0: 130 g.",
      w:"130 g pour ~74 kg, c'est environ <b>1,75 g par kilo</b>\u00a0: la zone o\u00f9 la prise de muscle est maximale sans exc\u00e8s inutile. En dessous de ~1,4 g/kg, l'entra\u00eenement construit moins\u00a0; au-dessus de ~2,2 g/kg, le surplus est simplement br\u00fbl\u00e9.",
      h:"R\u00e9partis en 3 \u00e0 4 prises de 30\u201340 g plut\u00f4t qu'un gros repas\u00a0: la synth\u00e8se prot\u00e9ique sature au-del\u00e0 de ~40 g par prise. C'est l'axe le plus souvent en retard quand les repas viennent de r\u00e9cup\u00e9rations surprise, tr\u00e8s glucidiques."},
    "Sommeil":{q:"Les heures de sommeil not\u00e9es le matin. Cible\u00a0: 8 h.",
      w:"C'est pendant le sommeil profond que se fait l'essentiel de la <b>r\u00e9paration musculaire</b> et de la r\u00e9cup\u00e9ration nerveuse. Dormir 6 h au lieu de 8 fait chuter la synth\u00e9se prot\u00e9ique et augmente la sensation d'effort \u00e0 charge \u00e9gale\u00a0: la m\u00eame s\u00e9ance co\u00fbte plus cher.",
      h:"Croise cet axe avec ta VFC du matin\u00a0: deux nuits courtes de suite + une VFC basse = jour \u00e0 all\u00e9ger plut\u00f4t qu'\u00e0 forcer."},
    "Eau":{q:"Les verres d'eau compt\u00e9s dans la journ\u00e9e (1 verre \u2248 25 cl). Cible\u00a0: 8 verres, soit environ 2 L.",
      w:"Perdre <b>2\u00a0% de son poids en eau</b> suffit \u00e0 d\u00e9grader nettement l'endurance et la force. \u00c0 74 kg, cela repr\u00e9sente \u00e0 peine 1,5 L\u00a0\u2014 c'est-\u00e0-dire une s\u00e9ance chaude sans boire.",
      h:"Les jours de grosse s\u00e9ance ou de chaleur, la cible monte\u00a0: ajoute l'\u00e9quivalent de ce que tu as transpir\u00e9. Une pinc\u00e9e de sel aide l'eau \u00e0 rester dans le sang apr\u00e8s un gros effort."},
    "\u00c0-c\u00f4t\u00e9s":{q:"Tes ancrages du jour\u00a0: les habitudes que tu as choisi de tenir dans \u00ab\u00a0Bien-\u00eatre & suivi\u00a0\u00bb.",
      w:"Ce sont les petites choses qui ne se voient pas sur une s\u00e9ance mais qui d\u00e9cident du r\u00e9sultat sur trois mois. Un axe tenu \u00e0 80\u00a0% pendant 90 jours pr\u00e9dit mieux la progression qu'un pic parfait sur une semaine.",
      h:"Si un ancrage tombe sous 50\u00a0% sur 30 jours, il est probablement mal calibr\u00e9\u00a0: r\u00e9duis-le plut\u00f4t que de l'abandonner."},
    "Bilan kcal":{q:"Apport du jour moins d\u00e9pense estim\u00e9e (m\u00e9tabolisme de base + activit\u00e9s), compar\u00e9 \u00e0 ton objectif de surplus.",
      w:"Prendre du muscle demande un <b>surplus l\u00e9ger et r\u00e9gulier</b>. Trop faible, la prise stagne\u00a0; trop \u00e9lev\u00e9, le gain part en gras. C'est la moyenne sur 7 \u00e0 30 jours qui compte\u00a0\u2014 un jour isol\u00e9 ne veut rien dire, d'o\u00f9 l'int\u00e9r\u00eat des fen\u00eatres longues ci-dessus.",
      h:"Croise avec la courbe de poids\u00a0: si le bilan est positif mais que le poids ne bouge pas sur 3 semaines, c'est l'estimation de d\u00e9pense qu'il faut corriger, pas l'apport."}
  };

  function axAll(){var A=radarDay(axDate||todayStr());return A.length?A:radarDay(todayStr());}
  function axOf(iso,lab){var A=radarDay(iso);for(var i=0;i<A.length;i++)if(A[i].lab===lab)return A[i];return null;}
  function axWin(){var end=axDate||todayStr(),out=[];for(var i=axPeriod-1;i>=0;i--)out.push(isoOf(addDays(end,-i)));return out;}
  function axHas(iso){return !!state.days[iso];}

  function openAxis(lab){
    if(!lab)return;
    axLab=lab;axCal=null;
    var v=document.getElementById("axisView");if(!v)return;
    axShown=true;v.hidden=false;requestAnimationFrame(function(){v.classList.add("open");});
    renderAxis();
  }
  function closeAxis(){
    var v=document.getElementById("axisView");if(!v)return;
    axShown=false;v.classList.remove("open");setTimeout(function(){if(!axShown)v.hidden=true;},260);
  }
  function axisOpen(){return axShown;}

  /* Barres : une par jour jusqu'\u00e0 31 j, sinon une par semaine \u2014 90 barres de 2 px
     ne se lisent pas, une moyenne hebdomadaire oui. */
  function axBarsHTML(win,lab){
    var groups=[];
    if(win.length<=31){win.forEach(function(iso){groups.push([iso]);});}
    else{for(var i=0;i<win.length;i+=7)groups.push(win.slice(i,i+7));}
    var bars=groups.map(function(g){
      var s=0,n=0,met=0;
      g.forEach(function(iso){if(!axHas(iso))return;var o=axOf(iso,lab);if(!o)return;s+=o.r;n++;if(o.met)met++;});
      if(!n)return '<span class="axb none" title="pas de donn\u00e9e" data-axj="'+g[g.length-1]+'"></span>';
      var r=s/n,h=Math.max(3,Math.round(r*100));
      var ttl=(g.length>1?frDateShort(g[0])+" \u2192 "+frDateShort(g[g.length-1]):frDateFull(g[0]))+" \u00b7 "+Math.round(r*100)+"%";
      return '<span class="axb'+(met===n?' met':'')+'" style="height:'+h+'%" title="'+esc(ttl)+'" data-axj="'+g[g.length-1]+'"></span>';
    }).join("");
    var f=win[0],l=win[win.length-1];
    return '<div class="axbars">'+bars+'</div><div class="axbars-x"><span>'+esc(frDateShort(f))+'</span><span>'+esc(frDateShort(l))+'</span></div>';
  }

  /* Les objectifs étant datés, on dit lequel s'applique à la fenêtre affichée —
     et on prévient si l'objectif a changé en cours de période. */
  function axGoalHTML(){
    var K={"Sport":"sport","Prot\u00e9ines":"prot","Sommeil":"sleep","Eau":"water","\u00c0-c\u00f4t\u00e9s":"anchors","Bilan kcal":"kcal"}[axLab];
    if(!K)return "";
    var win=axWin(),vals={};
    win.forEach(function(iso){vals[goalsAt(iso)[K]]=1;});
    var list=Object.keys(vals);
    var u=(GOAL_LBL[K]||["","",""])[2];
    if(list.length>1)return '<div class="ax-goal ax-goal-warn">\u26a0\ufe0f Objectif modifi\u00e9 pendant la p\u00e9riode ('+esc(list.join(" \u2192 "))+' '+esc(u)+') \u2014 chaque jour reste jug\u00e9 sur le sien.</div>';
    return '<div class="ax-goal">Objectif en vigueur\u00a0: <b>'+esc(list[0])+'</b> '+esc(u)+'</div>';
  }
  function axCalHTML(){
    var base=axCal||(axDate||todayStr());
    var d0=new Date(base+"T00:00:00");d0.setDate(1);
    var y=d0.getFullYear(),m=d0.getMonth();
    var first=(d0.getDay()+6)%7, nd=new Date(y,m+1,0).getDate(),today=todayStr(),sel=axDate||todayStr();
    var cells="";
    for(var i=0;i<first;i++)cells+='<span class="axc-e"></span>';
    for(var day=1;day<=nd;day++){
      var iso=y+"-"+String(m+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
      var cls="axc-d"+(iso===sel?" on":"")+(iso===today?" today":"")+(axHas(iso)?" has":"")+(dateMs(iso)>dateMs(today)?" off":"");
      cells+='<button type="button" class="'+cls+'" data-axd="'+iso+'">'+day+'</button>';
    }
    return '<div class="axcal"><div class="axcal-h"><button type="button" class="axcal-nav" data-axm="-1">\u2039</button>'
      +'<span>'+esc((MOIS[m]||"")+" "+y)+'</span>'
      +'<button type="button" class="axcal-nav" data-axm="1">\u203a</button></div>'
      +'<div class="axcal-w">'+["L","M","M","J","V","S","D"].map(function(x){return "<span>"+x+"</span>";}).join("")+'</div>'
      +'<div class="axcal-g">'+cells+'</div></div>';
  }

  function renderAxis(){
    var host=document.getElementById("axisBody"),ttl=document.getElementById("axisTitle");
    if(!host)return;
    var all=axAll();
    if(axLab&&!all.some(function(a){return a.lab===axLab;})&&AXIS_HELP[axLab]==null)axLab=all[0]&&all[0].lab;
    var cur=null;for(var i=0;i<all.length;i++)if(all[i].lab===axLab)cur=all[i];
    if(!cur)cur=all[0]||{ic:"\ud83d\udd78\ufe0f",lab:axLab||"",r:0,pct:0,valTxt:"\u2014"};
    axLab=cur.lab;
    if(ttl)ttl.innerHTML='<span class="ax-tic">'+cur.ic+'</span>'+esc(cur.lab)+'<span class="ax-tnext">\u21bb</span>';

    var win=axWin(),sum=0,n=0,metN=0;
    win.forEach(function(iso){if(!axHas(iso))return;var o=axOf(iso,axLab);if(!o)return;sum+=o.r;n++;if(o.met)metN++;});
    var avg=n?sum/n:null;
    var isDay=(axPeriod===1);
    var refIso=axDate||todayStr();
    var big=isDay?(axHas(refIso)&&axOf(refIso,axLab)?Math.round(axOf(refIso,axLab).r*100)+" %":"\u2014")
                 :(avg==null?"\u2014":Math.round(avg*100)+" %");
    var sub=isDay?(axHas(refIso)&&axOf(refIso,axLab)?esc(axOf(refIso,axLab).valTxt):"Aucune donn\u00e9e ce jour-l\u00e0")
                 :(n?esc(cur.valTxt)+" aujourd'hui \u00b7 moyenne sur "+n+" jour"+(n>1?"s":"")+" suivi"+(n>1?"s":""):"Aucune donn\u00e9e sur la p\u00e9riode");

    var axesBar=all.map(function(x){return '<button type="button" class="ax-pick'+(x.lab===axLab?" on":"")+'" data-ax="'+esc(x.lab)+'" title="'+esc(x.lab)+'">'+x.ic+'</button>';}).join("");
    var pers=[1,7,30,90].map(function(p){return '<button type="button" class="seg ax-per'+(axPeriod===p?" on":"")+'" data-axp="'+p+'">'+p+' j</button>';}).join("");
    var help=AXIS_HELP[axLab]||{q:"",w:"",h:""};

    host.innerHTML=
      '<div class="ax-picks">'+axesBar+'</div>'+
      '<div class="ax-bar"><div class="fuel-seg">'+pers+'</div>'+
        '<button type="button" class="ax-cal'+(axCal?" on":"")+'" id="axCalBtn" aria-label="Choisir un jour">\ud83d\udcc5</button></div>'+
      (axDate?'<div class="ax-date">Jour de r\u00e9f\u00e9rence\u00a0: <b>'+esc(frDateFull(axDate))+'</b> <button type="button" class="ax-reset" id="axReset">revenir \u00e0 aujourd\'hui</button></div>':'')+
      (axCal?axCalHTML():'')+
      '<div class="card pad ax-card">'+
        '<div class="ax-big">'+big+'</div><div class="ax-sub">'+sub+'</div>'+
        axGoalHTML()+
        (isDay?'':axBarsHTML(win,axLab))+
        (isDay?'':'<div class="ax-kpi"><span><b>'+metN+'</b> jour'+(metN>1?'s':'')+' \u00e0 l\'objectif</span><span><b>'+n+'</b> jour'+(n>1?'s':'')+' suivi'+(n>1?'s':'')+' / '+win.length+'</span></div>')+
      '</div>'+
      ((axLab==="Prot\u00e9ines"||axLab==="Bilan kcal")&&!axDate&&axPeriod!==90
        ?'<div class="card pad ax-detail"><div class="ax-dh">D\u00e9tail d\'aujourd\'hui</div><div class="ax-dslot"></div></div>':'')+
      '<div class="card pad ax-help">'+
        bndHead("axhelp","sub",{ttl:"\u2139\ufe0f Comprendre cet axe"})+
        bndBody("axhelp","",
          '<div class="ax-h">Ce que mesure cet axe</div><p>'+help.q+'</p>'+
          '<div class="ax-h">Pourquoi \u00e7a compte</div><p>'+help.w+'</p>'+
          '<div class="ax-h">Comment l\'am\u00e9liorer</div><p>'+help.h+'</p>')+
      '</div>';

    host.querySelectorAll(".ax-per").forEach(function(b){b.onclick=function(){axPeriod=parseInt(b.getAttribute("data-axp"),10);renderAxis();};});
    var cb=host.querySelector("#axCalBtn");if(cb)cb.onclick=function(){axCal=axCal?null:(axDate||todayStr());renderAxis();};
    var rs=host.querySelector("#axReset");if(rs)rs.onclick=function(){axDate=null;axCal=null;renderAxis();};
    host.querySelectorAll(".axcal-nav").forEach(function(b){b.onclick=function(){
      var base=new Date((axCal||todayStr())+"T00:00:00");base.setDate(1);base.setMonth(base.getMonth()+parseInt(b.getAttribute("data-axm"),10));
      axCal=isoOf(base);renderAxis();};});
    host.querySelectorAll(".axc-d").forEach(function(b){b.onclick=function(){
      var iso=b.getAttribute("data-axd");if(dateMs(iso)>dateMs(todayStr()))return;
      axDate=iso;axCal=null;renderAxis();};});
    /* Une barre = un jour : la toucher ouvre le Journal à cette date.
       C'est le chemin qui manquait entre « je vois un creux » et « je vais voir pourquoi ». */
    host.querySelectorAll(".axb[data-axj]").forEach(function(b){b.onclick=function(){
      dayDate=b.getAttribute("data-axj");
      closeAxis();activateTab("v-day");};});
    var slot=host.querySelector(".ax-dslot");
    if(slot){
      if(axLab==="Prot\u00e9ines")renderDayNutri(axDate||todayStr(),slot);
      else if(axLab==="Bilan kcal")renderDayBalance(axDate||todayStr(),slot);
    }
    host.scrollTop=0;
  }

  /* Un seul \u00e9couteur d\u00e9l\u00e9gu\u00e9 pour toutes les ouvertures d'axe (radar, l\u00e9gende, s\u00e9lecteur). */
  /* Marque .stuck les bandeaux figés effectivement arrivés en haut. */
  /* Mesure la hauteur réelle de la barre de titre (et, dans le Journal, du bandeau
     de date) pour que les titres figés se posent JUSTE dessous, jamais dessous-derrière. */
  function syncStickTop(){
    var r=document.documentElement,top=document.querySelector("header.top");
    if(!top)return;
    var h=Math.round(top.getBoundingClientRect().height);
    if(h>0)r.style.setProperty("--bnd-top",h+"px");
    var dn=document.querySelector("#v-day .datenav"),dh=dn?Math.round(dn.getBoundingClientRect().height):0;
    r.style.setProperty("--bnd-top2",(h+(dh>0?dh+6:48))+"px");
  }
  function wireStick(){
    var tick=false;
    function upd(){
      tick=false;
      var l=document.querySelectorAll(".bnd-stick.open");
      for(var i=0;i<l.length;i++){
        var el=l[i],top=parseFloat(getComputedStyle(el).top);
        if(isNaN(top)){el.classList.remove("stuck");continue;}
        el.classList.toggle("stuck",el.getBoundingClientRect().top<=top+0.5);
      }
    }
    function ping(){if(!tick){tick=true;requestAnimationFrame(function(){syncStickTop();upd();});}}
    window.addEventListener("scroll",ping,{passive:true});
    window.addEventListener("resize",ping);
    document.addEventListener("click",function(){setTimeout(ping,0);},true);
    ping();
  }
  function wireAxis(){
    document.addEventListener("click",function(e){
      var t=e.target;
      var el=(t&&t.closest)?t.closest("[data-ax]"):null;
      if(!el&&t&&t.correspondingUseElement)el=null;
      if(!el)return;
      var lab=el.getAttribute("data-ax");
      if(!lab)return;
      e.preventDefault();e.stopPropagation();
      if(axisOpen()){axLab=lab;renderAxis();}else openAxis(lab);
    },true);
    var bk=document.getElementById("axisBack");if(bk)bk.onclick=closeAxis;
    var ti=document.getElementById("axisTitle");
    if(ti)ti.onclick=function(){var all=axAll();var i=0;for(var k=0;k<all.length;k++)if(all[k].lab===axLab)i=k;
      axLab=all[(i+1)%all.length].lab;renderAxis();};
    /* Retour par glissement vers la droite */
    var v=document.getElementById("axisView");
    if(v){var sx=0,sy=0,ok=false;
      v.addEventListener("touchstart",function(e){if(e.touches.length!==1){ok=false;return;}sx=e.touches[0].clientX;sy=e.touches[0].clientY;ok=true;},{passive:true});
      v.addEventListener("touchend",function(e){if(!ok)return;ok=false;var t=e.changedTouches&&e.changedTouches[0];if(!t)return;
        var dx=t.clientX-sx,dy=t.clientY-sy;if(dx>70&&Math.abs(dx)>Math.abs(dy)*1.8)closeAxis();},{passive:true});}
  }
  /* ---------------- Écran du jour (date navigable) ----------------
     UN seul écran pour aujourd'hui et les jours passés : même formulaire, même radar.
     Les blocs d'entête (calendrier, prochaine séance, alertes) n'ont de sens que pour
     aujourd'hui — ils sont masqués dès qu'on remonte dans le temps. */
  function renderDay(){
    var d=dayDate,isTd=(d===todayStr());
    var dl=document.getElementById("dayLabel");
    if(dl){dl.textContent=frDateFull(d)+(isTd?" \u00b7 aujourd'hui":"");dl.classList.toggle("past",!isTd);}
    var dn2=document.querySelector(".datenav");if(dn2)dn2.classList.toggle("past",!isTd);
    var hd=document.getElementById("dayHead");if(hd)hd.hidden=!isTd;
    renderChip();
    renderHero();
    renderOnboard();
    renderDayRadar();
    renderDayNutri(d);
    buildDayForm(document.getElementById("dayLog"),d);
    var bn=document.getElementById("backupNudge");
    if(bn){var st=backupStaleDays();var stale=(st===null||st>=10);
      if(isTd&&stale&&!bkpNudgeHidden){bn.innerHTML='<div class="bkp-nudge"><span class="bkp-nudge-t">\ud83d\udcbe '+(st===null?"Pense \u00e0 sauvegarder tes donn\u00e9es":("Sauvegarde : "+st+" jours sans export"))+'</span><button class="bkp-nudge-go" id="bkpNudgeGo">Exporter</button><button class="bkp-nudge-x" id="bkpNudgeX" aria-label="Masquer">\u00d7</button></div>';
        var g=document.getElementById("bkpNudgeGo");if(g)g.onclick=function(){menuBtnOpenSettings();};
        var xb=document.getElementById("bkpNudgeX");if(xb)xb.onclick=function(){bkpNudgeHidden=true;bn.innerHTML="";};
      }else bn.innerHTML="";
    }
  }
  function menuBtnOpenSettings(){openSettings();}
  function rxSuggest(d,off){
    var L=(typeof ROUTINES!=="undefined"?ROUTINES:[]);if(!L.length)return null;
    var sc=L.map(function(r){var age=999;for(var k=1;k<=60;k++){if(routineDoneOn(r.id,isoOf(addDays(d,-k)))){age=k;break;}}return {r:r,age:age};});
    sc.sort(function(a,b){return b.age-a.age;});
    return sc[(((off||0)%sc.length)+sc.length)%sc.length].r;
  }
  function onbChecks(){
    var pf=profileGet(),th=thresholdsGet(),d=todayStr(),x=state.days[d]||{},arr=[];
    function empty(v){return v===undefined||v===null||(""+v).trim()==="";}
    arr.push({ic:"\ud83d\udccf",ok:!empty(pf.height),lbl:"Taille",txt:"Ta <b>taille</b> n\u2019est pas renseign\u00e9e \u2014 indispensable pour estimer ta d\u00e9pense \u00e9nerg\u00e9tique.",grp:"g_profil",sec:"profil"});
    arr.push({ic:"\u2696\ufe0f",ok:!(empty(pf.weight)&&lastWeight()==null),lbl:"Poids",txt:"Ton <b>poids</b> n\u2019est pas renseign\u00e9 \u2014 base du bilan calorique et du suivi de progression.",grp:"g_profil",sec:"profil"});
    arr.push({ic:"\ud83c\udf82",ok:!empty(pf.age),lbl:"\u00c2ge",txt:"Ton <b>\u00e2ge</b> n\u2019est pas renseign\u00e9 \u2014 il affine le calcul de ton m\u00e9tabolisme de base.",grp:"g_profil",sec:"profil"});
    arr.push({ic:"\ud83c\udfc3",ok:!empty(th.vma),lbl:"VMA",txt:"Ta <b>VMA</b> n\u2019est pas renseign\u00e9e \u2014 elle d\u00e9bloque tes allures de course et ta VO2max.",grp:"g_profil",sec:"seuils"});
    arr.push({ic:"\ud83d\udeb4",ok:!empty(th.ftp),lbl:"FTP",txt:"Ton <b>FTP v\u00e9lo</b> n\u2019est pas renseign\u00e9 \u2014 il d\u00e9bloque tes zones de puissance.",grp:"g_profil",sec:"seuils"});
    arr.push({ic:"\u2764\ufe0f",ok:!empty(th.fcmax),lbl:"FC max",txt:"Ta <b>FC max</b> n\u2019est pas renseign\u00e9e \u2014 elle d\u00e9bloque tes zones cardio.",grp:"g_profil",sec:"seuils"});
    var nS=(typeof SUPPS!=="undefined"?SUPPS:[]).filter(function(sp){return x.supps&&x.supps[sp.id];}).length+((x.suppsX||[]).length);
    arr.push({ic:"\ud83d\udc8a",ok:nS>=2,lbl:"Compl\u00e9ments",txt:"<b>"+nS+"/2 compl\u00e9ments</b> logg\u00e9s aujourd\u2019hui \u2014 c\u2019est la r\u00e9gularit\u00e9 qui les rend utiles, pas la dose.",jump:"supps"});
    var nR=(typeof ROUTINES!=="undefined"?ROUTINES:[]).filter(function(r){return routineDoneOn(r.id,d);}).length+((x.routinesX||[]).length);
    var sug=rxSuggest(d,onbRxOff);
    arr.push({ic:"\ud83c\udf3f",ok:nR>=2,lbl:"Bien-\u00eatre",txt:"<b>"+nR+"/2</b> choses qui te font du bien aujourd\u2019hui"+(sug?(" \u2014 essaie <b>"+(sug.icon?esc(sug.icon)+" ":"")+esc(sug.name)+"</b>, c\u2019est celle que tu as le plus laiss\u00e9e de c\u00f4t\u00e9."):"."),jump:"rx",rx:sug});
    var CR=customRoutines(),nC=CR.filter(function(a){return crDoneOn(a.id,d);}).length;
    if(CR.length)arr.push({ic:"\ud83d\udd01",ok:nC>=1,lbl:"Ancrages",txt:"<b>Aucun ancrage</b> tenu aujourd\u2019hui \u2014 un seul suffit \u00e0 prolonger la s\u00e9rie \ud83d\udd25.",jump:"cr"});
    return arr;
  }
  function jumpDay(kind){
    bndOpen.wb=true;
    if(kind==="supps")bndOpen.sp=true;else if(kind==="rx")bndOpen.rx=true;else if(kind==="cr")bndOpen.cr=true;
    dayDate=todayStr();activateTab("v-day");
    var h=document.getElementById("dayLog");if(!h)return;
    buildDayForm(h,dayDate); /* l'état vient d'être changé : il faut regénérer, sinon rien ne s'ouvre à l'écran */
    var cls='[data-bnd="'+(kind==="supps"?"sp":(kind==="rx"?"rx":"cr"))+'"]';
    var el=h.querySelector(cls);if(el&&el.scrollIntoView)el.scrollIntoView({block:"center"});
  }
  function renderOnboard(){
    var host=document.getElementById("onbNudge");if(!host)return;
    if(onbTimer){clearInterval(onbTimer);onbTimer=null;}
    if(onbHidden){host.innerHTML="";return;}
    var all=onbChecks(),miss=[];
    all.forEach(function(o,i){if(!o.ok)miss.push(i);});
    if(!miss.length){host.innerHTML="";return;}
    if(onbIdx>=all.length)onbIdx=miss[0];
    if(onbMin){
      host.innerHTML='<button type="button" class="onb-pill" id="onbExpand">\u26a0\ufe0f '+miss.length+' \u00e0 compl\u00e9ter</button>';
      var ex=document.getElementById("onbExpand");if(ex)ex.onclick=function(){onbMin=false;renderOnboard();};
      return;
    }
    function itemHTML(){var m=all[onbIdx];
      var act=m.jump
        ? '<button type="button" class="onb-go">Y aller</button>'+((m.jump==="rx"&&m.rx)?'<button type="button" class="onb-alt" aria-label="Autre suggestion">\u21bb</button>':'')
        : '<button type="button" class="onb-go">Compl\u00e9ter</button>';
      var dots=all.map(function(o,i){return '<button type="button" class="onb-dot'+(o.ok?' ok':' ko')+((i===onbIdx)?' cur':'')+'" data-i="'+i+'" aria-label="'+esc(o.lbl)+'">'+o.ic+'</button>';}).join("");
      return '<div class="onb-top"><div class="onb-ic">'+m.ic+'</div>'+
        '<div class="onb-body"><div class="onb-msg">'+(m.ok?('<b>'+esc(m.lbl)+'</b> \u2713 c\u2019est bon pour aujourd\u2019hui.'):m.txt)+'</div>'+
          '<div class="onb-actions">'+(m.ok?'':act)+'</div></div>'+
        '<div class="onb-ctl"><button type="button" class="onb-min" aria-label="R\u00e9duire">\u2013</button><button type="button" class="onb-x" aria-label="Fermer">\u00d7</button></div></div>'+
        '<div class="onb-dots">'+dots+'</div>';}
    function wire(){
      var m=all[onbIdx];
      var go=host.querySelector(".onb-go");if(go)go.onclick=function(){if(m.jump)jumpDay(m.jump);else openSettingsAt(m.grp,m.sec);};
      var al=host.querySelector(".onb-alt");if(al)al.onclick=function(){onbRxOff++;renderOnboard();};
      var mn=host.querySelector(".onb-min");if(mn)mn.onclick=function(){onbMin=true;renderOnboard();};
      var xb=host.querySelector(".onb-x");if(xb)xb.onclick=function(){onbHidden=true;host.innerHTML="";if(onbTimer){clearInterval(onbTimer);onbTimer=null;}};
      host.querySelectorAll(".onb-dot").forEach(function(b){b.onclick=function(){onbIdx=parseInt(b.getAttribute("data-i"),10);if(onbTimer){clearInterval(onbTimer);onbTimer=null;}refresh();};});
    }
    function refresh(){var card=host.querySelector(".onb-card");if(!card)return;card.innerHTML=itemHTML();wire();}
    host.innerHTML='<div class="onb-card">'+itemHTML()+'</div>';
    wire();
    if(miss.length>1)onbTimer=setInterval(function(){
      var h=document.getElementById("onbNudge");if(!h||!h.querySelector(".onb-card")){if(onbTimer){clearInterval(onbTimer);onbTimer=null;}return;}
      var pos=miss.indexOf(onbIdx);onbIdx=miss[(pos+1+miss.length)%miss.length];refresh();},6000);
  }

  /* ---------------- Muscu (grilles) ---------------- */
  function ensureBlockOpen(){
    if(blockOpen)return;
    blockOpen={};BLOCK_ORDER.forEach(function(b){blockOpen[b]=false;});
  }
  function buildGrid(block){
    var blk=PROGRAM_BLOCKS[block];var n=nextSession();
    ensureBlockOpen();var open=!!blockOpen[block];
    var doneN=0,totN=blk.weeks*CODES.length,ww,ii;
    for(ww=1;ww<=blk.weeks;ww++)for(ii=0;ii<CODES.length;ii++)if(sess(block,ww,CODES[ii]).done)doneN++;
    var h='<div class="card pad blockcard'+(open?" open":"")+'">'+
      '<button type="button" class="bnd blk-toggle" data-blk="'+block+'"><span class="blk-ttl">'+esc(blk.name)+'</span><span class="blk-meta">'+doneN+'/'+totN+'</span><span class="bnd-chev">▾</span></button>'+
      '<div class="blk-body'+(open?"":" collapsed")+'">'+
      '<div class="legend"><span><i class="dot-next"></i>Prochaine</span><span><i class="dot-done"></i>Faite</span><span><i class="dot-todo"></i>À faire</span></div>'+
      '<table class="grid"><tr><th></th>';
    CODES.forEach(function(c){h+="<th>"+c+"</th>";});
    h+="</tr>";
    for(var w=1;w<=blk.weeks;w++){
      h+='<tr><td class="wk">S'+w+'<span class="wkd">'+muscuWeekDate(block,w)+'</span></td>';
      for(var i=0;i<CODES.length;i++){
        var c=CODES[i];var s=sess(block,w,c);var cls="cell";
        if(s.done)cls+=" done";
        if(n&&n.block===block&&n.w===w&&n.c===c)cls+=" next";
        if(currentSel&&currentSel.block===block&&currentSel.w===w&&currentSel.c===c)cls+=" sel";
        h+='<td><div class="'+cls+'" data-b="'+block+'" data-w="'+w+'" data-c="'+c+'">'+c+(s.done?'<span class="chk">✓</span>':'')+'</div></td>';
      }
      h+="</tr>";
    }
    h+="</table></div></div>";
    return h;
  }
  function renderProgram(){
    renderChip();
    var host=document.getElementById("progBlocks");
    host.innerHTML=BLOCK_ORDER.map(buildGrid).join("");
    host.querySelectorAll(".blk-toggle").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-blk");if(blockOpen)blockOpen[k]=!blockOpen[k];renderProgram();};});
    host.querySelectorAll(".cell").forEach(function(cell){
      cell.addEventListener("click",function(){
        sessExpanded={};
        currentSel={block:cell.getAttribute("data-b"),w:parseInt(cell.getAttribute("data-w"),10),c:cell.getAttribute("data-c")};
        renderProgram();renderSessionDetail();
        var sd=document.getElementById("sessionDetail");if(sd&&sd.scrollIntoView)sd.scrollIntoView({behavior:"smooth",block:"start"});
      });
    });
    if(currentSel)renderSessionDetail();else document.getElementById("sessionDetail").innerHTML="";
  }

  /* ---------------- Détail de séance ---------------- */
  function setExoStickyTop(){
    var wrap=document.getElementById("sessionDetail");if(!wrap)return;
    var rest=wrap.querySelector(".rest");if(!rest){wrap.style.removeProperty("--exo-sticky-top");return;}
    requestAnimationFrame(function(){
      var topPx=parseFloat(getComputedStyle(rest).top)||50;
      var h=rest.getBoundingClientRect().height;
      wrap.style.setProperty("--exo-sticky-top",Math.round(topPx+h+6)+"px");
    });
  }
  function renderSessionDetail(){
    if(!currentSel)return;
    var b=currentSel.block,w=currentSel.w,c=currentSel.c;
    var p=progOf(b,c);var s=sess(b,w,c);
    var head=
      '<div class="eyebrow">Séance ouverte</div>'+
      '<div class="card pad">'+
      '<div class="sd-head"><div><div class="lbl">'+PROGRAM_BLOCKS[b].name+' · Semaine '+w+' · '+p.sub+'</div>'+
      '<h3>'+p.title.replace(/—.*/,"").trim()+' '+c+'</h3></div></div>'+
      '<div class="field" style="margin-top:12px"><button class="btn '+(s.done?'ghost':'accent')+'" id="toggleDone">'+(s.done?'Annuler':'Marquer la séance comme faite')+'</button></div>'+
      (s.done?'<div class="donedate"><label>Faite le <input type="date" id="doneDate" value="'+esc(s.date||todayStr())+'"></label></div>':'')+
      '<div class="rest"><div class="rest-disp" id="restDisp">0:00</div><div class="rest-btns">'+
        '<button data-sec="45">45 s</button><button data-sec="60">1:00</button><button data-sec="90">1:30</button><button class="stop" id="restStop">Stop</button>'+
      '</div></div>';
    var exosHTML="";
    p.exos.forEach(function(ex){
      var curV=(s.variant&&s.variant[ex.id])||"";
      var setK=setKey(ex.id,curV);
      if(!s.sets[setK])s.sets[setK]=[];
      var prev=prevSets(b,w,c,setK);
      var isSec=ex.unit==="sec";
      var perSide=/\/côté/.test(ex.target||"");
      var secLbl=perSide?"s/côté":"s";
      var secTgt=(String(ex.target).match(/(\d+)\s*s/)||[])[1]||"s";
      var rest=restFor(ex.target);
      var exBase=baseFor(ex.id,curV,ex.base);       /* base de saisie de l'exo (total/bras/ajout), déduite variante+défaut */
      var kgUnit=BASE_UNIT[exBase];                 /* unité affichée à côté du champ poids (kg / kg/bras / +kg) */
      var uni=/\/\s*jambe/i.test(ex.target)?"/jambe":(/\/\s*(c\u00f4t\u00e9|cote)/i.test(ex.target)?"/c\u00f4t\u00e9":(/1\s*bras/i.test(ex.name)?"/bras":""));  /* exos unilat\u00e9raux : reps par c\u00f4t\u00e9 */
      var sugg=(!prev&&!isSec)?variantSuggest(b,w,c,ex,curV,exBase,setK):null;
      var setsHTML="",nSets=Math.max(ex.sets,(s.sets[setK]||[]).length);
      for(var i=0;i<nSets;i++){
        var pr=(prev&&prev[i]&&prev[i].r!=="")?prev[i].r:(isSec?secTgt:"reps");
        if(isSec){
          setsHTML+='<div class="set sec" data-exo="'+esc(setK)+'" data-set="'+i+'">'+
            '<span class="sn">Série '+(i+1)+'</span>'+
            '<span class="setf"><input type="number" inputmode="numeric" class="in-r" placeholder="'+pr+'"><b>'+secLbl+'</b></span>'+
          '</div>';
        }else{
          var pk=(prev&&prev[i]&&prev[i].kg!=="")?prev[i].kg:kgUnit;
          setsHTML+='<div class="set" data-exo="'+esc(setK)+'" data-set="'+i+'">'+
            '<span class="sn">Série '+(i+1)+'</span>'+
            '<span class="setf"><input type="number" inputmode="decimal" step="0.5" class="in-kg" placeholder="'+pk+'"><b>'+esc(kgUnit)+'</b></span>'+
            '<span class="setf"><input type="number" inputmode="numeric" class="in-r" placeholder="'+pr+'"><b>reps'+uni+'</b></span>'+
          '</div>';
        }
      }
      var lastTxt="";
      if(prev){
        if(isSec){lastTxt=prev.map(function(x){var v=(x&&x.r!=="")?x.r:"–";return v+" "+secLbl;}).join(" · ");}
        else{lastTxt=prev.map(function(x){var kg=(x&&x.kg!=="")?x.kg:"–";var r=(x&&x.r!=="")?x.r:"–";return kg+"×"+r;}).join(" · ");}
      }
      var _a=s.sets[setK]||[],filled=0;
      for(var fi=0;fi<ex.sets;fi++){var _it=_a[fi];if(_it&&(String(_it.kg).trim()!==""||String(_it.r).trim()!==""))filled++;}
      var stateChip=filled>=ex.sets?'<span class="exo-state done">✓</span>':(filled>0?'<span class="exo-state">'+filled+'/'+ex.sets+'</span>':'');
      var vopts=(ex.variants&&ex.variants.length?ex.variants:EXO_VARIANTS);
      var varHTML=isSec?"":('<div class="exo-var-row"><label>Variante (selon ton matériel)</label><select class="exo-var" data-exo="'+ex.id+'"><option value=""'+(curV===""?" selected":"")+'>Version standard</option>'+vopts.map(function(o){return '<option'+(o===curV?" selected":"")+'>'+esc(o)+'</option>';}).join("")+(curV&&vopts.indexOf(curV)<0?'<option selected>'+esc(curV)+'</option>':"")+'<option value="__autre">✏️ Autre…</option></select></div>');
      exosHTML+=
        '<div class="exo" data-ex="'+ex.id+'">'+
          '<div class="exo-band'+(sessExpanded[ex.id]?" open":"")+'" data-exo="'+ex.id+'" role="button" tabindex="0" aria-expanded="'+(sessExpanded[ex.id]?"true":"false")+'">'+
            '<span class="nm">'+ex.name+(curV?" — "+esc(curV):"")+'</span>'+
            '<span class="exo-band-r"><span class="tg">'+ex.target+'</span>'+stateChip+'<span class="exo-chev">▾</span></span>'+
          '</div>'+
          '<div class="exo-body'+(sessExpanded[ex.id]?"":" collapsed")+'" id="body-'+ex.id+'">'+
            (lastTxt?'':(sugg?'<div class="lastrep sugg">≈ Conseil : '+esc(sugg.kg)+' '+esc(kgUnit)+' × '+esc(sugg.r)+' <span class="sugg-src">(selon ta variante '+esc(sugg.from||"standard")+')</span></div>':''))+
            '<div class="exo-foot" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button class="rest-chip" data-sec="'+rest+'">⏱ Repos conseillé : '+rest+' s</button><button type="button" class="exo-more-btn" data-more="'+ex.id+'" aria-label="Infos exercice" style="padding:6px 12px;border:1.5px solid var(--line);border-radius:999px;background:#fff;font-size:13px;color:var(--ink);cursor:pointer">＋ infos</button></div>'+
            '<div class="exo-more" id="more-'+ex.id+'" style="display:none;margin-bottom:10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:8px 0">'+
              exoHistHTML(b,c,setK,lastTxt,isSec,secLbl)+
              (isSec?'':'<details class="base-hint"><summary>🔀 Variante (selon ton matériel)</summary><div>'+varHTML+'</div></details>')+
              '<details class="base-hint"><summary>⚖️ Poids en '+kgUnit+' — comment le noter&nbsp;?</summary><div>'+baseHint(exBase)+'<div class="hint-sets">🔢 Renseigne <b>'+ex.sets+'</b> série'+(ex.sets>1?'s':'')+' pour cet exercice (utilise « + série » si tu en fais plus).</div></div></details>'+
              '<details class="base-hint"><summary>🎬 Technique &amp; démo</summary><div>'+ex.help+'<img class="exo-img" src="./images/'+slugify(ex.name+(curV?" "+curV:""))+'.jpg" alt=""'+(curV?' onerror="this.onerror=function(){this.onerror=null;this.style.display=\'none\'};this.src=\'./images/'+slugify(ex.name)+'.jpg\';"':' onerror="this.style.display=\'none\'"')+'>'+'<div class="exo-media"><a class="demo-link" href="https://www.youtube.com/results?search_query='+encodeURIComponent(ex.name+(curV?" "+curV:"")+" musculation technique")+'" target="_blank" rel="noopener">▸ Voir une démo vidéo</a></div>'+'</div></details>'+
            '</div>'+
            '<div class="sets">'+setsHTML+'</div>'+
            '<div class="setadd"><button class="add-set-std" data-setk="'+esc(setK)+'">+ série</button>'+(nSets>ex.sets?'<button class="del-set-std" data-setk="'+esc(setK)+'">− série</button>':'')+'</div>'+
            progHTML(b,c,setK,exBase,ex.name)+
          '</div>'+
        '</div>';
    });
    if(!s.extra)s.extra=[];
    var extraHTML="";
    if(s.extra.length){
      extraHTML+='<div class="extra-sep">Exercices ajoutés</div>';
      s.extra.forEach(function(ex){
        if(!s.sets[ex.id])s.sets[ex.id]=[];
        var ns=ex.sets||3,sh="";
        for(var i=0;i<ns;i++){sh+='<div class="set" data-exo="'+ex.id+'" data-set="'+i+'"><span class="sn">Série '+(i+1)+'</span><span class="setf"><input type="number" inputmode="decimal" step="0.5" class="in-kg" placeholder="kg"><b>kg</b></span><span class="setf"><input type="number" inputmode="numeric" class="in-r" placeholder="reps"><b>reps</b></span></div>';}
        extraHTML+='<div class="exo exo-extra" data-ex="'+ex.id+'"><div class="exo-top"><input class="exo-name-in" data-xid="'+ex.id+'" value="'+esc(ex.name||"")+'" placeholder="Nom de l\'exercice (ex. Tractions)"><button class="exo-del" data-xid="'+ex.id+'" aria-label="Retirer">×</button></div><div class="sets">'+sh+'</div><button class="add-set" data-xid="'+ex.id+'">+ série</button></div>';
      });
    }
    var addBtnHTML='<button class="btn ghost add-extra" id="addExtraBtn">+ Ajouter un exercice</button>';
    var wrap=document.getElementById("sessionDetail");
    wrap.innerHTML=head+exosHTML+extraHTML+addBtnHTML+'</div>';
    setExoStickyTop();

    wrap.querySelectorAll(".set").forEach(function(row){
      var exo=row.getAttribute("data-exo");var idx=parseInt(row.getAttribute("data-set"),10);
      var rec=(s.sets[exo]&&s.sets[exo][idx])||{kg:"",r:""};
      var kgEl=row.querySelector(".in-kg"),rEl=row.querySelector(".in-r");
      if(kgEl)kgEl.value=rec.kg||"";
      if(rEl)rEl.value=rec.r||"";
      function upd(){if(!s.sets[exo])s.sets[exo]=[];while(s.sets[exo].length<=idx)s.sets[exo].push({kg:"",r:""});s.sets[exo][idx]={kg:kgEl?kgEl.value:"",r:rEl?rEl.value:""};save();}
      if(kgEl)kgEl.addEventListener("input",upd);
      if(rEl)rEl.addEventListener("input",upd);
    });
    wrap.querySelectorAll(".exo-prog[data-prog]").forEach(function(el){
      function tgl(){var id=el.getAttribute("data-prog");progMode[id]=(progMode[id]==="vol")?"1rm":"vol";renderSessionDetail();}
      el.addEventListener("click",tgl);
      el.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();tgl();}});
    });
    wrap.querySelectorAll(".exo-more-btn").forEach(function(btn){btn.addEventListener("click",function(){var m=document.getElementById("more-"+btn.getAttribute("data-more"));if(m){var op=m.style.display==="none";m.style.display=op?"":"none";btn.classList.toggle("open",op);}});});
    function exoMeta(id){for(var q=0;q<p.exos.length;q++)if(p.exos[q].id===id)return p.exos[q];return null;}
    wrap.querySelectorAll(".exo-var").forEach(function(sel){sel.onchange=function(){
      var exId=sel.getAttribute("data-exo"),val=sel.value;
      if(val==="__autre"){var cst=prompt("Variante (ex. machine convergente, Smith, poulie basse…) :");if(!cst||!cst.trim()){sel.value=(s.variant&&s.variant[exId])||"";return;}val=cst.trim();}
      if(!s.variant)s.variant={};if(val)s.variant[exId]=val;else delete s.variant[exId];save();
      renderSessionDetail();
    };});
    function refreshChip(id){var band=wrap.querySelector('.exo-band[data-exo="'+id+'"]');var m=exoMeta(id);if(!band||!m)return;var v=(s.variant&&s.variant[id])||"";var arr=s.sets[setKey(id,v)]||[],f=0;for(var k=0;k<m.sets;k++){var it=arr[k];if(it&&(String(it.kg).trim()!==""||String(it.r).trim()!==""))f++;}var chip=band.querySelector(".exo-state");if(!f){if(chip)chip.parentNode.removeChild(chip);return;}if(!chip){chip=document.createElement("span");chip.className="exo-state";band.querySelector(".exo-band-r").insertBefore(chip,band.querySelector(".exo-chev"));}chip.textContent=f>=m.sets?"✓":f+"/"+m.sets;chip.classList.toggle("done",f>=m.sets);}
    wrap.querySelectorAll(".exo-band").forEach(function(band){
      function tog(){var id=band.getAttribute("data-exo");var body=document.getElementById("body-"+id);if(!body)return;var col=body.classList.toggle("collapsed");band.classList.toggle("open",!col);band.setAttribute("aria-expanded",col?"false":"true");sessExpanded[id]=!col;refreshChip(id);}
      band.addEventListener("click",tog);
      band.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();tog();}});
    });
    wrap.querySelectorAll(".rest-chip").forEach(function(ch){ch.addEventListener("click",function(){startRest(parseInt(ch.getAttribute("data-sec"),10));});});
    wrap.querySelectorAll(".rest-btns button[data-sec]").forEach(function(bt){bt.addEventListener("click",function(){startRest(parseInt(bt.getAttribute("data-sec"),10));});});
    var rs=wrap.querySelector("#restStop");if(rs)rs.addEventListener("click",stopRest);
    wrap.querySelector("#toggleDone").addEventListener("click",function(){s.done=!s.done;if(s.done&&!s.date)s.date=todayStr();save();renderProgram();renderSessionDetail();});
    var mdd=wrap.querySelector("#doneDate");if(mdd)mdd.addEventListener("change",function(){if(this.value){s.date=this.value;save();renderProgram();}});
    var aeb=wrap.querySelector("#addExtraBtn");if(aeb)aeb.addEventListener("click",function(){s.extra.push({id:"x"+Date.now().toString(36),name:"",sets:3});save();renderSessionDetail();var ni=document.querySelector("#sessionDetail .exo-extra:last-of-type .exo-name-in");if(ni)ni.focus();});
    wrap.querySelectorAll(".exo-name-in").forEach(function(inp){inp.addEventListener("input",function(){var id=inp.getAttribute("data-xid");for(var j=0;j<s.extra.length;j++)if(s.extra[j].id===id){s.extra[j].name=inp.value;break;}save();});});
    wrap.querySelectorAll(".exo-del").forEach(function(bt){bt.addEventListener("click",function(){var id=bt.getAttribute("data-xid");s.extra=s.extra.filter(function(e){return e.id!==id;});delete s.sets[id];save();renderSessionDetail();});});
    wrap.querySelectorAll(".add-set").forEach(function(bt){bt.addEventListener("click",function(){var id=bt.getAttribute("data-xid");for(var j=0;j<s.extra.length;j++)if(s.extra[j].id===id){s.extra[j].sets=(s.extra[j].sets||3)+1;break;}save();renderSessionDetail();});});
    wrap.querySelectorAll(".add-set-std").forEach(function(bt){bt.addEventListener("click",function(){var k=bt.getAttribute("data-setk"),m=exoMeta(k.split("::")[0]),base=m?m.sets:0;if(!s.sets[k])s.sets[k]=[];var tgt=Math.max(s.sets[k].length,base)+1;while(s.sets[k].length<tgt)s.sets[k].push({kg:"",r:""});save();renderSessionDetail();});});
    wrap.querySelectorAll(".del-set-std").forEach(function(bt){bt.addEventListener("click",function(){var k=bt.getAttribute("data-setk");if(s.sets[k]&&s.sets[k].length)s.sets[k].pop();save();renderSessionDetail();});});
  }

  /* ---------------- Triathlon ---------------- */
  function renderTri(){
    renderTriProgress();
    var meta=document.getElementById("triPlanMeta");
    if(meta){var dn=0;for(var i=1;i<=TRI.length;i++)TRI_DISC.forEach(function(p){var r=state.tri[i+"_"+p[0]];if(r&&r.done)dn++;});meta.textContent=dn+"/"+(TRI.length*TRI_DISC.length);}
    var t=document.getElementById("triTable");
    var h='<tr><th></th><th>Natation</th><th>Vélo</th><th>Course</th></tr>';
    TRI.forEach(function(wk){
      var tap=wk.nat.taper;
      h+='<tr><td class="wk">S'+wk.w+(tap?' *':'')+'<span class="wkd">'+triWeekDate(wk.w)+'</span></td>';
      TRI_DISC.forEach(function(pair){
        var dz=pair[0];var info=(dz==="nat"?wk.nat:dz==="velo"?wk.velo:wk.course);
        var rec=state.tri[wk.w+"_"+dz];var done=rec&&rec.done;
        var cls="tcell"+(done?" done":"");
        if(currentTri&&currentTri.w===wk.w&&currentTri.dz===dz)cls+=" sel";
        h+='<td><div class="'+cls+'" data-w="'+wk.w+'" data-z="'+dz+'">'+info.t+(done?'<span class="chk">✓</span>':'')+'</div></td>';
      });
      h+="</tr>";
    });
    t.innerHTML=h;
    t.querySelectorAll(".tcell").forEach(function(cell){
      cell.addEventListener("click",function(){
        currentTri={w:parseInt(cell.getAttribute("data-w"),10),dz:cell.getAttribute("data-z")};
        renderTri();renderTriDetail();
        var td=document.getElementById("triDetail");if(td&&td.scrollIntoView)td.scrollIntoView({behavior:"smooth",block:"start"});
      });
    });
    if(currentTri)renderTriDetail();else document.getElementById("triDetail").innerHTML="";
  }
  /* Allure calculée depuis distance+durée, selon la discipline. */
  function triPace(dz,dist,dur){
    if(isNaN(dist)||dist<=0||isNaN(dur)||dur<=0)return "";
    if(dz==="nat"){var p=dur/(dist/100);return "≈ "+fr1(p)+" min / 100 m";}
    if(dz==="velo"){return "≈ "+fr1(dist/(dur/60))+" km/h";}
    var m=Math.floor(dur/dist),s=Math.round((dur/dist-m)*60);return "≈ "+m+"'"+(s<10?"0":"")+s+" / km";
  }
  /* Meilleure distance loguée par discipline (toutes semaines). */
  function triBest(dz){var best=0;for(var i=1;i<=TRI.length;i++){var r=state.tri[i+"_"+dz];if(r&&num(r.dist)>best)best=num(r.dist);}return best;}
  function renderTriProgress(){
    var host=document.getElementById("triProgress");if(!host)return;
    if(!actEnabled("tri")){host.innerHTML="";return;}
    var rows=TRI_DISC.map(function(p){var dz=p[0],tg=TRI_TARGETS[dz],b=triBest(dz),pct=tg.v>0?Math.min(100,Math.round(b/tg.v*100)):0;
      return '<div class="tp-row"><span class="tp-ic">'+tg.icon+'</span><span class="tp-lbl">'+esc(p[1])+'</span><div class="tp-bar"><i style="width:'+pct+'%"></i></div><span class="tp-val">'+(b>0?nFmt(b)+" / ":"— / ")+tg.v+" "+tg.u+'</span></div>';
    }).join("");
    host.innerHTML='<div class="card pad tp-card"><div class="tp-head">Vers la distance olympique 🏁</div>'+rows+'<div class="tp-note">Meilleure distance loguée par discipline (renseigne distance + durée dans une séance).</div></div>';
  }
  function renderTriDetail(){
    if(!currentTri)return;
    var wk=TRI[currentTri.w-1];var dz=currentTri.dz;var names={nat:"Natation",velo:"Vélo",course:"Course à pied"};
    var info=(dz==="nat"?wk.nat:dz==="velo"?wk.velo:wk.course);
    var k=currentTri.w+"_"+dz;if(!state.tri[k])state.tri[k]={done:false,val:"",note:""};var rec=state.tri[k];
    var wrap=document.getElementById("triDetail");
    wrap.innerHTML=
      '<div class="eyebrow">Séance ouverte</div>'+
      '<div class="card pad">'+
        '<div class="sd-head"><div><div class="lbl">Semaine '+currentTri.w+(wk.nat.taper?' · affûtage':'')+'</div><h3>'+names[dz]+'</h3></div><span class="tg">'+info.t+'</span></div>'+
        '<p class="muted" style="margin-top:10px">'+info.d+'</p>'+
        (currentTri.w===10?'<div class="tip" style="margin-top:10px;background:#eef4f8;border:1px solid var(--line)"><div class="t" style="color:var(--primary)">🏁 Semaine de course</div><p style="color:var(--muted)">Triathlon Dinard Côte d\'Émeraude — 11-13 septembre. Affûtage, sommeil, et on profite !</p></div>':'')+
        '<div class="field" style="margin-top:12px"><button class="btn '+(rec.done?'ghost':'accent')+'" id="triDone">'+(rec.done?'Annuler':'Marquer comme faite')+'</button></div>'+
        (rec.done?'<div class="donedate"><label>Faite le <input type="date" id="triDoneDate" value="'+esc(rec.date||todayStr())+'"></label></div>':'')+
        '<div class="field"><label>Réalisé</label><div class="tri-io"><input type="number" inputmode="decimal" step="0.1" min="0" class="t-dist" placeholder="'+(dz==="nat"?"ex : 1300":"ex : "+(dz==="velo"?"32":"7,5"))+'"><span class="tri-u">'+TRI_TARGETS[dz].u+'</span><input type="number" inputmode="decimal" step="1" min="0" class="t-dur" placeholder="min"><span class="tri-u">min</span></div><div class="tri-pace" hidden></div>'+(rec.val?'<div class="tri-legacy">Ancien réalisé : '+esc(rec.val)+'</div>':'')+'</div>'+
        '<div class="field"><label>Ressenti / notes</label><textarea class="t-note" placeholder="sensations, allure, météo…"></textarea></div>'+
      '</div>';
    var di=wrap.querySelector(".t-dist"),du=wrap.querySelector(".t-dur"),pc=wrap.querySelector(".tri-pace");
    di.value=(rec.dist!=null&&rec.dist!=="")?rec.dist:"";du.value=(rec.dur!=null&&rec.dur!=="")?rec.dur:"";
    function showPace(){var t=triPace(dz,num(di.value),num(du.value));if(t){pc.textContent=t;pc.hidden=false;}else pc.hidden=true;}
    showPace();
    di.addEventListener("input",function(){rec.dist=this.value;save();showPace();renderTriProgress();});
    du.addEventListener("input",function(){rec.dur=this.value;save();showPace();renderTriProgress();});
    wrap.querySelector(".t-note").value=rec.note||"";
    wrap.querySelector(".t-note").addEventListener("input",function(){rec.note=this.value;save();});
    wrap.querySelector("#triDone").addEventListener("click",function(){rec.done=!rec.done;if(rec.done&&!rec.date)rec.date=todayStr();save();renderTri();renderTriDetail();});
    var tdd=wrap.querySelector("#triDoneDate");if(tdd)tdd.addEventListener("change",function(){if(this.value){rec.date=this.value;save();renderTri();}});
  }

  /* ---------------- Transit (Bristol) ---------------- */
  function bristolOptions(sel){var o='<option value="">— état —</option>';BRISTOL.forEach(function(b){o+='<option value="'+b.v+'"'+(sel===b.v?' selected':'')+'>'+b.label+'</option>';});return o;}
  function renderStools(host,d){
    if(!host)return;
    var arr=day(d).stools;var h="";
    h+='<div class="muted" style="margin:0 0 8px">'+(arr.length===0?"Aucun passage noté.":arr.length+" passage"+(arr.length>1?"s":"")+" aujourd'hui")+'</div>';
    arr.forEach(function(st,i){h+='<div class="stool-row" data-i="'+i+'"><select class="st-type">'+bristolOptions(st.type||"")+'</select><button class="st-del" data-i="'+i+'" aria-label="Supprimer">✕</button></div>';});
    h+='<button class="btn ghost st-add">+ Ajouter un passage</button>';
    host.innerHTML=h;
    host.querySelectorAll(".st-type").forEach(function(sel){sel.addEventListener("change",function(){var i=parseInt(sel.closest(".stool-row").getAttribute("data-i"),10);day(d).stools[i].type=sel.value;save();});});
    host.querySelectorAll(".st-del").forEach(function(b){b.addEventListener("click",function(){var i=parseInt(b.getAttribute("data-i"),10);day(d).stools.splice(i,1);save();renderStools(host,d);});});
    host.querySelector(".st-add").addEventListener("click",function(){day(d).stools.push({type:""});save();renderStools(host,d);});
    var wrap=host.closest&&host.closest(".supps-field");if(wrap){var m=wrap.querySelector(".tr-meta");if(m)m.textContent=arr.length?arr.length:"";}
  }

  /* ---------------- Formulaire de journée ---------------- */
  var pxAllOpen=false;
  function journalSummary(x,d){
    var t=dayTotals(d),ef=t?Math.round(t.protEff!=null?t.protEff:t.prot):0;
    var sp=(x.sports&&x.sports.length)?x.sports.join(" · "):"repos";
    var parts=['🥩 '+ef+' g'];
    if(x.weight)parts.push('⚖️ '+x.weight+' kg');
    parts.push('🏋️ '+sp);
    return '<span class="jform-sum">'+esc(parts.join("   ·   "))+'</span>';
  }
  function hrvVal(iso){var x=state.days[iso];if(!x||x.hrv==null||x.hrv==="")return null;var v=parseFloat((""+x.hrv).replace(",","."));return v===v?v:null;}
  function hrvSeries(d,n){var out=[],base=new Date(d+"T00:00:00");for(var i=n-1;i>=0;i--){var dt=new Date(base);dt.setDate(dt.getDate()-i);var iso=dt.toISOString().slice(0,10);out.push({iso:iso,v:hrvVal(iso)});}return out;}
  function renderHrvTrend(container,d){
    var host=container.querySelector(".hrv-trend");if(!host)return;
    var ser=hrvSeries(d,14);
    var vals=ser.map(function(p){return p.v;}).filter(function(v){return v!=null;});
    if(!vals.length){host.innerHTML="";return;}
    var today=hrvVal(d);
    var prev=[];for(var i=ser.length-1;i>=0;i--){if(ser[i].iso<d&&ser[i].v!=null){prev.push(ser[i].v);if(prev.length>=7)break;}}
    var baseAvg=prev.length?prev.reduce(function(a,b){return a+b;},0)/prev.length:null;
    var mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals);if(mx===mn)mx=mn+1;
    var W=240,H=40,pad=4;
    var pts=[];ser.forEach(function(p,idx){if(p.v==null)return;var px=pad+idx*(W-2*pad)/(ser.length-1);var py=H-pad-(p.v-mn)/(mx-mn)*(H-2*pad);pts.push(px.toFixed(1)+","+py.toFixed(1));});
    var msg="",col="#555";
    if(today!=null&&baseAvg!=null){
      var pct=(today-baseAvg)/baseAvg*100;
      if(pct>=5){col="#2e7d32";msg="\ud83d\udfe2 "+Math.round(today)+" ms \u2014 au-dessus de ta base ("+Math.round(baseAvg)+") : bien r\u00e9cup\u00e9r\u00e9";}
      else if(pct<=-8){col="#c0392b";msg="\ud83d\udd34 "+Math.round(today)+" ms \u2014 sous ta base ("+Math.round(baseAvg)+") : fatigue probable, l\u00e8ve le pied";}
      else{col="#b8860b";msg="\ud83d\udfe1 "+Math.round(today)+" ms \u2014 proche de ta base ("+Math.round(baseAvg)+")";}
    } else if(today!=null){msg=Math.round(today)+" ms \u2014 base en cours de constitution";}
    else if(baseAvg!=null){msg="Base 7 j : "+Math.round(baseAvg)+" ms \u2014 renseigne aujourd'hui";}
    host.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="width:100%;height:40px;display:block;margin:6px 0 3px"><polyline points="'+pts.join(" ")+'" fill="none" stroke="#3a6ea5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg><div style="font-size:12.5px;font-weight:600;line-height:1.35;color:'+col+'">'+esc(msg)+'</div>';
  }
  function jBalHTML(x,d){var out=expend(d),intake=adjIntake(d),rt=dayTotals(d),raw=(rt?Math.round(rt.kcal):0),net=(out!=null)?(intake-out):null,adjOn=(x.kcalAdj!=null&&x.kcalAdj!=="");function lab(nn){return Math.abs(nn)<75?" · équilibre":(nn<0?" · déficit":" · surplus");}var h='<div class="field jbal"><label>Bilan énergie du jour</label>';if(out==null){h+='<div class="bal-row"><span>🍽️ Apport</span><b>'+intake+' kcal</b></div><div class="bal-sub">Complète taille / âge / sexe dans Réglages ▸ Profil pour estimer la dépense.</div>';}else{h+='<div class="bal-net'+(net<0?" neg":(net>75?" pos":""))+'"><span class="bal-net-v">'+(net>0?"+":"")+net+'</span><span class="bal-net-u">kcal net'+lab(net)+'</span></div><div class="bal-row"><span>🍽️ Apport'+(adjOn?" (ajusté)":"")+'</span><b>'+intake+' kcal</b></div><div class="bal-row"><span>🔥 Dépense</span><b>'+out+' kcal</b></div>';}h+='<details class="base-hint plus"><summary>Personnaliser</summary><div><div class="bal-acts"><div class="bal-act"><span class="bal-act-l">Ajuster l\'apport réel (kcal)</span><input type="number" inputmode="numeric" step="1" class="bal-watch-in f-kcaladj" value="'+esc(x.kcalAdj||"")+'" placeholder="'+(raw?("logué "+raw):"ex. 2400")+'"></div></div><div class="bal-sub">Corrige ici si un TGTG a faussé le total : ta moyenne 7 j (Progrès) se met à jour.</div></div></details></div>';return h;}
  var PX_PER_DAY=2;
  function pxOrder(d){
    var L=(typeof PETITS_EXOS!=="undefined"?PETITS_EXOS:[]);if(L.length<=PX_PER_DAY)return L.map(function(r){var o={};for(var q in r)o[q]=r[q];o._px=true;return o;});
    var ds=(""+d).replace(/-/g,""),seed=0;for(var i=0;i<ds.length;i++)seed=(seed*31+ds.charCodeAt(i))%9973;
    var sc=L.map(function(r,i){var age=999;
      for(var k=1;k<=60;k++){var y=state.days[isoOf(addDays(d,-k))];if(y&&y.petitsExos&&y.petitsExos[r.id]){age=k;break;}}
      return {r:r,age:age,tb:(seed+i*7)%L.length};});
    sc.sort(function(a,b){return (b.age-a.age)||(a.tb-b.tb);});
    return sc.map(function(o,i){var c={};for(var q in o.r)c[q]=o.r[q];c._px=(i<PX_PER_DAY);c._age=o.age;return c;});
  }
  var WADDS=[{id:"lem",emo:"\ud83c\udf4b",lbl:"Citron"},{id:"sel",emo:"\ud83e\uddc2",lbl:"Sel"},{id:"gin",emo:"\ud83e\udedb",lbl:"Gingembre"}];
  function wAddEmo(x){var e=WADDS.filter(function(a){return x.wAdd&&x.wAdd[a.id];}).map(function(a){return a.emo;}).join("");return e?(" "+e):"";}
  function wAddHTML(x){
    return '<div class="wadd">'+WADDS.map(function(a){return '<button type="button" class="wchip'+((x.wAdd&&x.wAdd[a.id])?' on':'')+'" data-wadd="'+a.id+'">'+a.emo+' '+a.lbl+'</button>';}).join("")+'</div>';
  }
  function wAddHint(){
    return '<details class="base-hint inl"><summary>i</summary><div><b>Hydratation</b> : touche le n-i\u00e8me verre et le total se pose directement \u00e0 n ; retoucher le dernier verre rempli le retire. Les trois pastilles sont un simple pense-b\u00eate du jour : rien n\'est compt\u00e9 dans tes calories ni dans tes totaux. <b>Citron</b> : un peu de vitamine C, surtout un go\u00fbt qui fait boire davantage \u2014 le vrai b\u00e9n\u00e9fice. <b>Sel</b> (une pinc\u00e9e) : le sodium aide l\'eau \u00e0 rester dans le sang au lieu de repartir aux toilettes \u2014 utile apr\u00e8s une grosse s\u00e9ance ou par forte chaleur, inutile au repos. <b>Gingembre</b> : agr\u00e9able pour la digestion, aucun effet d\u00e9montr\u00e9 sur l\'hydratation. Aucun des trois ne remplace une vraie boisson d\'effort sur un triathlon.</div></details>';
  }
  /* Formulaire du jour — une fonction par section. Chacune renvoie un fragment
     ÉQUILIBRÉ (autant de <div ouverts que fermés) : une section ne peut plus
     déborder sur la suivante, et un patch ne touche que 15 lignes au lieu de 150.
     Toutes tournent dans le même IIFE : elles voient bndOpen, MEALS, SUPPS, etc. */
  /* Hydratation — hors de tout repli, en tête du jour.
     Un tap sur le n-ième verre pose directement la valeur à n (et retaper le dernier
     verre rempli le retire) : n'importe quelle quantité s'atteint en UN geste. */
  function dfWater(x,d){
    var goal=Math.max(1,goalsAt(d).water),n=Math.max(goal,x.water||0),cap=Math.min(n,14);
    var g="";
    for(var i=1;i<=cap;i++)g+='<button type="button" class="hy-g'+((x.water||0)>=i?" on":"")+(i>goal?" xtra":"")+'" data-w="'+i+'" aria-label="'+i+' verre'+(i>1?"s":"")+'"></button>';
    return '<div class="field hydra">'+
      '<div class="hy-top"><label class="hy-lab" title="Hydratation">\ud83d\udca7</label>'+wAddHint()+'<span class="hy-sum"></span></div>'+
      '<div class="hy-glasses">'+g+'<button type="button" class="hy-g hy-plus" data-w="+" aria-label="Un verre de plus">+</button></div>'+
      wAddHTML(x)+'</div>';
  }
  function dfJprot(){
    return ('<div class="meal-total-top"><div class="meal-total"></div>'+bndHead("jprot","mini",{ttl:"🥩 Détail protéines",attrs:" hidden"})+bndBody("jprot","jprot-body")+'</div>');
  }

  function dfEnergie(x,d,chips){
    return '<div class="field dg-field">'+
          bndHead("eg","group",{stick:true,ttl:"\u26a1 \u00c9nergie &amp; sport",sum:"",cls:"eg-meta"})+
          '<div class="bnd-body eg-body'+(bndOpen.eg?'':' collapsed')+'" data-bndb="eg">'+
        jBalHTML(x,d)+
        /* Les détails Protéines et Bilan kcal vivent désormais dans l'écran d'axe
           du radar (tape le logo correspondant) : l'accueil reste lisible. */
        '<div class="field"><label>Sports du jour</label>'+chips+'</div>'+
        '</div>'+
        '</div>';
  }

  function dfCorps(x){
    return '<div class="field dg-field">'+
          bndHead("cm","group",{stick:true,ttl:"\ud83d\udcca Corps &amp; mesures",sum:"",cls:"cm-meta"})+
          '<div class="bnd-body cm-body'+(bndOpen.cm?'':' collapsed')+'" data-bndb="cm">'+

        '<div class="field"><label>Poids (kg)</label><input type="number" inputmode="decimal" step="0.1" class="f-weight" placeholder="ex : 68,4"></div>'+
'<div class="field"><label>Sommeil (h)</label><input type="number" inputmode="decimal" step="0.5" class="f-sleep" placeholder="ex : 7,5"></div>'+
'<div class="field"><span class="lbl-row"><label>VFC au r\u00e9veil (ms)</label><details class="base-hint inl"><summary>i</summary><div>La VFC (variabilit\u00e9 de la fr\u00e9quence cardiaque, en ms) mesure les micro-\u00e9carts entre deux battements de c\u0153ur. Plus elle est haute, mieux ton syst\u00e8me nerveux r\u00e9cup\u00e8re : bon indicateur de fatigue r\u00e9elle plut\u00f4t que ressentie. Une VFC basse le matin = corps encore fatigu\u00e9, tu peux all\u00e9ger la s\u00e9ance ou viser la r\u00e9cup\u00e9ration. Pour la relever : ta montre (Apple Watch \u2192 app Sant\u00e9 \u2192 Variabilit\u00e9 de la FC) la mesure la nuit ; note la valeur en ms chaque matin, au calme, pour comparer jour apr\u00e8s jour.</div></details></span><input type="number" inputmode="numeric" step="1" class="f-hrv" placeholder="ex : 52"><div class="hrv-trend"></div></div>'+
        '</div>'+
        '</div>';
  }

  function dfRepas(){
    return '<div class="field"><label>Repas</label>'+
          MEALS.map(function(m){return '<div class="meal'+(mealOpen[m.k]?" open":"")+'" data-mk="'+m.k+'"><button type="button" class="meal-h" data-mk="'+m.k+'"><span class="meal-lbl">'+m.label+'</span><span class="meal-sum" data-sum="'+m.k+'"></span><span class="meal-chev">▾</span></button><div class="meal-items" data-mk="'+m.k+'"></div></div>';}).join("")+

        '</div>';
  }

  function dfBienEtre(x,d){
    return '<div class="field supps-field wb-group">'+
          bndHead("wb","sec",{stick:true,ttl:"Bien-être &amp; suivi"})+
          '<div class="bnd-body wb-body'+(bndOpen.wb?'':' collapsed')+'" data-bndb="wb">'+
        '<div class="field supps-field">'+
          bndHead("sp","sub",{ttl:"Compléments alimentaires",cls:"sp-meta",meta:+((typeof SUPPS!=="undefined"?SUPPS:[]).filter(function(sp){return x.supps&&x.supps[sp.id];}).length)+'/'+(typeof SUPPS!=="undefined"?SUPPS.length:0)})+
          '<div class="bnd-body'+(bndOpen.sp?'':' collapsed')+'" data-bndb="sp">'+
            (typeof SUPP_SLOTS!=="undefined"?SUPP_SLOTS:[]).map(function(slot){
              var items=(typeof SUPPS!=="undefined"?SUPPS:[]).filter(function(sp){return sp.when===slot.id;});
              if(!items.length)return "";
              return '<div class="supp-slot"><div class="supp-slot-h">'+esc(slot.label)+'</div>'+items.map(function(sp){return '<label class="supp"><input type="checkbox" class="f-supp" data-id="'+sp.id+'"><span class="supp-txt"><span class="supp-name">'+esc(sp.name)+'</span>'+(sp.dose?'<span class="supp-dose">'+esc(sp.dose)+'</span>':'')+'</span>'+(sp.prot?'<span class="supp-badge">+'+sp.prot+' g prot</span>':'')+(sp.prot?'<span class="supp-meal"'+((x.supps&&x.supps[sp.id])?'':' hidden')+'>\u2248 <select class="f-suppmeal" data-id="'+sp.id+'">'+MEALS.map(function(mm){return '<option value="'+mm.k+'"'+((((x.suppMeal&&x.suppMeal[sp.id])||"co")===mm.k)?' selected':'')+'>'+esc(mm.label)+'</option>';}).join("")+'</select></span>':'')+'<button type="button" class="supp-x2'+((x.supps2&&x.supps2[sp.id])?" on":"")+'" data-x2="'+sp.id+'" title="Pris 2 fois aujourd\'hui">×2</button></label>';}).join("")+'</div>';
            }).join("")+
            '<div class="supp-hint">Le whey coché s\'ajoute à tes protéines du jour.</div>'+
            '<div class="xtras supps-x">'+((x.suppsX||[]).map(function(n,i){return '<span class="xchip">'+esc(n)+'<button type="button" class="xdel" data-k="supps" data-i="'+i+'">×</button></span>';}).join(""))+'</div>'+
            '<input class="x-in supps-xin" placeholder="Complément exceptionnel puis Entrée…">'+
          '</div>'+
        '</div>'+
        '<div class="field supps-field">'+
          bndHead("rx","sub",{ttl:"Ce qui te fait du bien",cls:"rx-meta",meta:""})+
          '<div class="bnd-body rx-body'+(bndOpen.rx?'':' collapsed')+'" data-bndb="rx">'+
            (typeof ROUTINES!=="undefined"?ROUTINES:[]).map(function(r){var info=r.link?'<button type="button" class="rx-info" data-rx="'+r.id+'" aria-label="Infos">i</button>':'';var help=r.link?'<div class="rx-help" id="rxhelp-'+r.id+'"><a href="'+esc(r.link)+'" target="_blank" rel="noopener">'+esc(r.linkLabel||"Ouvrir")+' ↗</a></div>':'';return '<div class="rx-item"><label class="supp"><input type="checkbox" class="f-rx" data-id="'+r.id+'"><span class="supp-txt"><span class="supp-name">'+(r.icon?esc(r.icon)+' ':'')+esc(r.name)+'</span></span>'+info+'</label>'+help+'</div>';}).join("")+
            '<div class="xtras rx-x">'+((x.routinesX||[]).map(function(n,i){return '<span class="xchip">'+esc(n)+'<button type="button" class="xdel" data-k="rx" data-i="'+i+'">×</button></span>';}).join(""))+'</div>'+
            '<input class="x-in rx-xin" placeholder="Autre activité puis Entrée…">'+
            '<div class="supp-hint">Coche ce que tu as fait aujourd\'hui — la régularité compte plus que la quantité.</div>'+
          '</div>'+
        '</div>'+
        '<div class="field supps-field">'+
          bndHead("px","sub",{ttl:"Petits exercices",cls:"px-meta",meta:""})+
          '<div class="bnd-body px-body'+(bndOpen.px?'':' collapsed')+'" data-bndb="px">'+
            pxOrder(d).map(function(r){var info=r.link?'<button type="button" class="rx-info" data-rx="px-'+r.id+'" aria-label="Infos">i</button>':'';var help=r.link?'<div class="rx-help" id="rxhelp-px-'+r.id+'"><a href="'+esc(r.link)+'" target="_blank" rel="noopener">'+esc(r.linkLabel||"Ouvrir")+' ↗</a></div>':'';return '<div class="rx-item'+(r._px?'':' px-hid')+'"><label class="supp"><input type="checkbox" class="f-px" data-id="'+r.id+'"><span class="supp-txt"><span class="supp-name">'+(r.icon?esc(r.icon)+' ':'')+esc(r.name)+'</span></span>'+info+'</label>'+help+'</div>';}).join("")+
            '<button type="button" class="px-more'+(pxAllOpen?' open':'')+'">'+(pxAllOpen?'Masquer les autres':'Voir les autres exercices')+'</button>'+
            '<div class="xtras px-x">'+((x.petitsExosX||[]).map(function(n,i){return '<span class="xchip">'+esc(n)+'<button type="button" class="xdel" data-k="px" data-i="'+i+'">×</button></span>';}).join(""))+'</div>'+
            '<input class="x-in px-xin" placeholder="Autre exercice puis Entrée…">'+
            '<div class="supp-hint">2 exercices tirés chaque jour, en priorité ceux que tu as le plus laissés de côté. Le cycle passe sur les 9 sans en oublier — les autres restent accessibles juste au-dessus.</div>'+
          '</div>'+
        '</div>'+
        '<div class="field supps-field">'+
          bndHead("cr","sub",{ttl:"Ancrages",cls:"cr-meta",meta:""})+
          '<div class="bnd-body cr-body'+(bndOpen.cr?'':' collapsed')+'" data-bndb="cr">'+
            (customRoutines().length?customRoutines().map(function(a){
              /* M\u00eame patron que les petits exercices : un \u00ab i \u00bb qui d\u00e9plie un lien.
                 Sans lien saisi, on propose une recherche YouTube sur l'intitul\u00e9. */
              var url=(a.link||"").trim(),yt=!url;
              if(!url)url="https://www.youtube.com/results?search_query="+encodeURIComponent(a.label||"");
              return '<div class="rx-item"><label class="supp"><input type="checkbox" class="f-cr" data-id="'+a.id+'"><span class="supp-txt"><span class="supp-name">'+(a.icon?esc(a.icon)+' ':'')+esc(a.label)+'</span></span>'+
                '<button type="button" class="rx-info" data-rx="cr-'+a.id+'" aria-label="Infos">i</button></label>'+
                '<div class="rx-help" id="rxhelp-cr-'+a.id+'"><a href="'+esc(url)+'" target="_blank" rel="noopener">'+(yt?"\u25b6\ufe0e Chercher sur YouTube":"Ouvrir")+' \u2197</a></div>'+
                (a.note?'<textarea class="f-crnote" data-id="'+a.id+'" rows="2" placeholder="Note du jour\u2026"></textarea>':'')+
              '</div>';}).join(""):'<div class="supp-hint">Cr\u00e9e tes ancrages dans R\u00e9glages \u25b8 Ancrages de routines.</div>')+
          '</div>'+
        '</div>'+
        '<div class="field supps-field">'+
          bndHead("tr","sub",{ttl:"Transit",cls:"tr-meta",meta:""})+
          '<div class="bnd-body tr-body'+(bndOpen.tr?'':' collapsed')+'" data-bndb="tr"><div class="stools f-stools"></div></div>'+
        '</div>'+
        '<div class="field"><label>Note du jour</label><textarea class="f-note" placeholder="ressenti, énergie, douleurs…"></textarea></div>'+
          '</div>'+
        '</div>';
  }
  function buildDayForm(container,d){
    var x=day(d);
    var dlId="foodlist-"+(container.id||"x");
    var chips='<div class="chips">'+SPORTS.map(function(sp){return '<button type="button" class="chip'+(x.sports.indexOf(sp)>-1?' on':'')+'" data-sport="'+sp+'">'+sp+'</button>';}).join("")+'</div>';
    container.innerHTML='<div class="card pad">'
      +dfWater(x,d)
      +dfJprot()
      +dfEnergie(x,d,chips)
      +dfCorps(x)
      +dfRepas()
      +dfBienEtre(x,d)
      +'</div>';

    container.querySelector(".f-weight").value=x.weight||"";
    container.querySelector(".f-sleep").value=x.sleep||"";
    function dgMeta(){
      var eg=container.querySelector(".eg-meta"),cm=container.querySelector(".cm-meta");
      if(eg){var p=[],out=expend(d);if(out!=null){var net=adjIntake(d)-out;p.push((net>0?"+":"")+net+" kcal");}
        var ns=(x.sports&&x.sports.length)||0;if(ns)p.push(ns+" sport"+(ns>1?"s":""));
        eg.textContent=p.join(" \u00b7 ");}
      if(cm){var q=[];if(x.weight)q.push(nFmt(num(x.weight))+" kg");if(x.sleep)q.push(nFmt(num(x.sleep))+" h");
        if(x.hrv)q.push(x.hrv+" ms");if(x.water>0)q.push(x.water+" verre"+(x.water>1?"s":"")+wAddEmo(x));
        cm.textContent=q.join(" \u00b7 ");}
    }
    (function(){
      /* résumé d'en-tête tenu à jour sans toucher aux handlers existants */
      container.addEventListener("input",dgMeta);
      container.addEventListener("change",dgMeta);
      container.addEventListener("click",function(){setTimeout(dgMeta,0);});
    })();
    dgMeta();
    var hrvIn=container.querySelector(".f-hrv");if(hrvIn)hrvIn.value=x.hrv||"";
    container.querySelector(".f-note").value=x.note||"";

    container.querySelector(".f-weight").addEventListener("input",function(){x.weight=this.value;save();});
    container.querySelector(".f-sleep").addEventListener("input",function(){x.sleep=this.value;save();});
    if(hrvIn)hrvIn.addEventListener("input",function(){var v=(hrvIn.value||"").trim();if(v==="")delete x.hrv;else x.hrv=v;save();renderHrvTrend(container,d);});
    function updSuppsMeta(){var m=container.querySelector(".sp-meta");if(!m)return;var f=(typeof SUPPS!=="undefined"?SUPPS:[]).filter(function(sp){return x.supps&&x.supps[sp.id];}).length+(x.suppsX||[]).length;m.textContent=f+"/"+((typeof SUPPS!=="undefined"?SUPPS.length:0)+(x.suppsX||[]).length);}
    function updRxMeta(){var m=container.querySelector(".rx-meta");if(!m)return;var f=(typeof ROUTINES!=="undefined"?ROUTINES:[]).filter(function(r){return (x.routines&&x.routines[r.id])||(r.id==="medit"&&x.meditation);}).length+(x.routinesX||[]).length;m.textContent=f+"/"+((typeof ROUTINES!=="undefined"?ROUTINES.length:0)+(x.routinesX||[]).length);}
    function updPxMeta(){var m=container.querySelector(".px-meta");if(!m)return;var L=pxOrder(d),sel=L.filter(function(r){return r._px;});var inSel=sel.filter(function(r){return x.petitsExos&&x.petitsExos[r.id];}).length;var extra=L.filter(function(r){return !r._px&&x.petitsExos&&x.petitsExos[r.id];}).length+(x.petitsExosX||[]).length;m.textContent=inSel+"/"+sel.length+(extra?" +"+extra:"");}    updSuppsMeta();updRxMeta();updPxMeta();
    container.querySelectorAll(".f-rx").forEach(function(cb){
      var id=cb.getAttribute("data-id");
      cb.checked=!!((x.routines&&x.routines[id])||(id==="medit"&&x.meditation));
      cb.addEventListener("change",function(){if(!x.routines)x.routines={};x.routines[id]=cb.checked;if(id==="medit")x.meditation=cb.checked;save();updRxMeta();});
    });
    container.querySelectorAll(".rx-info").forEach(function(bt){bt.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();var h=container.querySelector("#rxhelp-"+bt.getAttribute("data-rx"));if(h)h.classList.toggle("open");});});
    container.querySelectorAll(".f-px").forEach(function(cb){var id=cb.getAttribute("data-id");cb.checked=!!(x.petitsExos&&x.petitsExos[id]);cb.addEventListener("change",function(){if(!x.petitsExos)x.petitsExos={};x.petitsExos[id]=cb.checked;save();updPxMeta();});});
    function updCrMeta(){var m=container.querySelector(".cr-meta");if(!m)return;var l=customRoutines();var f=l.filter(function(a){return x.customRoutines&&x.customRoutines[a.id];}).length;m.textContent=l.length?f+"/"+l.length:"";}
    container.querySelectorAll(".f-cr").forEach(function(cb){var id=cb.getAttribute("data-id");cb.checked=!!(x.customRoutines&&x.customRoutines[id]);cb.addEventListener("change",function(){if(!x.customRoutines)x.customRoutines={};if(cb.checked)x.customRoutines[id]=true;else delete x.customRoutines[id];save();updCrMeta();});});
    container.querySelectorAll(".f-crnote").forEach(function(ta){var id=ta.getAttribute("data-id");
      ta.value=(x.crNote&&x.crNote[id])||"";
      ta.addEventListener("input",function(){if(!x.crNote)x.crNote={};var v=ta.value;if(v)x.crNote[id]=v;else delete x.crNote[id];save();});});
    updCrMeta();
    container.querySelectorAll(".px-n").forEach(function(ni){var id=ni.getAttribute("data-id");if(x.petitsExosN&&x.petitsExosN[id]!=null&&x.petitsExosN[id]!=="")ni.value=x.petitsExosN[id];ni.addEventListener("input",function(){if(!x.petitsExosN)x.petitsExosN={};var v=(ni.value||"").trim();if(v==="")delete x.petitsExosN[id];else x.petitsExosN[id]=v;save();});});
    (function(){var b=container.querySelector(".px-more");if(!b)return;b.addEventListener("click",function(){pxAllOpen=!pxAllOpen;b.classList.toggle("open",pxAllOpen);b.textContent=pxAllOpen?"Masquer les autres":"Voir les autres exercices";var bd=container.querySelector(".px-body");if(bd)bd.classList.toggle("px-all",pxAllOpen);});})();
    renderHrvTrend(container,d);
    (function(){var m=container.querySelector(".tr-meta");if(m)m.textContent=(x.stools&&x.stools.length)?x.stools.length:"";})();
    (function(){var si=container.querySelector(".supps-xin");if(si)si.addEventListener("keydown",function(e){if(e.key==="Enter"){var v=(si.value||"").trim();if(!v)return;if(!x.suppsX)x.suppsX=[];x.suppsX.push(v);save();buildDayForm(container,d);}});
      var ri=container.querySelector(".rx-xin");if(ri)ri.addEventListener("keydown",function(e){if(e.key==="Enter"){var v=(ri.value||"").trim();if(!v)return;if(!x.routinesX)x.routinesX=[];x.routinesX.push(v);save();buildDayForm(container,d);}});
      var pi=container.querySelector(".px-xin");if(pi)pi.addEventListener("keydown",function(e){if(e.key==="Enter"){var v=(pi.value||"").trim();if(!v)return;if(!x.petitsExosX)x.petitsExosX=[];x.petitsExosX.push(v);save();buildDayForm(container,d);}});
      container.querySelectorAll(".xdel").forEach(function(b){b.addEventListener("click",function(){var k=b.getAttribute("data-k"),i=+b.getAttribute("data-i");var arr=(k==="supps"?x.suppsX:k==="px"?x.petitsExosX:x.routinesX)||[];arr.splice(i,1);save();buildDayForm(container,d);});});
    })();
    container.querySelector(".f-note").addEventListener("input",function(){x.note=this.value;save();});
    (function(){var ka=container.querySelector(".f-kcaladj");if(!ka)return;ka.addEventListener("change",function(){var v=(ka.value||"").trim();if(v==="")delete x.kcalAdj;else x.kcalAdj=v;save();buildDayForm(container,d);renderDayBalance(d);});})();
    container.querySelectorAll(".f-supp").forEach(function(cb){
      var id=cb.getAttribute("data-id");
      cb.checked=!!(x.supps&&x.supps[id]);
      cb.addEventListener("change",function(){if(!x.supps)x.supps={};x.supps[id]=cb.checked;var lab=cb.closest(".supp");var sm=lab?lab.querySelector(".supp-meal"):null;if(sm)sm.hidden=!cb.checked;save();recalcTotals();
        updSuppsMeta();});
    });
    container.querySelectorAll(".supp-x2").forEach(function(bt){
      bt.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();var id=bt.getAttribute("data-x2");if(!x.supps2)x.supps2={};x.supps2[id]=!x.supps2[id];bt.classList.toggle("on",x.supps2[id]);save();if(x.supps&&x.supps[id])recalcTotals();});
    });
    container.querySelectorAll(".chip").forEach(function(ch){ch.addEventListener("click",function(){var sp=ch.getAttribute("data-sport");var arr=x.sports;var i=arr.indexOf(sp);if(i>-1){arr.splice(i,1);ch.classList.remove("on");}else{arr.push(sp);ch.classList.add("on");}save();});});

    (function(){
      var sum=container.querySelector(".hy-sum");
      function upd(){
        var goal=Math.max(1,goalsAt(d).water),w=x.water||0;
        if(sum)sum.innerHTML=w+' / '+goal+' verres <span class="hy-l">\u00b7 '+fr1(w*0.25)+' L</span>'+(w>=goal?' <span class="ok">\u2713</span>':'');
        container.querySelectorAll(".hy-g[data-w]").forEach(function(b){
          var v=b.getAttribute("data-w");if(v==="+")return;
          b.classList.toggle("on",w>=parseInt(v,10));
        });
      }
      upd();
      container.querySelectorAll(".hy-g").forEach(function(b){b.addEventListener("click",function(){
        var v=b.getAttribute("data-w");
        if(v==="+")x.water=(x.water||0)+1;
        else{var n=parseInt(v,10);x.water=((x.water||0)===n)?n-1:n;}
        save();upd();buildDayForm(container,d);
      });});
      container.querySelectorAll(".wchip").forEach(function(b){b.addEventListener("click",function(){var id=b.getAttribute("data-wadd");if(!x.wAdd)x.wAdd={};x.wAdd[id]=!x.wAdd[id];b.classList.toggle("on",!!x.wAdd[id]);save();});});
    })();

    renderStools(container.querySelector(".f-stools"),d);
    renderHrvTrend(container,d);

    /* Complété = on sait convertir la quantité en énergie et en protéines. */
    function nutFilled(it){var n=it&&it.nut;return !!(n&&num(n.base)>0&&n.kcal!==""&&n.kcal!=null&&!isNaN(num(n.kcal))&&n.prot!==""&&n.prot!=null&&!isNaN(num(n.prot)));}
    function sumText(it){var s=scaleNut(it);if(!s)return "";return "≈ "+(s.kcal!==undefined?Math.round(s.kcal)+" kcal":"")+((s.kcal!==undefined&&s.prot!==undefined)?" · ":"")+(s.prot!==undefined?fr1(s.prot)+" g prot.":"");}
    function recalcTotals(){var t=dayTotals(d);var el=container.querySelector(".meal-total");if(el){if(t){el.textContent="Jour · "+Math.round(t.kcal)+" kcal · "+fr1(pEff(t))+" g prot.";el.className="meal-total on";}else{el.textContent="Tape un aliment puis Entrée. Touche une étiquette pour ses valeurs nutritionnelles.";el.className="meal-total";}}var jt=container.querySelector('[data-bnd="jprot"]'),jb=container.querySelector(".jprot-body");if(jt&&jb){if(t){jt.hidden=false;jb.innerHTML=protBreakHTML(t)+dayMealDistHTML(d);jb.querySelectorAll(".md-mode").forEach(function(b){b.onclick=function(){mealDistMode=b.getAttribute("data-mode");recalcTotals();};});}else{jt.hidden=true;jb.innerHTML="";}}renderDayNutri(d);}
    var mealEdit={pd:-1,dj:-1,dn:-1,co:-1},mealEditPrev=null;
    function renderMeal(mk){
      var host=container.querySelector('.meal-items[data-mk="'+mk+'"]');
      var arr=day(d).mealItems[mk];var ed=mealEdit[mk];var h="";
      if(ed>-1&&arr[ed]&&mealEditPrev!==mk+":"+ed){mealEditPrev=mk+":"+ed;bndOpen.tenut=!nutFilled(arr[ed]);}
      if(ed<0&&mealEditPrev&&mealEditPrev.indexOf(mk+":")===0)mealEditPrev=null;
      h+='<div class="tags">';
      arr.forEach(function(it,i){
        h+='<span class="tag'+(ed===i?" on":"")+(it.nut?" has-nut":"")+'" data-i="'+i+'">'+esc(it.name||"—")+foodQualityBadges(it.name,d)+(it.nut?'<span class="tag-q">'+esc(effPortion(it))+'</span>':'')+'<button type="button" class="tag-x" data-i="'+i+'" aria-label="Supprimer">×</button></span>';
      });
      h+='</div>';
      h+='<input type="text" class="tag-input" placeholder="Aliment puis Entrée…" enterkeyhint="done" autocomplete="off">';
      h+='<div class="tag-suggest" hidden></div>';
      if(ed>-1&&arr[ed]){
        var it=arr[ed];
        var _full=nutFilled(it);
        h+='<div class="tag-editor"><div class="te-title">'+esc(it.name)+'</div>'+
          '<div class="te-row"><label>Quantité<input type="number" inputmode="decimal" step="any" class="te-qty" placeholder="ex : 150" value="'+esc(it.qty)+'"></label>'+
          '<label>Unité<select class="te-unit">'+unitOptions(it.unit||"g")+'</select></label></div>'+
          bndHead("tenut","sub",{ttl:"\ud83e\uddea Composition",cls:"te-state",meta:(_full?"\u2705":"\u26a0\ufe0f")})+
          '<div class="bnd-body te-nut'+(bndOpen.tenut?"":" collapsed")+'" data-bndb="tenut">'+
          '<div class="te-row"><label>Valeurs pour<input type="number" inputmode="decimal" step="any" class="te-base" placeholder="100" value="'+esc(it.nut?it.nut.base:"")+'"></label>'+
          '<label>&nbsp;<select class="te-baseunit">'+unitOptions(it.nut?it.nut.baseUnit:(it.unit||"g"))+'</select></label></div>'+
          '<div class="nut-grid">'+
            '<label>kcal<input type="number" inputmode="decimal" step="any" class="te-kcal" value="'+esc(it.nut?it.nut.kcal:"")+'"></label>'+
            '<label>Prot. (g)<input type="number" inputmode="decimal" step="any" class="te-prot" value="'+esc(it.nut?it.nut.prot:"")+'"></label>'+
            '<label>Gluc. (g)<input type="number" inputmode="decimal" step="any" class="te-gluc" value="'+esc(it.nut?it.nut.gluc:"")+'"></label>'+
            '<label>Lip. (g)<input type="number" inputmode="decimal" step="any" class="te-lip" value="'+esc(it.nut?it.nut.lip:"")+'"></label>'+
          '</div>'+
          '</div>'+
          (sumText(it)?'<div class="food-sum">'+sumText(it)+'</div>':'')+
          '<button type="button" class="te-scan">📷 Scanner un code-barres</button>'+
          '<button type="button" class="te-close">Fermer</button>'+
        '</div>';
      }
      host.innerHTML=h;
      var _sum=container.querySelector('.meal-sum[data-sum="'+mk+'"]');if(_sum){var _a=day(d).mealItems[mk]||[],_p=0;_a.forEach(function(it){var s=scaleNut(it);if(s&&s.prot)_p+=s.prot;});_sum.textContent=fr1(_p)+" / "+Math.round(130/MEALS.length)+" g prot"+(_p>=Math.round(130/MEALS.length)?" ✓":"");}
      host.querySelectorAll(".tag").forEach(function(tg){
        tg.addEventListener("click",function(e){if(e.target.classList.contains("tag-x")||(e.target.closest&&e.target.closest(".fq")))return;var i=parseInt(tg.getAttribute("data-i"),10);mealEdit[mk]=(mealEdit[mk]===i?-1:i);renderMeal(mk);});
      });
      host.querySelectorAll(".tag-x").forEach(function(b){
        b.addEventListener("click",function(e){e.stopPropagation();var i=parseInt(b.getAttribute("data-i"),10);day(d).mealItems[mk].splice(i,1);if(mealEdit[mk]===i)mealEdit[mk]=-1;else if(mealEdit[mk]>i)mealEdit[mk]--;save();renderMeal(mk);recalcTotals();});
      });
      var inp=host.querySelector(".tag-input");
      var sug=host.querySelector(".tag-suggest");
      function addFood(v){
        v=(""+v).trim();if(!v)return;
        var nit={name:v,qty:"",unit:"g",nut:null};var hit=foodCatalog()[v.toLowerCase()];
        if(hit&&hit.nut){nit.nut=JSON.parse(JSON.stringify(hit.nut));nit.unit=hit.unit||"g";var pq=num(nit.nut.portion)>0?nit.nut.portion:nit.nut.base;if(num(pq)>0)nit.qty=""+pq;}
        day(d).mealItems[mk].push(nit);save();renderMeal(mk);recalcTotals();
        var ni=host.querySelector(".tag-input");if(ni)ni.focus();
      }
      function showSug(){
        if(!sug)return;
        var v=inp.value.trim().toLowerCase();
        if(!v){sug.hidden=true;sug.innerHTML="";return;}
        var cat=foodCatalog(),starts=[],contains=[];
        Object.keys(cat).forEach(function(k){var idx=cat[k].name.toLowerCase().indexOf(v);if(idx===0)starts.push(k);else if(idx>0)contains.push(k);});
        var list=starts.concat(contains).slice(0,6);
        if(!list.length){sug.hidden=true;sug.innerHTML="";return;}
        sug.innerHTML=list.map(function(k){
          var f=cat[k],meta;
          if(f.nut&&f.nut.kcal!==""&&f.nut.kcal!=null&&!isNaN(num(f.nut.kcal))){
            meta='<span class="sug-meta">'+Math.round(num(f.nut.kcal))+' kcal'+(f.nut.prot!==""&&f.nut.prot!=null&&!isNaN(num(f.nut.prot))?' · '+fr1(num(f.nut.prot))+' g prot':'')+' / '+esc(f.nut.base||"100")+esc(f.nut.baseUnit||"g")+'</span>';
          }else{meta='<span class="sug-meta sug-empty">sans valeurs</span>';}
          return '<button type="button" class="sug" data-k="'+esc(k)+'">'+esc(f.name)+meta+'</button>';
        }).join("");
        sug.hidden=false;
        sug.querySelectorAll(".sug").forEach(function(b){
          b.addEventListener("mousedown",function(e){e.preventDefault();});
          b.addEventListener("click",function(){var f=foodCatalog()[b.getAttribute("data-k")];sug.hidden=true;addFood(f?f.name:b.getAttribute("data-k"));});
        });
      }
      inp.addEventListener("input",showSug);
      inp.addEventListener("focus",showSug);
      inp.addEventListener("blur",function(){setTimeout(function(){if(sug)sug.hidden=true;},180);});
      inp.addEventListener("keydown",function(e){
        if(e.key==="Enter"||e.keyCode===13){e.preventDefault();var v=this.value.trim();if(!v)return;if(sug)sug.hidden=true;addFood(v);}
      });
      if(ed>-1&&arr[ed]){
        var item=day(d).mealItems[mk][ed];
        var ensureNut=function(){if(!item.nut)item.nut={base:"",baseUnit:(item.unit||"g"),kcal:"",prot:"",gluc:"",lip:""};};
        var updEdSum=function(){var s=sumText(item);var el=host.querySelector(".food-sum");if(el){el.textContent=s;el.style.display=s?"":"none";}else if(s){var nd=document.createElement("div");nd.className="food-sum";nd.textContent=s;var box=host.querySelector(".tag-editor");box.insertBefore(nd,host.querySelector(".te-close"));}};
        host.querySelector(".te-qty").addEventListener("input",function(){item.qty=this.value;save();recalcTotals();updEdSum();});
        host.querySelector(".te-unit").addEventListener("change",function(){item.unit=this.value;save();recalcTotals();updEdSum();});
        host.querySelector(".te-base").addEventListener("input",function(){ensureNut();item.nut.base=this.value;save();recalcTotals();updEdSum();});
        host.querySelector(".te-baseunit").addEventListener("change",function(){ensureNut();item.nut.baseUnit=this.value;save();recalcTotals();updEdSum();});
        ["kcal","prot","gluc","lip"].forEach(function(f){host.querySelector(".te-"+f).addEventListener("input",function(){ensureNut();item.nut[f]=this.value;save();recalcTotals();updEdSum();});});
        host.querySelector(".te-close").addEventListener("click",function(){mealEdit[mk]=-1;renderMeal(mk);});
        var teScan=host.querySelector(".te-scan");
        if(teScan)teScan.addEventListener("click",function(){openScanner(function(res){ensureNut();if(!item.name||item.name==="")item.name=res.name;item.unit="g";item.nut.base="100";item.nut.baseUnit="g";item.nut.kcal=res.nut.kcal;item.nut.prot=res.nut.prot;item.nut.gluc=res.nut.gluc;item.nut.lip=res.nut.lip;if(!item.qty||item.qty==="")item.qty="100";save();renderMeal(mk);recalcTotals();});});
      }
    }
    MEALS.forEach(function(m){renderMeal(m.k);});
    container.querySelectorAll(".meal-h").forEach(function(hh){hh.onclick=function(){var mk=hh.getAttribute("data-mk");mealOpen[mk]=!mealOpen[mk];var meal=hh.parentNode;if(meal)meal.classList.toggle("open",!!mealOpen[mk]);};});
    recalcTotals();
  }

  /* ---------------- Progrès : poids ---------------- */
  function weightEntries(){var arr=[];Object.keys(state.days).forEach(function(d){var wv=num(state.days[d].weight);if(!isNaN(wv))arr.push({d:d,w:wv});});arr.sort(function(a,b){return a.d<b.d?-1:1;});return arr;}
  function renderWeightChart(){
    var host=document.getElementById("weightChart");var e=weightEntries();
    if(e.length<2){host.innerHTML='<div class="empty">Note ton poids au moins 2 jours pour voir la courbe.</div>';return;}
    var W=320,H=92,pad=8;
    var vals=e.map(function(x){return x.w;});
    var min=Math.min.apply(null,vals),max=Math.max.apply(null,vals);
    if(max-min<1){max+=0.5;min-=0.5;}
    var n=e.length;
    function X(i){return pad+(i/(n-1))*(W-2*pad);}
    function Y(w){return pad+(1-(w-min)/(max-min))*(H-2*pad);}
    var pts=e.map(function(x,i){return X(i)+","+Y(x.w);}).join(" ");
    var dots=e.map(function(x,i){return '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(x.w).toFixed(1)+'" r="2.6" fill="#F4622B"/>';}).join("");
    var delta=e[n-1].w-e[0].w;
    host.innerHTML='<svg viewBox="0 0 '+W+' '+H+'"><polyline fill="none" stroke="#12466B" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="'+pts+'"/>'+dots+'</svg>'+
      '<div class="muted" style="margin-top:8px;font-size:13px">'+fr1(e[0].w)+' kg → '+fr1(e[n-1].w)+' kg · <b>'+(delta>=0?"+":"")+fr1(delta)+' kg</b> sur '+n+' relevés</div>';
  }

  /* ---------------- Progrès : protéines ---------------- */
  function pEff(t){return t?(t.protEff!=null?t.protEff:t.prot):0;}
  function proteinEntries(){var arr=[];Object.keys(state.days).forEach(function(d){var t=dayTotals(d);if(t&&t.prot>0)arr.push({d:d,p:pEff(t)});});arr.sort(function(a,b){return a.d<b.d?-1:1;});return arr;}
  function renderProteinChart(){
    var host=document.getElementById("proteinChart");if(!host)return;var e=proteinEntries();
    if(e.length<2){host.innerHTML='<div class="empty">Note tes repas au moins 2 jours pour voir la courbe des protéines.</div>';return;}
    var W=320,H=92,pad=8,TARGET=130;
    var vals=e.map(function(x){return x.p;});
    var min=Math.min.apply(null,vals),max=Math.max.apply(null,vals);
    min=Math.min(min,TARGET);max=Math.max(max,TARGET);
    if(max-min<10){max+=5;min-=5;}
    var n=e.length;
    function X(i){return pad+(i/(n-1))*(W-2*pad);}
    function Y(p){return pad+(1-(p-min)/(max-min))*(H-2*pad);}
    var pts=e.map(function(x,i){return X(i).toFixed(1)+","+Y(x.p).toFixed(1);}).join(" ");
    var dots=e.map(function(x,i){return '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(x.p).toFixed(1)+'" r="2.6" fill="'+(x.p>=TARGET?"#34a96a":"#F4622B")+'"/>';}).join("");
    var ty=Y(TARGET).toFixed(1);
    var tline='<line x1="'+pad+'" y1="'+ty+'" x2="'+(W-pad)+'" y2="'+ty+'" stroke="#34a96a" stroke-width="1" stroke-dasharray="4 3" opacity="0.75"/>';
    var avg=vals.reduce(function(s,v){return s+v;},0)/n,hits=vals.filter(function(v){return v>=TARGET;}).length;
    host.innerHTML='<svg viewBox="0 0 '+W+' '+H+'">'+tline+'<polyline fill="none" stroke="#12466B" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="'+pts+'"/>'+dots+'</svg>'+
      '<div class="muted" style="margin-top:8px;font-size:13px">Moyenne <b>'+Math.round(avg)+' g</b> · cible 130 g atteinte <b>'+hits+'/'+n+'</b> jours · <span style="color:#34a96a">– – cible</span></div>';
  }

  /* ---------------- Progrès : bilan hebdo ---------------- */
  function buildWeeklySummary(){
    var today=todayStr();
    var wk=[];for(var i=6;i>=0;i--){wk.push(isoOf(addDays(today,-i)));}
    var sportCount={};SPORTS.forEach(function(s){sportCount[s]=0;});
    var sleeps=[],waters=[],stoolTotal=0,stoolDays=0,typeCount={},progOK=0,progDays=0,wFirst=null,wLast=null;
    wk.forEach(function(d){
      var x=state.days[d];if(!x)return;
      (x.sports||[]).forEach(function(s){if(sportCount[s]!==undefined)sportCount[s]++;});
      var sl=num(x.sleep);if(!isNaN(sl))sleeps.push(sl);
      if(typeof x.water==="number"&&x.water>0)waters.push(x.water);
      var arr=x.stools||[];if(arr.length){stoolDays++;stoolTotal+=arr.length;arr.forEach(function(st){if(st.type)typeCount[st.type]=(typeCount[st.type]||0)+1;});}
      if(x.program){progDays++;if(x.program==="Oui")progOK++;}
      var wv=num(x.weight);if(!isNaN(wv)){if(wFirst===null)wFirst=wv;wLast=wv;}
    });
    function avg(a){if(!a.length)return null;var s=0;a.forEach(function(v){s+=v;});return s/a.length;}
    var domType="",domN=0;Object.keys(typeCount).forEach(function(t){if(typeCount[t]>domN){domN=typeCount[t];domType=t;}});
    var aw=avg(waters),asl=avg(sleeps);
    var L=[];
    L.push("BILAN SEMAINE — "+ddmm(new Date(wk[0]+"T00:00:00"))+" au "+ddmm(new Date(wk[6]+"T00:00:00")));
    L.push("");
    L.push("Muscu : "+sportCount["Muscu"]+" séance(s) cette semaine · "+doneCount()+"/"+totalSessions()+" au total");
    L.push("Triathlon : nat "+sportCount["Natation"]+" · vélo "+sportCount["Vélo"]+" · course "+sportCount["Course"]+" · "+triDoneCount()+"/30 au total");
    if(sportCount["Escalade"])L.push("Escalade : "+sportCount["Escalade"]+" séance(s)");
    L.push(wFirst!==null?("Poids : "+fr1(wLast)+" kg ("+((wLast-wFirst)>=0?"+":"")+fr1(wLast-wFirst)+" kg sur la semaine)"):"Poids : non renseigné");
    L.push("Sommeil moyen : "+(asl?fr1(asl)+" h":"—"));
    L.push("Hydratation : "+(aw?fr1(aw)+" verres/j (~"+fr1(aw*0.25)+" L)":"—"));
    L.push("Transit : "+(stoolDays?(fr1(stoolTotal/stoolDays)+" passage(s)/j"+(domType?", souvent type "+domType:"")):"—"));
    var protArr=[];wk.forEach(function(d){var t=dayTotals(d);if(t&&t.prot>0)protArr.push(pEff(t));});
    var apk=avg(protArr);
    L.push("Protéines (estimé) : "+(apk?(Math.round(apk)+" g/j en moyenne"):"— (à renseigner via les repas)"));
    L.push("");
    L.push("Ressenti de la semaine : (à compléter)");
    L.push("📸 J'ajoute une photo ici si je veux une analyse de progression.");
    return L.join("\n");
  }

  /* ---------------- Progrès : rendu ---------------- */
  function renderGoals(){
    var v=document.getElementById("v-prog2");
    var host=document.getElementById("goalsHost");
    if(!host){host=document.createElement("div");host.id="goalsHost";var h2=v.querySelector("h2.page");v.insertBefore(host,h2.nextSibling);}
    function dtxt(n){return n>0?("J-"+n):(n===0?"Jour J !":"passé");}
    function goal(title,sub,done,total,dleft,go){
      var pct=total?Math.round(done/total*100):0;var remain=Math.max(0,total-done);
      return '<div class="goal goal-click" data-goto="'+go+'">'+
        '<div class="goal-head"><div class="goal-name">'+title+'</div><span class="goal-badge">'+dtxt(dleft)+' ›</span></div>'+
        '<div class="goal-sub">'+sub+'</div>'+
        '<div class="bar"><div class="bar-fill" style="width:'+Math.max(0,Math.min(100,pct))+'%"></div></div>'+
        '<div class="goal-meta"><b>'+pct+'%</b> · '+done+'/'+total+' séances · '+remain+' restante'+(remain>1?"s":"")+'</div>'+
      '</div>';
    }
    host.innerHTML='<div class="card pad"><div class="sec-title">Objectifs</div>'+
      goal("💪 Muscu","Bloc 1 · obj. 27 juil.",blockDone("b1"),PROGRAM_BLOCKS.b1.weeks*CODES.length,daysUntil(MUSCU_DEADLINE),"muscu")+
      goal("🏊 Triathlon","Dinard · 11-13 sept.",triDoneCount(),30,daysUntil(RACE_DATE),"tri")+
    '</div>';
    host.querySelectorAll("[data-goto]").forEach(function(el){el.onclick=function(){var g=el.getAttribute("data-goto");if(g)goSport(g);};});
  }

  function weekVizHTML(){
    var days=[];for(var i=6;i>=0;i--)days.push(isoOf(addDays(todayStr(),-i)));
    var DL=["D","L","M","M","J","V","S"];
    function chart(title,icon,vals,target,unit){
      var max=target;vals.forEach(function(v){if(v.v!=null&&v.v>max)max=v.v;});
      var bars=vals.map(function(v){var h=v.v==null?4:Math.max(6,Math.round(v.v/max*46));var cls=v.v==null?" nv":(v.v>=target?" ok":"");return '<div class="wv-col"><i class="wv-bar'+cls+'" style="height:'+h+'px"></i><span class="wv-d">'+v.d+'</span></div>';}).join("");
      return '<div class="wv-block"><div class="wv-t">'+icon+' '+title+' <span class="wv-target">cible '+target+' '+unit+'</span></div><div class="wv-bars">'+bars+'</div></div>';
    }
    var prot=[],eau=[],som=[];
    days.forEach(function(d){var lab=DL[new Date(d+"T00:00:00").getDay()];var x=state.days[d];
      var t=dayTotals(d);prot.push({d:lab,v:t?Math.round(t.prot):null});
      eau.push({d:lab,v:(x&&x.water)?x.water:null});
      var sl=x?num(x.sleep):NaN;som.push({d:lab,v:isNaN(sl)?null:sl});
    });
    return '<div class="card pad"><div class="sec-title">7 derniers jours</div>'+
      chart("Protéines","🥩",prot,130,"g")+chart("Eau","💧",eau,8,"verres")+chart("Sommeil","😴",som,8,"h")+
      '<div class="wv-note">Barre pleine couleur = cible atteinte · gris clair = pas de donnée.</div></div>';
  }
  /* ---------------- Régularité (streaks habitudes) ---------------- */
  function habitDoneOn(iso){var x=state.days[iso];if(!x)return false;
    if(x.meditation)return true;
    if(x.routines)for(var k in x.routines){if(x.routines[k])return true;}
    if(x.petitsExos)for(var k2 in x.petitsExos){if(x.petitsExos[k2])return true;}
    if((x.routinesX&&x.routinesX.length)||(x.petitsExosX&&x.petitsExosX.length))return true;
    if(x.customRoutines)for(var k3 in x.customRoutines){if(x.customRoutines[k3])return true;}
    return false;}
  function routineDoneOn(id,iso){var x=state.days[iso];return !!(x&&((x.routines&&x.routines[id])||(id==="medit"&&x.meditation)));}
  function pxDoneOn(id,iso){var x=state.days[iso];return !!(x&&x.petitsExos&&x.petitsExos[id]);}
  function refreshDayForm(){var h=document.getElementById("dayLog");if(h&&h.innerHTML)buildDayForm(h,dayDate);}
  function customRoutines(){return Array.isArray(state.customRoutines)?state.customRoutines:[];}
  function crDoneOn(id,iso){var x=state.days[iso];return !!(x&&x.customRoutines&&x.customRoutines[id]);}
  function findCR(id){var l=customRoutines();for(var i=0;i<l.length;i++)if(l[i].id===id)return l[i];return null;}
  function removeCR(id){if(!Array.isArray(state.customRoutines))return;state.customRoutines=state.customRoutines.filter(function(a){return a.id!==id;});Object.keys(state.days).forEach(function(d){var c=state.days[d].customRoutines;if(c&&c[id]!=null)delete c[id];});}
  function currentStreak(pred){var s=0,cur=todayStr(),g=0;if(!pred(cur))cur=isoOf(addDays(cur,-1));while(pred(cur)&&g<400){s++;cur=isoOf(addDays(cur,-1));g++;}return s;}
  function bestStreak(pred){var keys=Object.keys(state.days).filter(function(d){return /^\d{4}-\d{2}-\d{2}$/.test(d);}).sort();if(!keys.length)return 0;var cur=keys[0],end=todayStr(),best=0,run=0,g=0;while(cur<=end&&g<3000){if(pred(cur)){run++;if(run>best)best=run;}else run=0;cur=isoOf(addDays(cur,1));g++;}return best;}
  function pxStats(nDays){
    var L=(typeof PETITS_EXOS!=="undefined"?PETITS_EXOS:[]);
    var since=isoOf(addDays(todayStr(),-(nDays-1))),end=todayStr();
    var per={},tot=0,free=0,dset={};
    L.forEach(function(r){per[r.id]=0;});
    Object.keys(state.days).forEach(function(iso){
      if(iso<since||iso>end)return;
      var x=state.days[iso],n=0;
      if(x&&x.petitsExos)L.forEach(function(r){if(x.petitsExos[r.id]){per[r.id]++;n++;}});
      if(x&&x.petitsExosX&&x.petitsExosX.length){free+=x.petitsExosX.length;n+=x.petitsExosX.length;}
      if(n){tot+=n;dset[iso]=1;}
    });
    var rows=L.map(function(r){return {icon:r.icon,name:r.name,n:per[r.id]};}).filter(function(o){return o.n>0;}).sort(function(a,b){return b.n-a.n;});
    return {rows:rows,tot:tot,free:free,days:Object.keys(dset).length,total:L.length};
  }
  /* ---------------- Progrès : régularité (14 j) ----------------
     UN seul bloc, trois sous-sections repliables (Sport / Routines / Petits exercices).
     Même grille partout : une ligne par item, une case par jour. Le libellé de gauche
     est réduit à son emoji — le nom complet apparaît au survol ou à l'appui long. */
  var SPORT_IC={"Muscu":"\ud83d\udcaa","Course":"\ud83c\udfc3","V\u00e9lo":"\ud83d\udeb4","Natation":"\ud83c\udfca","Escalade":"\ud83e\uddd7"};
  var REG_N=14;
  function regGridHTML(rows,days){
    var today=todayStr();
    var h='<div class="reg-grid"><div class="act-dates">'+days.map(function(d,i){var dt=new Date(d+"T00:00:00");return '<div class="act-date">'+((i%2===0)?String(dt.getDate()):"")+'</div>';}).join("")+'</div>';
    rows.forEach(function(r){
      h+='<div class="act-row"><span class="act-label" title="'+esc(r.name)+'" aria-label="'+esc(r.name)+'">'+esc(r.ic||"\u2022")+'</span>'+
        '<div class="act-cells">'+days.map(function(d){return '<div class="act-cell'+(r.on(d)?" on":"")+(d===today?" today":"")+'"></div>';}).join("")+'</div>'+
        '<span class="act-tag'+(r.hot?" hot":"")+'">'+(r.tag||"")+'</span></div>';
    });
    return h+'</div>';
  }
  function renderRegularity(){
    var host=document.getElementById("regularity");if(!host)return;
    var days=[];for(var i=REG_N-1;i>=0;i--)days.push(isoOf(addDays(todayStr(),-i)));
    var cur=currentStreak(habitDoneOn),best=bestStreak(habitDoneOn);
    function cnt(fn){var c=0;days.forEach(function(d){if(fn(d))c++;});return c;}
    function anyOn(rows){return function(d){for(var i=0;i<rows.length;i++)if(rows[i].on(d))return true;return false;};}
    /* pastille de droite : la série en cours si elle existe, sinon le nombre de jours sur 14 */
    function tag(rows){rows.forEach(function(r){var n=cnt(r.on);r.hot=r.s>0;r.tag=r.s>0?("\ud83d\udd25"+r.s):(n?("\u00d7"+n):"");});return rows;}

    var sportRows=tag(["Muscu","Course","V\u00e9lo","Natation","Escalade"].map(function(sp){
      return {ic:SPORT_IC[sp],name:sp,s:0,on:function(d){var l=(state.days[d]&&state.days[d].sports)||[];return l.indexOf(sp)>-1;}};
    }));
    var routRows=[];
    (typeof ROUTINES!=="undefined"?ROUTINES:[]).forEach(function(r){routRows.push({ic:r.icon,name:r.name,s:currentStreak(function(iso){return routineDoneOn(r.id,iso);}),on:function(d){return routineDoneOn(r.id,d);}});});
    customRoutines().forEach(function(a){routRows.push({ic:a.icon,name:a.label,s:currentStreak(function(iso){return crDoneOn(a.id,iso);}),on:function(d){return crDoneOn(a.id,d);}});});
    tag(routRows);
    var pxRows=tag((typeof PETITS_EXOS!=="undefined"?PETITS_EXOS:[]).map(function(r){
      return {ic:r.icon,name:r.name,s:currentStreak(function(iso){return pxDoneOn(r.id,iso);}),on:function(d){return pxDoneOn(r.id,d);}};
    }));
    var px=pxStats(30);
    function sub(k,ttl,n,inner){return '<div class="reg-sub">'+bndHead(k,"sub",{ttl:ttl,meta:n+"/"+REG_N+" j"})+bndBody(k,"",inner)+'</div>';}

    host.innerHTML='<div class="card pad"><div class="sec-title">R\u00e9gularit\u00e9</div>'+
      '<div class="reg-hero"><span class="reg-flame">\ud83d\udd25</span><span class="reg-n">'+cur+'</span><span class="reg-u">jour'+(cur>1?"s":"")+' d\'affil\u00e9e</span>'+(best>0?'<span class="reg-best">record '+best+' j</span>':'')+'</div>'+
      '<div class="reg-note">La s\u00e9rie court tant qu\'une habitude, un ancrage ou un petit exercice est coch\u00e9 chaque jour. Ci-dessous les 14 derniers jours : case pleine = fait, contour color\u00e9 = aujourd\'hui. Touche un emoji pour lire son nom ; \u00e0 droite, \ud83d\udd25 = s\u00e9rie en cours, \u00d7 = nombre de jours sur 14.</div>'+
      sub("rgS","Sport",cnt(anyOn(sportRows)),regGridHTML(sportRows,days))+
      sub("rgR","Routines &amp; ancrages",cnt(anyOn(routRows)),routRows.length?regGridHTML(routRows,days):'<div class="reg-empty">Aucune routine ni ancrage pour l\'instant : ajoute-les depuis Bien-\u00eatre &amp; suivi.</div>')+
      sub("rgP","Petits exercices",cnt(anyOn(pxRows)),regGridHTML(pxRows,days)+
        (px.tot?('<div class="reg-note"><b>'+px.tot+'</b> coch\u00e9'+(px.tot>1?"s":"")+' sur <b>'+px.days+'</b> jour'+(px.days>1?"s":"")+' en 30 jours \u00b7 '+px.rows.length+'/'+px.total+' exercices pratiqu\u00e9s. Ces gestes de mobilit\u00e9 ne se lisent pas sur la balance, mais ce sont eux qui prot\u00e8gent \u00e9paules et hanches : c\'est ce qui te garde entra\u00eenable jusqu\'\u00e0 Dinard.</div>')
          :'<div class="reg-note">Aucun petit exercice coch\u00e9 sur 30 jours. Deux minutes de mobilit\u00e9 par jour suffisent \u00e0 lancer le compteur.</div>'))+
    '</div>';
  }
  function statPeriodDays(){var per=radarPeriod||30,out={};for(var i=0;i<per;i++)out[isoOf(addDays(todayStr(),-i))]=1;return out;}
  function renderStatGrid(){
    var host=document.getElementById("statGrid");if(!host)return;
    var per=radarPeriod||30,win=statPeriodDays(),lbl=per+" j";
    var sleeps=[],meditDays=0,sportTally={},stoolDays=0,stoolTotal=0,typeCount={},waters=[],protList=[],bals=[];
    Object.keys(state.days).forEach(function(d){
      if(!win[d])return;
      var x=state.days[d];
      var sl=num(x.sleep);if(!isNaN(sl))sleeps.push(sl);
      if(x.meditation)meditDays++;
      (x.sports||[]).forEach(function(sp){sportTally[sp]=(sportTally[sp]||0)+1;});
      var arr=x.stools||[];if(arr.length){stoolDays++;stoolTotal+=arr.length;arr.forEach(function(st){if(st.type)typeCount[st.type]=(typeCount[st.type]||0)+1;});}
      if(typeof x.water==="number"&&x.water>0)waters.push(x.water);
      var t=dayTotals(d);if(t&&t.prot>0)protList.push(t.prot);
      var e=expend(d);if(e!=null)bals.push(adjIntake(d)-e);
    });
    function avg(a){if(!a.length)return null;var t=0;a.forEach(function(v){t+=v;});return t/a.length;}
    var avgSleep=avg(sleeps),waterAvg=avg(waters),stoolAvg=stoolDays?(stoolTotal/stoolDays):null,protAvg=avg(protList),balAvg=avg(bals);
    var domType="",domN=0;Object.keys(typeCount).forEach(function(t){if(typeCount[t]>domN){domN=typeCount[t];domType=t;}});
    var topSports=Object.keys(sportTally).sort(function(a,b){return sportTally[b]-sportTally[a];}).slice(0,3).map(function(k){return k+" ("+sportTally[k]+")";}).join(", ")||"—";
    var mus=0;Object.keys(state.sessions||{}).forEach(function(k){var r=state.sessions[k];if(r&&r.done&&win[r.date])mus++;});
    var tri=0;Object.keys(state.tri||{}).forEach(function(k){var r=state.tri[k];if(r&&r.done&&win[r.date])tri++;});
    var we=weightEntries().filter(function(o){return win[o.d];}),kgWeek=null;
    if(we.length>=2){var sp2=(new Date(we[we.length-1].d+"T00:00:00")-new Date(we[0].d+"T00:00:00"))/86400000;if(sp2>=1)kgWeek=(we[we.length-1].w-we[0].w)/(sp2/7);}
    var protStatus=protAvg==null?"":(protAvg>=130?" · ✓":" · ↓ "+Math.round(130-protAvg)+" g");
    var wStatus=kgWeek==null?"":(kgWeek<0.2?" · sous la cible":(kgWeek>0.3?" · au-dessus":" · ✓"));
    var U='<span style="font-size:15px;color:var(--muted)">';
    host.innerHTML=
      '<div class="stat st-go" data-ax="Sport"><div class="v">'+mus+'</div><div class="k">Séances muscu · '+lbl+'</div></div>'+
      '<div class="stat st-go" data-ax="Sport"><div class="v">'+tri+'</div><div class="k">Séances triathlon · '+lbl+'</div></div>'+
      '<div class="stat st-go" data-ax="Protéines"><div class="v">'+(protAvg!=null?Math.round(protAvg):'—')+(protAvg!=null?U+' g</span>':'')+'</div><div class="k">Protéines / j · cible 130-150'+protStatus+'</div></div>'+
      '<div class="stat"><div class="v">'+(kgWeek!=null?((kgWeek>=0?'+':'')+fr1(kgWeek)):'—')+(kgWeek!=null?U+' kg/sem</span>':'')+'</div><div class="k">Prise de poids · cible +0,2-0,3'+wStatus+'</div></div>'+
      '<div class="stat st-go" data-ax="Bilan kcal"><div class="v">'+(balAvg!=null?((balAvg>=0?'+':'')+Math.round(balAvg)):'—')+(balAvg!=null?U+' kcal</span>':'')+'</div><div class="k">Bilan moyen / j · '+lbl+'</div></div>'+
      '<div class="stat st-go" data-ax="Sommeil"><div class="v">'+(avgSleep?fr1(avgSleep):'—')+U+' h</span></div><div class="k">Sommeil moyen / nuit</div></div>'+
      '<div class="stat st-go" data-ax="Eau"><div class="v">'+(waterAvg?fr1(waterAvg):'—')+'</div><div class="k">Eau / jour (verres)</div></div>'+
      '<div class="stat"><div class="v">'+meditDays+'</div><div class="k">Jours de méditation · '+lbl+'</div></div>'+
      '<div class="stat"><div class="v" style="font-size:15px;line-height:1.3;padding-top:4px">'+topSports+'</div><div class="k">Sports les plus loggés</div></div>'+
      '<div class="stat"><div class="v">'+(stoolAvg?fr1(stoolAvg):'—')+'</div><div class="k">Selles / jour'+(domType?' · souvent type '+domType:'')+'</div></div>';
  }
  function renderProgress(){
    renderGoals();
    var wv=document.getElementById("weekViz");if(wv)wv.innerHTML=weekVizHTML();
    renderRegularity();
    renderProgressRadar();
    renderStatGrid();

    renderWeightChart();
    renderProteinChart();
    document.getElementById("bilanText").value=buildWeeklySummary();
  }

  /* Export / import / remise à zéro : un seul système, dans Réglages ▸ Données.
     (exportData/importData ont été retirés : format incompatible avec exportBackup,
      pas de confirmation à l'import, et le planning partagé n'était pas sauvegardé.) */

  /* ---------------- Menu lanceur d'apps ---------------- */
  function renderApps(){
    var host=document.getElementById("appList");if(!host||typeof APPS==="undefined")return;
    host.innerHTML=APPS.map(function(a){
      var ic='<span class="app-ic">'+esc(a.icon||(a.name||"?").charAt(0))+'</span>';
      var nm='<span class="app-name">'+esc(a.name)+'</span>';
      if(a.here)return '<div class="app-item here">'+ic+nm+'</div>';
      if(a.ready&&a.url)return '<a class="app-item" href="'+esc(a.url)+'">'+ic+nm+'<span class="app-arrow">›</span></a>';
      return '<div class="app-item soon">'+ic+nm+'<span class="app-badge">bientôt</span></div>';
    }).join("");
  }
  function openDrawer(){
    var d=document.getElementById("drawer"),bg=document.getElementById("drawerBg"),btn=document.getElementById("menuBtn");
    if(!d||!bg)return;bg.hidden=false;d.hidden=false;
    requestAnimationFrame(function(){bg.classList.add("open");d.classList.add("open");});
    if(btn)btn.setAttribute("aria-expanded","true");
  }
  function closeDrawer(){
    var d=document.getElementById("drawer"),bg=document.getElementById("drawerBg"),btn=document.getElementById("menuBtn");
    if(!d||!bg)return;bg.classList.remove("open");d.classList.remove("open");
    if(btn)btn.setAttribute("aria-expanded","false");
    setTimeout(function(){bg.hidden=true;d.hidden=true;},240);
  }

  /* ---------------- Agenda / Calendrier ---------------- */
  var MOIS_LONG=["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  var MOIS_AB=["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
  var DOW_KEYS=["dim","lun","mar","mer","jeu","ven","sam"];
  var calRef={y:(new Date()).getFullYear(),m:(new Date()).getMonth()};

  function dateMs(iso){return new Date(iso+"T00:00:00").getTime();}
  function diffDays(a,b){return Math.round((dateMs(a)-dateMs(b))/86400000);}
  function frDateShort(iso){var d=new Date(iso+"T00:00:00");return d.getDate()+" "+MOIS_AB[d.getMonth()];}

  function muscuInfoForDate(iso){
    var dd=diffDays(iso,MUSCU_START);if(dd<0)return null;
    var wIdx=Math.floor(dd/7),tot=0;BLOCK_ORDER.forEach(function(b){tot+=PROGRAM_BLOCKS[b].weeks;});
    if(wIdx>=tot)return null;
    var rem=wIdx,block=null,w=0;
    for(var i=0;i<BLOCK_ORDER.length;i++){var b=BLOCK_ORDER[i],wk=PROGRAM_BLOCKS[b].weeks;if(rem<wk){block=b;w=rem+1;break;}rem-=wk;}
    return {block:block,w:w};
  }
  function triInfoForDate(iso){var dd=diffDays(iso,TRI_START);if(dd<0)return null;var wIdx=Math.floor(dd/7);if(wIdx>=TRI.length)return null;return {w:wIdx+1};}
  function triLabel(disc){for(var i=0;i<TRI_DISC.length;i++)if(TRI_DISC[i][0]===disc)return TRI_DISC[i][1];return disc;}
  function triIcon(disc){return disc==="nat"?"🏊":disc==="velo"?"🚴":disc==="course"?"🏃":"•";}

  function plannedForDate(iso){
    if(typeof TRAIN_TEMPLATE==="undefined")return null;
    var slot=TRAIN_TEMPLATE[DOW_KEYS[new Date(iso+"T00:00:00").getDay()]];
    if(!slot)return null;
    if(slot.type==="muscu"){var mi=muscuInfoForDate(iso);if(!mi)return null;return {kind:"muscu",abbr:slot.code,label:"Muscu "+slot.code,icon:"💪",done:sess(mi.block,mi.w,slot.code).done};}
    if(slot.type==="tri"){var ti=triInfoForDate(iso);if(!ti)return null;var r=state.tri[ti.w+"_"+slot.disc];return {kind:"tri",abbr:triLabel(slot.disc),label:triLabel(slot.disc),icon:triIcon(slot.disc),done:!!(r&&r.done)};}
    return null;
  }
  function dayTypeOf(id){var L=(typeof DAY_TYPES!=="undefined"?DAY_TYPES:[]);for(var i=0;i<L.length;i++)if(L[i].id===(id||""))return L[i];return null;}
  function dayBlocked(iso){var t=dayTypeOf(getDayState(iso));return !!(t&&t.train===false);}

  /* Planification PROGRESSIVE : on ne fige pas les séances sur des dates.
     On enchaîne ce qui RESTE à faire à partir d'aujourd'hui, et on "remonte"
     ce qui est DÉJÀ fait sur les jours d'entraînement passés (le plus récent
     près d'aujourd'hui). Les jours bloqués sont sautés (la séance glisse au
     prochain jour dispo). Le repère devient ainsi ta progression réelle. */
  var schedCache=null;
  /* ---------- Config des activités (propre à cette app, valeurs par défaut depuis les constantes) ---------- */
  function cfgActs(){
    if(!state.config)state.config={};
    if(!state.config.activities)state.config.activities={};
    var a=state.config.activities;
    if(!a.muscu)a.muscu={enabled:true,start:MUSCU_START,name:"Musculation",desc:""};
    if(!a.tri)a.tri={enabled:true,start:TRI_START,name:"Triathlon Dinard",desc:""};
    return a;
  }
  function actEnabled(k){return cfgActs()[k].enabled!==false;}
  function actStart(k){return cfgActs()[k].start||(k==="muscu"?MUSCU_START:TRI_START);}
  function actName(k){return cfgActs()[k].name||(k==="muscu"?"Musculation":"Triathlon");}
  function setAct(k,patch){var a=cfgActs()[k];for(var p in patch)if(patch.hasOwnProperty(p))a[p]=patch[p];save();}

  function muscuSeqAll(){if(!actEnabled("muscu"))return [];var s=[];BLOCK_ORDER.forEach(function(b){var wks=PROGRAM_BLOCKS[b].weeks;for(var w=1;w<=wks;w++){CODES.forEach(function(c){s.push({kind:"muscu",block:b,w:w,code:c});});}});return s;}
  function triSeqAll(){if(!actEnabled("tri"))return [];var s=[];for(var i=0;i<TRI.length;i++){var ww=TRI[i].w;TRI_DISC.forEach(function(p){s.push({kind:"tri",w:ww,disc:p[0]});});}return s;}
  function labelize(s){if(s.kind==="muscu"){var m=sess(s.block,s.w,s.code);s.abbr=s.code;s.label="Muscu "+s.code;s.icon="💪";s.done=m.done;s.date=m.date||null;}else{var r=state.tri[s.w+"_"+s.disc];s.abbr=triLabel(s.disc);s.label=triLabel(s.disc);s.icon=triIcon(s.disc);s.done=!!(r&&r.done);s.date=(r&&r.date)||null;}return s;}
  function trackOf(iso){if(typeof TRAIN_TEMPLATE==="undefined")return null;var slot=TRAIN_TEMPLATE[DOW_KEYS[new Date(iso+"T00:00:00").getDay()]];return slot?slot.type:null;}
  function buildSchedule(){
    var map={},today=todayStr();
    var M={done:[],nodate:[],todo:[]},T={done:[],nodate:[],todo:[]};
    muscuSeqAll().forEach(function(s){labelize(s);if(s.done){(s.date?M.done:M.nodate).push(s);}else M.todo.push(s);});
    triSeqAll().forEach(function(s){labelize(s);if(s.done){(s.date?T.done:T.nodate).push(s);}else T.todo.push(s);});
    function place(iso,s){if(!map[iso])map[iso]=[];map[iso].push(s);}
    // 1) Séances faites AVEC date enregistrée → sur leur date réelle
    M.done.forEach(function(s){place(s.date,s);});
    T.done.forEach(function(s){place(s.date,s);});
    // 2) Séances à venir → en avant depuis aujourd'hui, sur les jours d'entraînement libres
    var mi=0,ti=0,cur=today,g=0;
    while((mi<M.todo.length||ti<T.todo.length)&&g<420){g++;
      if(!dayBlocked(cur)&&!map[cur]){var tr=trackOf(cur);if(tr==="muscu"&&mi<M.todo.length&&cur>=actStart("muscu"))place(cur,M.todo[mi++]);else if(tr==="tri"&&ti<T.todo.length&&cur>=actStart("tri"))place(cur,T.todo[ti++]);}
      cur=isoOf(addDays(cur,1));
    }
    // 3) Séances faites SANS date (héritage) → à rebours depuis hier, comme repli
    var md=M.nodate.length-1,tdi=T.nodate.length-1,back=isoOf(addDays(today,-1));g=0;
    while((md>=0||tdi>=0)&&g<420){g++;
      if(!dayBlocked(back)&&!map[back]){var tr2=trackOf(back);if(tr2==="muscu"&&md>=0)place(back,M.nodate[md--]);else if(tr2==="tri"&&tdi>=0)place(back,T.nodate[tdi--]);}
      back=isoOf(addDays(back,-1));
    }
    return map;
  }
  function rebuildSchedule(){schedCache=buildSchedule();}
  function sessionsOn(iso){return (schedCache&&schedCache[iso])||[];}
  function calGoMonth(delta){calRef.m+=delta;while(calRef.m<0){calRef.m+=12;calRef.y--;}while(calRef.m>11){calRef.m-=12;calRef.y++;}renderCalendars();}
  function calGoToday(){var n=new Date();calRef={y:n.getFullYear(),m:n.getMonth()};renderCalendars();}

  function startOfWeekMonday(d){var dow=d.getDay();var diff=(dow===0?-6:1-dow);var n=new Date(d);n.setDate(d.getDate()+diff);return n;}

  function legendHTML(){
    return '<div class="cal-leg"><span>🏋️ '+esc(actName("muscu"))+'</span><span>🏊🚴🏃 '+esc(actName("tri"))+'</span><span>📚 Révision</span><span><i class="lg ev-dot"></i>Événement</span><span class="lg-note">Séance faite = grisée + ✓ · touche un jour pour changer son état</span></div>';
  }
  function monthGridHTML(y,m){
    var first=new Date(y,m,1),last=new Date(y,m+1,0);
    var _rd=dscgDone(),_rdToday=todayStr();
    var cur=startOfWeekMonday(first);
    var lastEnd=startOfWeekMonday(last);lastEnd.setDate(lastEnd.getDate()+6);
    var today=todayStr();
    var dlMap={};pDeadlines().forEach(function(dl){dlMap[dl.date]=dl;});
    var html='<div class="cal"><div class="cal-dows"><div>L</div><div>M</div><div>M</div><div>J</div><div>V</div><div>S</div><div>D</div></div>';
    var guard=0;
    while(cur<=lastEnd&&guard<8){
      guard++;
      html+='<div class="cal-week">';
      for(var i=0;i<7;i++){
        var dd=new Date(cur);dd.setDate(cur.getDate()+i);var iso=isoOf(dd);
        var o=new Date(iso+"T00:00:00"),inMonth=(o.getMonth()===m),st=getDayState(iso),dl=dlMap[iso],evs=eventsOn(iso);
        var cls="cal-day";if(!inMonth)cls+=" off";if(iso===today)cls+=" today";if(st)cls+=" st-"+st;if(dl)cls+=" deadline";
        var pills=sessionsOn(iso).map(function(p){var ic=(p.kind==="muscu")?"🏋️":triIcon(p.disc);var ab=(p.kind==="muscu")?p.abbr:"";return '<span class="pill '+(p.kind==="muscu"?"p-muscu":"p-tri")+(p.done?" done":"")+'"><span class="pill-ic">'+ic+'</span>'+(ab?'<span class="pill-ab">'+esc(ab)+'</span>':'')+(p.done?'<span class="pill-ck">✓</span>':'')+'</span>';}).join("");
        var book="";
        if(dateMs(iso)<=dateMs(_rdToday)){var _rh=_rd.hasOwnProperty(iso)?_rd[iso]:null;if(_rh>0)book='<span class="cal-book" title="'+nFmt(_rh)+' h révisées">📚</span>';}
        else if(studyHoursOf(iso)>=6)book='<span class="cal-book" title="Grosse journée de révision (prévu)">📚</span>';
        var marks=(dl?'<span class="cal-dl" title="'+esc(dl.label)+'">'+(dl.icon||"🎯")+'</span>':'')+(evs.length?'<span class="ev-dot" title="'+esc(evs.map(function(e){return e.label;}).join(" · "))+'"></span>':'')+book;
        html+='<button class="'+cls+'" data-iso="'+iso+'"><span class="cal-n">'+o.getDate()+(marks?'<span class="cal-marks">'+marks+'</span>':'')+'</span><span class="cal-pills">'+pills+'</span></button>';
      }
      html+='</div>';
      cur.setDate(cur.getDate()+7);
    }
    return html+'</div>';
  }
  function monthEventsHTML(y,m){
    var ms=isoOf(new Date(y,m,1)),me=isoOf(new Date(y,m+1,0));
    var evs=pEvents().filter(function(e){var s=e.start,en=e.end||e.start;return (s>=ms&&s<=me)||(en>=ms&&en<=me)||(s<ms&&en>me);}).sort(function(a,b){return a.start<b.start?-1:1;});
    if(!evs.length)return "";
    return '<div class="calevents"><div class="sec-mini">Événements du mois</div>'+evs.map(function(e){var d=frDateShort(e.start)+(e.end&&e.end!==e.start?" → "+frDateShort(e.end):"");return '<div class="calev-row"><span class="calev-d">'+esc(d)+'</span><span class="calev-l">'+esc(e.label)+'</span></div>';}).join("")+'</div>';
  }
  function renderCalendarInto(host){
    if(!host)return;
    host.innerHTML='<div class="calwrap-inner">'+
      '<div class="calbar"><button class="navbtn calPrev" aria-label="Mois précédent">‹</button><div class="calmonth">'+MOIS_LONG[calRef.m]+' '+calRef.y+'</div><button class="navbtn calNext" aria-label="Mois suivant">›</button></div>'+
      '<div class="calhead"><button class="btn ghost calToday">Aujourd\'hui</button></div>'+
      monthGridHTML(calRef.y,calRef.m)+monthEventsHTML(calRef.y,calRef.m)+legendHTML()+'</div>';
    host.querySelectorAll(".cal-day").forEach(function(b){b.onclick=function(){openDaySheet(b.getAttribute("data-iso"));};});
    var pv=host.querySelector(".calPrev");if(pv)pv.onclick=function(){calGoMonth(-1);};
    var nx=host.querySelector(".calNext");if(nx)nx.onclick=function(){calGoMonth(1);};
    var td=host.querySelector(".calToday");if(td)td.onclick=calGoToday;
    bindSwipe(host);
  }
  /* Glissement au doigt : vers la droite = mois suivant, vers la gauche = mois précédent.
     Attaché une seule fois par conteneur (le div hôte n'est pas recréé, seul son contenu l'est). */
  function bindSwipe(host){
    if(host._swipeBound)return;host._swipeBound=true;
    var sx=null,sy=null;
    host.addEventListener("touchstart",function(e){var t=e.changedTouches[0];sx=t.clientX;sy=t.clientY;},{passive:true});
    host.addEventListener("touchend",function(e){if(sx===null)return;var t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;sx=null;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.4)calGoMonth(dx>0?-1:1);},{passive:true});
  }
  function calSummary(){
    var list=sessionsOn(todayStr());
    var plan=list.length?list.map(function(p){return (p.kind==="muscu"?"🏋️":triIcon(p.disc))+(p.kind==="muscu"?" "+p.abbr:"");}).join(" · "):"rien de prévu";
    return "aujourd'hui : "+plan;
  }
  function renderCalendars(){
    rebuildSchedule();
    var h=document.getElementById("homeCal");if(h){renderCalendarInto(h);h.classList.toggle("collapsed",!bndOpen.homecal);}
    var tg=document.getElementById("homeCalToggle");if(tg)tg.classList.toggle("open",bndOpen.homecal);
    var sum=document.getElementById("homeCalSummary");if(sum)sum.textContent=calSummary();
  }

  function openDaySheet(iso){
    var sheet=document.getElementById("calSheet"),bg=document.getElementById("calSheetBg");if(!sheet||!bg)return;
    var curSt=getDayState(iso);
    var plist=sessionsOn(iso);
    var planTxt=plist.length?plist.map(function(p){return p.icon+" "+p.label+(p.done?" ✓":"");}).join(" · "):"Aucune séance prévue ce jour";
    var revTxt="";
    if(dateMs(iso)<=dateMs(todayStr())){var _rd2=dscgDone();if(_rd2.hasOwnProperty(iso)){var _h=_rd2[iso];revTxt=' · 📚 '+nFmt(_h)+' h révisée'+(_h>=2?'s':'');}}
    sheet.innerHTML='<div class="sheet-handle"></div><div class="sheet-title">'+esc(frDateFull(iso))+'</div><div class="sheet-sub">'+esc(planTxt)+revTxt+'</div>'+
      '<div class="sheet-states">'+(typeof DAY_TYPES!=="undefined"?DAY_TYPES:[]).map(function(s){var on=curSt===s.id;return '<button class="st-btn st-'+(s.id||"normal")+(on?" on":"")+'" data-st="'+s.id+'">'+(s.icon?esc(s.icon)+' ':'')+esc(s.label)+'</button>';}).join("")+'</div>'+
      '<button class="sheet-link" data-go="'+iso+'">Ouvrir ce jour dans le Journal →</button>'+
      '<button class="sheet-close" id="sheetCloseBtn">Fermer</button>';
    bg.hidden=false;sheet.hidden=false;
    requestAnimationFrame(function(){bg.classList.add("open");sheet.classList.add("open");});
    sheet.querySelectorAll(".st-btn").forEach(function(b){b.addEventListener("click",function(){setDayState(iso,b.getAttribute("data-st"));renderCalendars();closeDaySheet();});});
    var go=sheet.querySelector(".sheet-link");if(go)go.addEventListener("click",function(){dayDate=iso;closeDaySheet();activateTab("v-day");});
    var cl=document.getElementById("sheetCloseBtn");if(cl)cl.addEventListener("click",closeDaySheet);
  }
  function closeDaySheet(){var sheet=document.getElementById("calSheet"),bg=document.getElementById("calSheetBg");if(!sheet||!bg)return;bg.classList.remove("open");sheet.classList.remove("open");setTimeout(function(){bg.hidden=true;sheet.hidden=true;},240);}

  /* ---------------- Réglages (Paramétrage) ---------------- */
  var settingsEdit=null;  /* id d'échéance en édition, "new" pour ajout, ou null */
  function dlYear(iso){return new Date(iso+"T00:00:00").getFullYear();}
  function deadlineForm(d){
    var isNew=!d;
    return '<div class="set-form" data-form="'+(isNew?"new":d.id)+'">'+
      '<div class="set-form-row"><input class="set-f-icon" maxlength="3" value="'+(d?esc(d.icon||"🎯"):"🎯")+'" aria-label="Emoji"><input class="set-f-label" placeholder="Nom de l\'échéance" value="'+(d?esc(d.label):"")+'"></div>'+
      '<input type="date" class="set-f-date" value="'+(d?esc(d.date):"")+'">'+
      '<div class="set-form-btns"><button class="btn set-f-save">Enregistrer</button><button class="btn ghost set-f-cancel">Annuler</button></div>'+
    '</div>';
  }
  function wireDeadlineForm(){
    var f=document.querySelector("#settingsBody .set-form");if(!f)return;
    var id=f.getAttribute("data-form");
    f.querySelector(".set-f-cancel").onclick=function(){settingsEdit=null;renderSettings();};
    f.querySelector(".set-f-save").onclick=function(){
      var label=(f.querySelector(".set-f-label").value||"").trim();
      var date=(f.querySelector(".set-f-date").value||"").trim();
      var icon=(f.querySelector(".set-f-icon").value||"").trim()||"🎯";
      if(!label||!date){alert("Indique un nom et une date.");return;}
      if(id==="new")pAddDeadline({label:label,date:date,icon:icon});else pUpdateDeadline(id,{label:label,date:date,icon:icon});
      settingsEdit=null;renderSettings();renderCalendars();
    };
  }
  var settingsActEdit=null;  /* clé d'activité en édition ("muscu"/"tri"), ou null */
  var ACT_META={muscu:{icon:"💪"},tri:{icon:"🏊"}};
  function actToggle(k,on){return '<button class="tgl'+(on?" on":"")+'" data-tgl="'+k+'" role="switch" aria-checked="'+(on?"true":"false")+'"><span class="tgl-dot"></span></button>';}
  function actForm(k){var a=cfgActs()[k];return '<div class="act-form">'+
    '<label class="act-flabel">Nom</label><input class="act-f-name" value="'+esc(a.name||"")+'">'+
    '<label class="act-flabel">Début du programme</label><input type="date" class="act-f-start" value="'+esc(actStart(k))+'">'+
    '<label class="act-flabel">Description (optionnel)</label><textarea class="act-f-desc" rows="2" placeholder="ex. objectif, type de programme…">'+esc(a.desc||"")+'</textarea>'+
    '<div class="set-form-btns"><button class="btn act-f-save">Enregistrer</button><button class="btn ghost act-f-cancel">Annuler</button></div>'+
  '</div>';}
  function actCard(k){var a=cfgActs()[k],on=a.enabled!==false,ic=(ACT_META[k]||{}).icon||"•";
    var head='<div class="act-head"><span class="act-ic">'+ic+'</span><span class="act-name">'+esc(a.name||"")+'</span>'+actToggle(k,on)+'</div>';
    var body="";
    if(settingsActEdit===k)body='<div class="act-body">'+actForm(k)+'</div>';
    else if(on)body='<div class="act-body"><div class="act-line"><span class="act-k">Début</span><span class="act-v">'+esc(frDateShort(actStart(k)))+' '+dlYear(actStart(k))+'</span></div>'+(a.desc?'<div class="act-desc">'+esc(a.desc)+'</div>':'')+'<button class="btn ghost act-edit" data-actedit="'+k+'">Modifier</button></div>';
    return '<div class="act-card'+(on?"":" off")+'">'+head+body+'</div>';
  }
  function wireActForm(){
    var f=document.querySelector("#settingsBody .act-form");if(!f)return;
    f.querySelector(".act-f-cancel").onclick=function(){settingsActEdit=null;renderSettings();};
    f.querySelector(".act-f-save").onclick=function(){
      var k=settingsActEdit;if(!k)return;
      var name=(f.querySelector(".act-f-name").value||"").trim()||actName(k);
      var start=(f.querySelector(".act-f-start").value||"").trim()||actStart(k);
      var desc=(f.querySelector(".act-f-desc").value||"").trim();
      setAct(k,{name:name,start:start,desc:desc});settingsActEdit=null;renderSettings();renderCalendars();
    };
  }
  var settingsSessSel=null;  /* "b1_A" en édition, ou null */
  var settingsFoodSel=null;  /* clé (nom minuscule) d'aliment en correction, ou null */
  var settingsFoodNew=false; /* formulaire "Ajouter un aliment" ouvert */
  var settingsFoodOpen=false; /* section Aliments & unités repliée par défaut */
  var settingsFoodQuery=""; /* filtre de recherche de la liste d'aliments */
   var settingsQualSel=null, settingsQualOpen=false, settingsQualQuery=""; /* editeur Qualite des aliments */
  var settingsSecOpen={};  /* rubriques Réglages repliées par défaut (par id) */
  var settingsGrpOpen={};  /* groupes Réglages (titres) repliés par défaut (par id) */ 
  function settingsSec(id,title,inner,open){return '<div class="set-sec"><button type="button" class="bnd bnd-flat set-sectog'+(open?" open":"")+'" data-sec="'+id+'"><span class="set-sec-h">'+title+'</span><span class="bnd-chev">▾</span></button>'+(open?'<div class="set-secbody">'+inner+'</div>':"")+'</div>';}
  function settingsGroup(id,title,inner,open){return '<div class="set-grp'+(open?" open":"")+'"><button type="button" class="bnd bnd-band set-grptog'+(open?" open":"")+'" data-grp="'+id+'"><span class="set-grp-h">'+title+'</span><span class="bnd-chev">▾</span></button>'+(open?'<div class="set-grpbody">'+inner+'</div>':"")+'</div>';} 
  function sessExoRow(ex,i){
    return '<div class="sx-row"><div class="sx-line"><input class="sx-name" data-i="'+i+'" value="'+esc(ex.name||"")+'" placeholder="Nom de l\'exercice"><button class="sx-del" data-i="'+i+'" aria-label="Supprimer">×</button></div>'+
      '<div class="sx-line2"><input class="sx-target" data-i="'+i+'" value="'+esc(ex.target||"")+'" placeholder="ex. 4 × 8-10"><label class="sx-setslbl">séries <input type="number" min="1" max="12" class="sx-sets" data-i="'+i+'" value="'+(ex.sets||3)+'"></label></div></div>';
  }
  function renderSessEditor(host){
    var parts=settingsSessSel.split("_"),b=parts[0],c=parts[1];
    var p=progOf(b,c),custom=progIsCustom(b,c),exos=p.exos||[];
    host.innerHTML='<button class="btn ghost sess-back" id="sessBack">‹ Toutes les séances</button>'+
      '<div class="set-sec"><div class="set-sec-h">'+esc(PROGRAM_BLOCKS[b].short)+' · Séance '+c+(custom?' <span class="sess-badge">modifiée</span>':'')+'</div>'+
      '<label class="act-flabel">Nom de la séance</label><input class="sess-title" value="'+esc(p.title||"")+'">'+
      '<div class="act-flabel" style="margin-top:16px">Exercices</div>'+
      '<div class="sess-exos">'+exos.map(sessExoRow).join("")+'</div>'+
      '<button class="btn ghost sess-add" id="sessAddExo">+ Ajouter un exercice</button>'+
      '<button class="btn ghost sess-reset" id="sessReset">↺ Rétablir le contenu par défaut</button>'+
      '</div>';
    document.getElementById("sessBack").onclick=function(){settingsSessSel=null;renderSettings();};
    var ti=host.querySelector(".sess-title");if(ti)ti.addEventListener("input",function(){progOverride(b,c).title=ti.value;save();});
    host.querySelectorAll(".sx-name").forEach(function(inp){inp.addEventListener("input",function(){progOverride(b,c).exos[+inp.getAttribute("data-i")].name=inp.value;save();});});
    host.querySelectorAll(".sx-target").forEach(function(inp){inp.addEventListener("input",function(){progOverride(b,c).exos[+inp.getAttribute("data-i")].target=inp.value;save();});});
    host.querySelectorAll(".sx-sets").forEach(function(inp){inp.addEventListener("input",function(){var n=parseInt(inp.value,10);if(isNaN(n)||n<1)n=1;if(n>12)n=12;progOverride(b,c).exos[+inp.getAttribute("data-i")].sets=n;save();});});
    host.querySelectorAll(".sx-del").forEach(function(bt){bt.addEventListener("click",function(){progOverride(b,c).exos.splice(+bt.getAttribute("data-i"),1);save();renderSettings();});});
    document.getElementById("sessAddExo").onclick=function(){progOverride(b,c).exos.push({id:"u"+Date.now().toString(36),name:"",target:"3 × 10",sets:3,unit:"reps",help:""});save();renderSettings();var ni=host.querySelector(".sx-row:last-of-type .sx-name");if(ni)ni.focus();};
    var sr=document.getElementById("sessReset");if(sr)sr.onclick=function(){if(confirm("Rétablir la séance par défaut ? Les modifications de cette séance seront perdues.")){progReset(b,c);renderSettings();}};
  }
  function thresholdsGet(){if(!state.thresholds)state.thresholds={};return state.thresholds;}
  function fmtPace(mpk){if(!isFinite(mpk)||mpk<=0)return "\u2014";var m=Math.floor(mpk),s=Math.round((mpk-m)*60);if(s===60){m++;s=0;}return m+":"+(s<10?"0":"")+s;}
  var Z_COURSE=[["Endurance fondamentale",0.65,0.75,"sorties longues, r\u00e9cup\u00e9ration"],["Endurance active",0.75,0.85,"allure longue / marathon"],["Seuil (tempo)",0.85,0.90,"soutenu, ~semi"],["Seuil haut",0.90,0.95,"allure ~10 km"],["VO2max / VMA",0.95,1.05,"fractionn\u00e9 court"]];
  var Z_VELO=[["Z1 R\u00e9cup\u00e9ration",0,0.55,"tr\u00e8s facile"],["Z2 Endurance",0.56,0.75,"sorties longues"],["Z3 Tempo",0.76,0.90,"soutenu"],["Z4 Seuil (FTP)",0.91,1.05,"~1 h max"],["Z5 VO2max",1.06,1.20,"efforts courts"]];
  var Z_FC=[["Z1 \u00c9chauffement",0.50,0.60,"tr\u00e8s facile"],["Z2 Endurance",0.60,0.70,"aisance respiratoire"],["Z3 Tempo",0.70,0.80,"conversation difficile"],["Z4 Seuil",0.80,0.90,"dur mais soutenable"],["Z5 Max",0.90,1.00,"tr\u00e8s intense"]];
  function znTable(title,rows){return '<div class="zn-block"><div class="zn-h">'+title+'</div><div class="zn-table">'+rows+'</div></div>';}
  function zonesHTML(t){
    var vma=num(t.vma),fc=num(t.fcmax),ftp=num(t.ftp),out="";
    if(!isNaN(vma)&&vma>0){
      out+='<div class="zn-vo2">VO2max estim\u00e9e \u2248 <b>'+fr1(vma*3.5)+'</b> ml/kg/min <span class="zn-mut">(VMA \u00d7 3,5)</span></div>';
      var r=Z_COURSE.map(function(z){var pf=60/(vma*z[2]),ps=60/(vma*z[1]);return '<div class="zn-row"><span class="zn-n">'+z[0]+'</span><span class="zn-v">'+fmtPace(pf)+'\u2013'+fmtPace(ps)+' /km</span><span class="zn-d">'+z[3]+'</span></div>';}).join("");
      out+=znTable("\ud83c\udfc3 Allures course \u00b7 % VMA ("+fr1(vma)+" km/h)",r);
    }else out+='<div class="zn-hint">\ud83c\udfc3 Renseigne ta <b>VMA</b> pour voir tes allures de course et ta VO2max estim\u00e9e.</div>';
    if(!isNaN(ftp)&&ftp>0){
      var r2=Z_VELO.map(function(z){var lo=Math.round(ftp*z[1]),hi=Math.round(ftp*z[2]);var rng=z[1]<=0?("< "+hi+" W"):(lo+"\u2013"+hi+" W");return '<div class="zn-row"><span class="zn-n">'+z[0]+'</span><span class="zn-v">'+rng+'</span><span class="zn-d">'+z[3]+'</span></div>';}).join("");
      out+=znTable("\ud83d\udeb4 Puissance v\u00e9lo \u00b7 % FTP ("+Math.round(ftp)+" W)",r2);
    }else out+='<div class="zn-hint">\ud83d\udeb4 Renseigne ton <b>FTP</b> pour voir tes zones de puissance.</div>';
    if(!isNaN(fc)&&fc>0){
      var r3=Z_FC.map(function(z){return '<div class="zn-row"><span class="zn-n">'+z[0]+'</span><span class="zn-v">'+Math.round(fc*z[1])+'\u2013'+Math.round(fc*z[2])+' bpm</span><span class="zn-d">'+z[3]+'</span></div>';}).join("");
      out+=znTable("\u2764\ufe0f Zones cardio \u00b7 % FC max ("+Math.round(fc)+" bpm)",r3);
    }else out+='<div class="zn-hint">\u2764\ufe0f Renseigne ta <b>FC max</b> pour voir tes zones cardio.</div>';
    return out;
  }
   function thHistSync(){
    var t=thresholdsGet(),vma=num(t.vma),fc=num(t.fcmax),ftp=num(t.ftp);
    if(isNaN(vma)&&isNaN(fc)&&isNaN(ftp))return false;
    if(!Array.isArray(state.thresholdHist))state.thresholdHist=[];
    var h=state.thresholdHist,d=todayStr();
    var snap={d:d,vma:isNaN(vma)?null:vma,fcmax:isNaN(fc)?null:fc,ftp:isNaN(ftp)?null:ftp};
    var last=h.length?h[h.length-1]:null;
    if(last&&last.d===d){if(last.vma===snap.vma&&last.fcmax===snap.fcmax&&last.ftp===snap.ftp)return false;h[h.length-1]=snap;save();return true;}
    h.push(snap);save();return true;
  }
  function thHistChartHTML(){
    var h=Array.isArray(state.thresholdHist)?state.thresholdHist:[];
    var intro='<p class="set-note" style="margin-top:14px">\ud83d\udcc8 <b>\u00c9volution de ton moteur</b> \u2014 \u00e0 chaque mise \u00e0 jour de tes seuils ci-dessus, un point est enregistr\u00e9. Voir ta <b>VMA</b> (course) et ton <b>FTP</b> (v\u00e9lo) monter au fil des semaines, c\u2019est la preuve que ta base a\u00e9robie progresse \u2014 le facteur le plus d\u00e9terminant pour un triathlon M. La <b>VO2max</b> (ton plafond a\u00e9robie \u2248 VMA\u00d73,5) suit ta VMA. La <b>FC max</b> n\u2019est pas trac\u00e9e : quasi g\u00e9n\u00e9tique, elle ne bouge presque pas \u2014 c\u2019est un rep\u00e8re, pas un objectif \u00e0 pousser.</p>';
    if(!h.length)return intro+'<div class="empty">Renseigne un seuil ci-dessus pour d\u00e9marrer le suivi.</div>';
    var series=[
      {key:"vma",lab:"VMA",col:"#12466B",unit:"\u2009km/h",fmt:function(x){return fr1(x);}},
      {key:"ftp",lab:"FTP",col:"#F4622B",unit:"\u2009W",fmt:function(x){return ""+Math.round(x);}}
    ];
    series.forEach(function(s){
      s.raw=[];h.forEach(function(sn,i){var v=sn[s.key];if(v!=null&&!isNaN(v))s.raw.push({i:i,v:v});});
      if(s.raw.length){s.v0=s.raw[0].v;s.vN=s.raw[s.raw.length-1].v;s.pct=s.raw.map(function(p){return {i:p.i,y:(p.v/s.v0)*100};});}
    });
    var draw=series.filter(function(s){return s.raw.length>=2;});
    if(!draw.length)return intro+'<div class="empty">Un seul relev\u00e9 pour l\u2019instant. Refais un test (VMA ou FTP) dans quelques semaines et mets \u00e0 jour tes seuils \u2014 la courbe montrera l\u2019\u00e9volution.</div>';
    var W=320,H=110,pad=10,n=h.length;
    var allY=[100];draw.forEach(function(s){s.pct.forEach(function(p){allY.push(p.y);});});
    var minY=Math.min.apply(null,allY),maxY=Math.max.apply(null,allY);if(maxY-minY<4){maxY+=2;minY-=2;}
    function X(i){return n<2?W/2:(pad+(i/(n-1))*(W-2*pad));}
    function Y(y){return pad+(1-(y-minY)/(maxY-minY))*(H-2*pad);}
    var baseY=Y(100).toFixed(1);
    var base='<line x1="'+pad+'" y1="'+baseY+'" x2="'+(W-pad)+'" y2="'+baseY+'" stroke="#9fb0c0" stroke-width="1" stroke-dasharray="4 3" opacity="0.8"/>';
    var lines=draw.map(function(s){
      var pts=s.pct.map(function(p){return X(p.i).toFixed(1)+","+Y(p.y).toFixed(1);}).join(" ");
      var dots=s.pct.map(function(p){return '<circle cx="'+X(p.i).toFixed(1)+'" cy="'+Y(p.y).toFixed(1)+'" r="2.6" fill="'+s.col+'"/>';}).join("");
      return '<polyline fill="none" stroke="'+s.col+'" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="'+pts+'"/>'+dots;
    }).join("");
    var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;margin:8px 0 4px">'+base+lines+'</svg>';
    var legend=draw.map(function(s){var dp=Math.round((s.vN/s.v0-1)*100);return '<span style="color:'+s.col+';font-weight:600">\u25cf '+s.lab+' '+s.fmt(s.v0)+'\u2009\u2192\u2009'+s.fmt(s.vN)+s.unit+' ('+(dp>=0?"+":"")+dp+'\u2009%)</span>';}).join(' &nbsp; ');
    var vs=series[0],vo2="";if(vs.raw&&vs.raw.length>=2)vo2='<div class="muted" style="font-size:12.5px;margin-top:2px">VO2max \u2248 '+fr1(vs.v0*3.5)+'\u2009\u2192\u2009'+fr1(vs.vN*3.5)+' ml/kg/min</div>';
    return intro+svg+'<div class="muted" style="font-size:12.5px;margin-top:6px;line-height:1.5">'+legend+' \u00b7 base 100 = 1<sup>er</sup> relev\u00e9</div>'+vo2;
  }
  var thTestSel="vma";
  function thTestCalc(kind,v){
    if(kind==="vma"){
      if(v<500||v>5000)return {err:"Distance attendue entre 500 et 5000 m."};
      var vma=Math.round(v/100*10)/10;
      return {key:"vma",val:vma,txt:"VMA \u2248 <b>"+fr1(vma)+"</b> km/h \u00b7 VO2max \u2248 <b>"+fr1(vma*3.5)+"</b> ml/kg/min"};
    }
    if(kind==="ftp"){
      if(v<50||v>600)return {err:"Puissance attendue entre 50 et 600 W."};
      var ftp=Math.round(v*0.95),w=lastWeight();
      return {key:"ftp",val:ftp,txt:"FTP \u2248 <b>"+ftp+"</b> W"+(w!=null?(" \u00b7 "+fr1(ftp/w)+" W/kg"):"")};
    }
    if(v<120||v>230)return {err:"FC max attendue entre 120 et 230 bpm."};
    return {key:"fcmax",val:Math.round(v),txt:"FC max = <b>"+Math.round(v)+"</b> bpm"};
  }
  function thTestHTML(){
    var age=num(profileGet().age);
    var tabs=[["vma","\ud83c\udfc3 VMA"],["ftp","\ud83d\udeb4 FTP"],["fcmax","\u2764\ufe0f FC max"]].map(function(t){
      return '<button type="button" class="th-test-tab seg'+(thTestSel===t[0]?" on":"")+'" data-tt="'+t[0]+'">'+t[1]+'</button>';}).join("");
    var why,steps,lbl,ph,note;
    if(thTestSel==="vma"){
      why="La VMA est la vitesse \u00e0 laquelle tu consommes le maximum d\u2019oxyg\u00e8ne. C\u2019est l\u2019\u00e9talon de toutes tes allures : une fois connue, l\u2019app en d\u00e9duit endurance, seuil et fractionn\u00e9.";
      steps=["\u00c0 faire repos\u00e9 \u2014 pas au lendemain d\u2019une grosse s\u00e9ance.",
        "\u00c9chauffement : 15 min en aisance respiratoire, puis 3 acc\u00e9l\u00e9rations de 20 s.",
        "Sur piste (400 m) ou parcours plat mesur\u00e9 \u00e0 la montre.",
        "Cours <b>6 min</b> \u00e0 l\u2019allure maximale que tu peux tenir <b>r\u00e9guli\u00e8rement</b> : l\u2019erreur classique est de partir trop vite et de s\u2019\u00e9crouler \u00e0 mi-parcours.",
        "Rel\u00e8ve la distance, puis 10 min de retour au calme."];
      lbl="Distance parcourue en 6 min (m)";ph="ex : 1500";
      note="Calcul : VMA = distance \u00f7 100. Rep\u00e8re : 1500 m \u2192 15 km/h.";
    }else if(thTestSel==="ftp"){
      why="Le FTP est la puissance que tu tiens environ 1 h \u00e0 v\u00e9lo. C\u2019est lui qui d\u00e9coupe tes zones de puissance \u2014 le rep\u00e8re pour ne pas griller la partie v\u00e9lo et arriver cuit \u00e0 la course.";
      steps=["Il te faut un capteur de puissance (home-trainer connect\u00e9 ou capteur p\u00e9dalier).",
        "\u00c9chauffement : 20 min, dont 3 \u00d7 1 min vive.",
        "Roule <b>20 min</b> \u00e0 la puissance maximale tenable, la plus <b>r\u00e9guli\u00e8re</b> possible.",
        "Rel\u00e8ve la puissance moyenne des 20 min, puis 10 min de retour au calme."];
      lbl="Puissance moyenne sur 20 min (W)";ph="ex : 235";
      note="Calcul : FTP = moyenne 20 min \u00d7 0,95 \u2014 20 min se tiennent un peu plus fort qu\u2019une heure.";
    }else{
      why="La FC max borne tes zones cardio. Contrairement \u00e0 la VMA et au FTP, elle ne s\u2019entra\u00eene pas : c\u2019est un plafond largement g\u00e9n\u00e9tique. Ne cherche pas \u00e0 la faire monter.";
      steps=["Le plus fiable : la FC la plus haute vue sur la derni\u00e8re minute d\u2019un test VMA ou d\u2019une c\u00f4te courue \u00e0 fond.",
        "Avec une ceinture cardio de pr\u00e9f\u00e9rence : au poignet, la mesure d\u00e9croche souvent sur effort maximal.",
        "Ne force pas ce test si tu es malade, fatigu\u00e9, ou au moindre doute m\u00e9dical."];
      lbl="FC max relev\u00e9e (bpm)";ph="ex : 192";
      note=(!isNaN(age)&&age>0)?("\u00c0 d\u00e9faut, estimation par l\u2019\u00e2ge (formule de Tanaka) : <b>"+Math.round(208-0.7*age)+" bpm</b> \u2014 mais compte \u00b110 bpm d\u2019erreur, une mesure r\u00e9elle vaut mieux.")
        :"\u00c0 d\u00e9faut, une estimation par l\u2019\u00e2ge est possible : renseigne ton \u00e2ge dans \u00ab Profil &amp; m\u00e9tabolisme \u00bb.";
    }
    return '<div class="th-test-h">\ud83e\uddea Mesurer mes seuils</div>'+
      '<p class="set-note">Ces cases ne se remplissent pas au hasard : voici les tests de terrain qui donnent les valeurs. Le r\u00e9sultat s\u2019inscrit tout seul et alimente aussit\u00f4t tes zones et ta courbe.</p>'+
      '<div class="fuel-seg">'+tabs+'</div>'+
      '<div class="th-test-card">'+
        '<div class="th-test-why">'+why+'</div>'+
        '<ol class="th-test-steps">'+steps.map(function(s){return '<li>'+s+'</li>';}).join("")+'</ol>'+
        '<div class="th-test-note">'+note+'</div>'+
        '<div class="th-test-row"><label class="th-test-lbl">'+lbl+'<input type="number" inputmode="decimal" step="0.1" class="th-test-in" placeholder="'+ph+'"></label>'+
        '<button type="button" class="btn accent th-test-save">Enregistrer</button></div>'+
        '<div class="th-test-out"></div>'+
      '</div>';
  }
   function fuelPlanGet(){if(!state.fuelPlan)state.fuelPlan={type:"course",dur:60};if(!state.fuelPlan.type)state.fuelPlan.type="course";if(!state.fuelPlan.dur)state.fuelPlan.dur=60;return state.fuelPlan;}
  function fMPP(n,key){var base=num(n.base);if(isNaN(base)||base<=0)base=1;var por=num(n.portion);if(isNaN(por)||por<=0)por=base;var v=num(n[key]);if(isNaN(v))return 0;return v*por/base;}
  function fuelFoods(kind){var cat=foodCatalog(),arr=[],seen={};
    Object.keys(cat).forEach(function(k){var it=cat[k];if(!it||!it.nut)return;var n=it.nut;var kcal=num(n.kcal);if(isNaN(kcal)||kcal<=0)return;var nm=(""+it.name).trim();var lk=nm.toLowerCase();if(seen[lk])return;
      if(kind==="carb"){var g=num(n.gluc);if(isNaN(g))return;var dens=g/kcal;if(dens<0.15)return;var per=fMPP(n,"gluc");if(per<12)return;seen[lk]=1;arr.push({name:nm,g:Math.round(per),d:dens});}
      else{var pr=num(n.prot);if(isNaN(pr))return;var dens=pr/kcal;if(dens<0.12)return;var per=fMPP(n,"prot");if(per<10)return;seen[lk]=1;arr.push({name:nm,g:Math.round(per),d:dens});}
    });
    arr.sort(function(a,b){return b.d-a.d;});return arr.slice(0,5);}
  function fuelFoodBlock(title,list){if(!list.length)return "";var rows=list.map(function(f){return '<div class="zn-row"><span class="zn-n">'+esc(f.name)+'</span><span class="zn-v">~'+f.g+' g</span></div>';}).join("");return znTable(title,rows);}
  function fuelHTML(p){
    var w=lastWeight();var wv=(w!=null)?w:70;var endurance=(p.type!=="muscu");var h=p.dur/60;
    var rate=(!endurance||p.dur<75)?0:(p.dur<150?45:75);var during=Math.round(rate*h);var protPost=Math.round(0.3*wv);var carbLoad=Math.round(1*wv);
    var out="";
    var avant=(endurance&&p.dur>=90)?("1 \u00e0 3 h avant : un repas riche en glucides (~"+carbLoad+" g), pauvre en graisses et fibres, pour partir r\u00e9serves pleines.")
      :("Dernier repas datant de plus de 3 h ? Une collation glucidique l\u00e9g\u00e8re (banane, compote) 30 \u00e0 60 min avant. Sinon, rien de sp\u00e9cial.");
    out+='<div class="fuel-blk"><div class="fuel-h">Avant</div><div class="fuel-txt">'+avant+'</div></div>';
    var pendant;
    if(rate>0){pendant=rate+" g de glucides par heure (~"+during+" g sur la s\u00e9ance), d\u00e8s 45 \u00e0 60 min, en petites prises r\u00e9guli\u00e8res, en buvant r\u00e9guli\u00e8rement.";if(p.type==="natation")pendant+=" En natation, difficile \u00e0 faire : charge plut\u00f4t avant et r\u00e9cup\u00e8re apr\u00e8s.";}
    else pendant="S\u00e9ance courte : rester hydrat\u00e9 suffit, pas de glucides n\u00e9cessaires pendant.";
    out+='<div class="fuel-blk"><div class="fuel-h">Pendant</div><div class="fuel-txt">'+pendant+'</div></div>';
    var apres="Sous 1 h : ~"+protPost+" g de prot\u00e9ines pour r\u00e9parer le muscle";
    if(endurance&&p.dur>=90)apres+=", plus des glucides pour recharger le glycog\u00e8ne (~"+carbLoad+" g)";
    else if(p.type==="muscu")apres+=" \u2014 ton levier principal : vise tes ~130 g sur la journ\u00e9e";
    apres+=".";
    out+='<div class="fuel-blk"><div class="fuel-h">Apr\u00e8s</div><div class="fuel-txt">'+apres+'</div></div>';
    if(w==null)out+='<div class="zn-hint">Renseigne ton poids (R\u00e9glages \u25b8 Profil) pour des grammages personnalis\u00e9s. Valeur par d\u00e9faut : 70 kg.</div>';
    if(rate>0)out+=fuelFoodBlock("\ud83c\udf4c Glucides faciles (avant / pendant)",fuelFoods("carb"));
    var prot=fuelFoods("prot");out+=fuelFoodBlock("\ud83e\udd5b R\u00e9cup\u00e9ration (prot\u00e9ines)",prot);
    if(!prot.length)out+='<div class="zn-hint">Logue quelques repas, ou attends le chargement de ta base, pour voir des propositions.</div>';
    return out;
  }
  function fuelWrapHTML(){var p=fuelPlanGet();
    function fdur(d){if(d<60)return d+" min";var hh=Math.floor(d/60),mm=d%60;return hh+" h"+(mm?(""+mm):"");}
    var types=[["muscu","\ud83d\udcaa Muscu"],["natation","\ud83c\udfca Natation"],["velo","\ud83d\udeb4 V\u00e9lo"],["course","\ud83c\udfc3 Course"]];
    var durs=[30,45,60,90,120,180];
    var tb=types.map(function(t){return '<button type="button" class="fuel-type seg'+(p.type===t[0]?" on":"")+'" data-t="'+t[0]+'">'+t[1]+'</button>';}).join("");
    var db=durs.map(function(d){return '<button type="button" class="fuel-dur seg'+(p.dur===d?" on":"")+'" data-d="'+d+'">'+fdur(d)+'</button>';}).join("");
    return '<div class="fuel-seg-lbl">Type de s\u00e9ance</div><div class="fuel-seg">'+tb+'</div><div class="fuel-seg-lbl">Dur\u00e9e pr\u00e9vue</div><div class="fuel-seg">'+db+'</div><div class="fuel-out">'+fuelHTML(p)+'</div>';}
   function renderSettings(){
    var host=document.getElementById("settingsBody");if(!host)return;
    if(settingsSessSel){renderSessEditor(host);return;}
    var _cat=foodCatalog(),_lf=loggedFoods();
    var ffOpen=settingsFoodOpen||!!settingsFoodSel||settingsFoodNew;
    var _lfk={};_lf.forEach(function(nm){_lfk[nm.toLowerCase()]=1;});
    var _uf=Object.keys(state.foodFix||{}).filter(function(k){var f=state.foodFix[k];return f&&f.uf&&f.name&&!_lfk[k];}).map(function(k){return (""+state.foodFix[k].name).trim();});
    var _allf=_lf.concat(_uf).sort(function(a,b){return a.toLowerCase()<b.toLowerCase()?-1:1;});
    var ffRows=_allf.map(function(nm){var k=nm.toLowerCase();var c=_cat[k]||{};var n=c.nut||{};var fixed=!!(state.foodFix&&state.foodFix[k]);
        var pu=(n.baseUnit==="g"||n.baseUnit==="ml")?((n.base||"?")+" "+n.baseUnit):("×"+(n.base||"1")+" "+(n.baseUnit||"unité"));
        var sub=(n.prot!==""&&n.prot!=null&&!isNaN(num(n.prot)))?(fr1(num(n.prot))+" g prot / "+pu):"valeurs à renseigner";
        if(settingsFoodSel===k){
          return '<div class="ff-edit" data-nm="'+esc(k)+'">'+
            '<div class="ff-name">'+esc(nm)+(fixed?' <span class="sess-badge">corrigé</span>':'')+'</div>'+
            '<div class="ff-grid">'+
              '<label>Unité<select class="ff-unit">'+unitOptions(c.unit||n.baseUnit||"g")+'</select></label>'+
              '<label>Quantité de base<input type="number" inputmode="decimal" step="any" class="ff-base" value="'+esc(n.base||"1")+'"></label>'+
              '<label>kcal (cette base)<input type="number" inputmode="decimal" step="any" class="ff-kcal" value="'+esc(n.kcal||"")+'"></label>'+
              '<label>Protéines g (cette base)<input type="number" inputmode="decimal" step="any" class="ff-prot" value="'+esc(n.prot||"")+'"></label>'+
              '<label>1 unité ≈ (g)<input type="number" inputmode="decimal" step="any" class="ff-gpu" placeholder="si compté à la pièce" value="'+esc((state.foodFix&&state.foodFix[k]&&state.foodFix[k].gPerU)||"")+'"></label>'+
            '</div>'+
            '<div class="ff-conv"><div class="ff-conv-h">Convertir depuis les valeurs pour 100 g</div>'+
              '<div class="ff-grid"><label>kcal / 100 g<input type="number" inputmode="decimal" step="any" class="ff-k100"></label>'+
              '<label>Protéines g / 100 g<input type="number" inputmode="decimal" step="any" class="ff-p100"></label></div>'+
              '<button type="button" class="btn ghost ff-calc">→ Calculer par pièce</button>'+
              '<div class="ff-conv-note">Renseigne « 1 unité ≈ (g) » ci-dessus + les valeurs /100 g, puis calcule : kcal et protéines par pièce sont remplis (base = 1).</div>'+
            '</div>'+
            '<div class="ff-actions"><button class="btn accent ff-save" data-k="'+esc(k)+'">Enregistrer</button>'+(fixed?'<button class="btn ghost ff-reset" data-k="'+esc(k)+'">Rétablir</button>':'')+'<button class="btn ghost ff-cancel">Annuler</button></div>'+
            (function(){var mc=countLoggedFood(k);return mc>0?'<div class="ff-mig-note">✓ En enregistrant, les '+mc+' repas déjà notés de cet aliment sont mis à jour automatiquement.</div>':'';})()+
          '</div>';
        }
        return '<div class="set-row ff-pick" data-k="'+esc(k)+'" data-nm="'+esc(k)+'"><span class="set-ic">🍽</span><span class="set-main"><span class="set-lbl">'+esc(nm)+(fixed?' <span class="sess-badge">corrigé</span>':'')+'</span><span class="set-sub">'+esc(sub)+'</span></span><span class="sess-arrow">›</span></div>';
      });
    var ffNewForm=settingsFoodNew?('<div class="ff-edit ff-new">'+
        '<div class="ff-name">Nouvel aliment</div>'+
        '<button type="button" class="btn ghost ff-scan">\ud83d\udcf7 Scanner un code-barres</button>'+
        '<input type="hidden" class="ff-gluc"><input type="hidden" class="ff-lip">'+
        '<div class="ff-grid">'+
          '<label>Nom<input type="text" class="ff-newname" placeholder="ex. Skyr vanille Lidl"></label>'+
          '<label>Unité<select class="ff-unit">'+unitOptions("g")+'</select></label>'+
          '<label>Quantité de base<input type="number" inputmode="decimal" step="any" class="ff-base" value="100"></label>'+
          '<label>kcal (cette base)<input type="number" inputmode="decimal" step="any" class="ff-kcal"></label>'+
          '<label>Protéines g (cette base)<input type="number" inputmode="decimal" step="any" class="ff-prot"></label>'+
          '<label>1 unité ≈ (g)<input type="number" inputmode="decimal" step="any" class="ff-gpu" placeholder="si compté à la pièce"></label>'+
        '</div>'+
        '<div class="ff-conv"><div class="ff-conv-h">Ou saisis les valeurs pour 100 g</div>'+
          '<div class="ff-grid"><label>kcal / 100 g<input type="number" inputmode="decimal" step="any" class="ff-k100"></label>'+
          '<label>Protéines g / 100 g<input type="number" inputmode="decimal" step="any" class="ff-p100"></label></div>'+
          '<button type="button" class="btn ghost ff-calc">→ Calculer par pièce</button>'+
          '<div class="ff-conv-note">Pour un aliment compté à la pièce : renseigne « 1 unité ≈ (g) » + les valeurs /100 g, puis calcule.</div>'+
        '</div>'+
        '<div class="ff-actions"><button class="btn accent ff-newsave">Créer l\'aliment</button><button class="btn ghost ff-newcancel">Annuler</button></div>'+
      '</div>'):"";
    var fixSec='<div class="set-sec">'+
      '<button type="button" class="bnd bnd-flat ff-sectog'+(ffOpen?" open":"")+'"><span class="set-sec-h">Aliments &amp; unités</span>'+(_allf.length?'<span class="ff-count">'+_allf.length+'</span>':"")+'<span class="bnd-chev">▾</span></button>'+
      (ffOpen?'<div class="ff-secbody"><p class="set-note">Corrige l\'unité et les valeurs d\'un aliment que tu logges (ex. œuf : compté par pièce, pas par gramme), ou <b>ajoute tes propres aliments</b> (tes courses) pour les retrouver au moment de logger.</p>'+
        '<button type="button" class="btn ghost ff-add">＋ Ajouter un aliment</button>'+
        ffNewForm+
        (_allf.length?'<input type="text" class="ff-search" placeholder="Rechercher un aliment…" value="'+esc(settingsFoodQuery||"")+'"><div class="ff-scroll">'+ffRows.join("")+'</div>':'<p class="muted" style="font-size:13px">Aucun aliment encore — ajoute-en un ci-dessus, ou logge un repas.</p>')+
      '</div>':"")+
    '</div>';
         /* ---- Éditeur Qualité des aliments (badges 💪/🌱 · 🟢🟡🔴 · ⚠️) ---- */
    var W2TOK={"":"0"};W2TOK[typeof FQ_MERCURE!=="undefined"?FQ_MERCURE:"__m"]="M";W2TOK[typeof FQ_CHARCUT!=="undefined"?FQ_CHARCUT:"__c"]="C";W2TOK[typeof FQ_ALCOOL!=="undefined"?FQ_ALCOOL:"__a"]="A";W2TOK[typeof FQ_SUCRE!=="undefined"?FQ_SUCRE:"__s"]="S";
    function fqSelP(v){return '<select class="fqe-p"><option value="0"'+(!v?' selected':'')+'>—</option><option value="1"'+(v===1?' selected':'')+'>💪 complète</option><option value="2"'+(v===2?' selected':'')+'>🌱 à compléter</option></select>';}
    function fqSelN(v){return '<select class="fqe-n"><option value="0"'+(!v?' selected':'')+'>—</option><option value="1"'+(v===1?' selected':'')+'>🟢 brut</option><option value="2"'+(v===2?' selected':'')+'>🟡 transformé</option><option value="3"'+(v===3?' selected':'')+'>🔴 ultra-transformé</option></select>';}
    function fqSelW(w){var t=W2TOK[w]||"0";function o(val,lbl){return '<option value="'+val+'"'+(t===val?' selected':'')+'>'+lbl+'</option>';}return '<select class="fqe-w">'+o("0","aucune")+o("M","⚠️ mercure")+o("C","⚠️ charcuterie")+o("A","⚠️ alcool")+o("S","⚠️ sucre ajouté")+'</select>';}
    var qualRows=_lf.map(function(nm){var k=fqKey(nm);var q=foodQuality(nm)||{};var over=!!(state.foodQual&&state.foodQual[k]);
      if(settingsQualSel===k){
        return '<div class="ff-edit fqe-edit" data-k="'+esc(k)+'"><div class="ff-name">'+esc(nm)+(over?' <span class="sess-badge">perso</span>':'')+'</div>'+
          '<div class="ff-grid"><label>Protéine'+fqSelP(q.p)+'</label><label>Transformation'+fqSelN(q.n)+'</label><label>Vigilance'+fqSelW(q.w)+'</label></div>'+
          '<div class="ff-actions"><button class="btn accent fqe-save" data-k="'+esc(k)+'">Enregistrer</button>'+(over?'<button class="btn ghost fqe-reset" data-k="'+esc(k)+'">Rétablir</button>':'')+'<button class="btn ghost fqe-cancel">Annuler</button></div></div>';
      }
      var badges=foodQualityBadges(nm)||'<span class="set-sub">non classé</span>';
      return '<div class="set-row fqe-pick" data-k="'+esc(k)+'" data-nm="'+esc(k)+'"><span class="set-ic">🏷</span><span class="set-main"><span class="set-lbl">'+esc(nm)+(over?' <span class="sess-badge">perso</span>':'')+'</span><span class="set-sub">'+badges+'</span></span><span class="sess-arrow">›</span></div>';
    });
    var qualInner='<p class="set-note">Ajuste les badges qualité d\'un aliment (profil protéique, transformation NOVA, vigilance). Tes réglages priment sur les valeurs par défaut, sont sauvegardés/exportés, et servent aussi au repérage par mots-clés. « Rétablir » revient au défaut.</p>'+
      (_lf.length?'<input type="text" class="fqe-search" placeholder="Rechercher un aliment…" value="'+esc(settingsQualQuery||"")+'"><div class="fqe-scroll">'+qualRows.join("")+'</div>':'<p class="muted" style="font-size:13px">Aucun aliment loggé — ajoute des repas, ils apparaîtront ici.</p>');

    var actsInner='<p class="set-note">Active les sports que tu prépares. Désactivé, le sport disparaît du calendrier (rien n\'est supprimé). Tu peux ajuster le nom, la date de début et la description.</p>'+
      actCard("muscu")+actCard("tri");
    var rows=pDeadlines().map(function(d){
      if(settingsEdit===d.id)return deadlineForm(d);
      return '<div class="set-row"><span class="set-ic">'+esc(d.icon||"🎯")+'</span><span class="set-main"><span class="set-lbl">'+esc(d.label)+'</span><span class="set-sub">'+esc(frDateShort(d.date))+' '+dlYear(d.date)+' · J-'+Math.max(0,diffDays(d.date,todayStr()))+'</span></span><button class="set-edit" data-edit="'+d.id+'" aria-label="Modifier">✎</button><button class="set-del" data-del="'+d.id+'" aria-label="Supprimer">🗑</button></div>';
    }).join("");
    var addBlock=settingsEdit==="new"?deadlineForm(null):'<button class="btn ghost set-add" id="setAdd">+ Ajouter une échéance</button>';
    var objInner='<p class="set-note">Ajoute, modifie ou supprime tes échéances. Le compte à rebours et les repères du calendrier se mettent à jour partout (et dans tes autres apps).</p>'+
      (rows||'<p class="muted" style="font-size:13px">Aucune échéance pour le moment.</p>')+addBlock;
    var sessInner='<p class="set-note">Modifie durablement tes séances : renomme, ajoute, retire ou ajuste les exercices et les séries. (Différent de l\'ajout à la volée dans une séance, qui reste ponctuel.)</p>'+
      BLOCK_ORDER.map(function(b){return '<div class="sess-blk">'+esc(PROGRAM_BLOCKS[b].name)+'</div>'+
        CODES.map(function(c){var p=progOf(b,c);var cust=progIsCustom(b,c);
          return '<div class="set-row sess-pick" data-sess="'+b+'_'+c+'"><span class="set-ic">💪</span><span class="set-main"><span class="set-lbl">Séance '+c+(cust?' <span class="sess-badge">modifiée</span>':'')+'</span><span class="set-sub">'+esc(p.title.replace(/^S[eé]ance [A-D]\s*—\s*/,""))+' · '+(p.exos?p.exos.length:0)+' exos</span></span><span class="sess-arrow">›</span></div>';
        }).join("");
      }).join("");
    var dtInner='<p class="set-note">Un seul vocabulaire, partagé avec ton app de révisions DSCG. Touche un jour du calendrier pour lui donner un type ; il s\'applique aux deux apps (entraînement <em>et</em> heures de révision). Le type « normal » se déduit du jour (semaine / week-end).</p>'+
      (typeof DAY_TYPES!=="undefined"?DAY_TYPES:[]).filter(function(t){return t.id;}).map(function(t){
        return '<div class="dt-row"><span class="dt-ic">'+esc(t.icon||"•")+'</span><span class="dt-lbl">'+esc(t.label)+'</span><span class="dt-eff">'+(t.train===false?'pas d\'entraînement':'entraînement possible')+'</span></div>';
      }).join("");
    var _G=goalsAt(todayStr());
    var rgoalInner='<p class="set-note">Chaque branche du radar est à 100 % quand tu atteins l\'objectif ci-dessous. '+
      'Choisis un niveau que tu peux tenir <b>la plupart des jours</b> : un radar toujours à 40 % n\'apprend rien, '+
      'un radar toujours plein non plus. Pour les à-côtés, compte le nombre d\'ancrages à tenir par jour, '+
      'pas le nombre que tu as créés : tu peux en suivre 3 et n\'en viser qu\'1.</p>'+
      '<div class="rg-list">'+["sport","prot","sleep","water","anchors","kcal"].map(function(k){
        var L=GOAL_LBL[k];
        return '<label class="rg-row"><span class="rg-ic">'+L[0]+'</span>'+
          '<span class="rg-txt"><b>'+L[1]+'</b><span class="rg-u">'+L[2]+'</span></span>'+
          '<input type="number" inputmode="decimal" step="any" class="rg-in" data-g="'+k+'" value="'+esc(_G[k])+'"></label>';
      }).join("")+'</div>'+
      '<p class="set-note"><b>Tes journées passées ne bougeront pas.</b> Un objectif s\'applique à partir '+
      'd\'aujourd\'hui : si tu passes de 1 à 2 ancrages par jour, les jours déjà validés à 1 restent à 100 %. '+
      'C\'est ce qui rend les moyennes sur 30 ou 90 jours comparables dans le temps.</p>'+
      ((state.goals&&state.goals.length)?('<div class="rg-hist">Changements enregistrés : '+
        state.goals.map(function(e){return esc(frDateShort(e.from));}).join(" · ")+'</div>'):'');
    var bkpInner='<p class="set-note">Tes données vivent dans ce navigateur. Exporte-les de temps en temps : si tu changes de téléphone ou vides le cache, tu pourras tout réimporter.</p>'+
      '<button class="btn accent bkp-btn" id="bkpExport">⬇️ Exporter mes données</button>'+
      '<button class="btn ghost bkp-btn" id="bkpImport">⬆️ Importer une sauvegarde</button>'+
      '<button class="btn danger bkp-btn" id="bkpReset">🗑️ Tout effacer</button>'+
      '<div class="bkp-when">'+((state.config&&state.config.lastBackup)?('Dernière sauvegarde : '+esc(frDateShort(state.config.lastBackup))+((backupStaleDays()>=7)?' · <span class="low">pense à en refaire une</span>':'')):'<span class="low">Aucune sauvegarde encore — fais-en une.</span>')+'</div>';
    var pf=profileGet();var pfBmr=bmr(),pfW=lastWeight();
    var profilInner='<p class="set-note">Sert au bilan énergétique (métabolisme de base — formule Mifflin-St Jeor). Reste sur ton téléphone.</p>'+
      '<div class="ff-grid">'+
        '<label>Sexe<select class="pf-sex"><option value="h"'+(pf.sex!=="f"?" selected":"")+'>Homme</option><option value="f"'+(pf.sex==="f"?" selected":"")+'>Femme</option></select></label>'+
        '<label>Taille (cm)<input type="number" inputmode="numeric" class="pf-h" value="'+esc(pf.height)+'" placeholder="ex : 178"></label>'+
        '<label>Âge<input type="number" inputmode="numeric" class="pf-age" value="'+esc(pf.age)+'" placeholder="ex : 25"></label>'+
        '<label>Poids réf. (kg)<input type="number" inputmode="decimal" step="0.1" class="pf-w" value="'+esc(pf.weight)+'" placeholder="'+(pfW!=null?("auto : "+fr1(pfW)):"ex : 68")+'"></label>'+
        '<label>Objectif bilan (kcal/j)<input type="number" inputmode="numeric" class="pf-kcalgoal" value="'+esc(state.kcalGoal!=null?state.kcalGoal:"")+'" placeholder="+300 (prise de masse)"></label>'+
      '</div>'+
      '<div class="bkp-when pf-bmr">'+(pfBmr!=null?('Métabolisme de base : <b>'+Math.round(pfBmr)+' kcal/j</b>'+(pfW!=null?(' · poids '+fr1(pfW)+' kg'):'')):'<span class="low">Complète taille + âge pour le calcul.</span>')+'</div>';
    var crList=customRoutines();
    var anchorsRows=crList.map(function(a){
      return '<div class="cr-row" data-id="'+esc(a.id)+'" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">'+
        '<input type="text" class="cr-emoji" maxlength="3" value="'+esc(a.icon||"")+'" placeholder="🚭" style="width:52px;text-align:center;padding:9px 6px;border:1.5px solid var(--line);border-radius:10px;font-size:18px;background:#fff">'+
        '<input type="text" class="cr-label" value="'+esc(a.label||"")+'" placeholder="Intitulé (ex : Journée sans cigarette)" style="flex:1;min-width:0;padding:9px 11px;border:1.5px solid var(--line);border-radius:10px;font-size:14px;background:#fff">'+
        '<button type="button" class="set-del cr-del" aria-label="Supprimer">🗑</button>'+
      '</div>'+
      '<div class="cr-row2" data-id="'+esc(a.id)+'">'+
        '<input type="text" class="cr-link" value="'+esc(a.link||"")+'" placeholder="Lien (vid\u00e9o, article\u2026), vide = recherche YouTube">'+
        '<label class="cr-notetog"><input type="checkbox" class="cr-note"'+(a.note?" checked":"")+'><span>Bloc-note quotidien</span></label>'+
      '</div>';
    }).join("");
    var anchorsInner='<p class="set-note">Crée tes propres ancrages d\'habitude. Chacun apparaît dans « Aujourd\'hui » avec une case à cocher, et sa série 🔥 se suit dans Progrès — idéal pour un suivi jour après jour (ex. « Journée sans cigarette »). Un emoji + un intitulé suffisent. Coche <b>bloc-note quotidien</b> si tu veux écrire deux lignes sous l\'ancrage chaque jour (ce que tu as fait, pourquoi ça a sauté\u2026) : la note appartient à la date affichée.</p>'+
      anchorsRows+
      '<div class="cr-add" style="display:flex;gap:8px;align-items:center;margin-top:4px">'+
        '<input type="text" class="cr-new-emoji" maxlength="3" placeholder="🚭" style="width:52px;text-align:center;padding:9px 6px;border:1.5px solid var(--line);border-radius:10px;font-size:18px;background:#fff">'+
        '<input type="text" class="cr-new-label" placeholder="Nouvel ancrage…" style="flex:1;min-width:0;padding:9px 11px;border:1.5px solid var(--line);border-radius:10px;font-size:14px;background:#fff">'+
        '<button type="button" class="btn accent cr-addbtn" style="flex:0 0 auto;padding:9px 14px;font-size:13px;white-space:nowrap">Ajouter</button>'+
      '</div>'+
      '<label class="cr-notetog cr-notetog-new"><input type="checkbox" class="cr-new-note"><span>Bloc-note quotidien</span></label>';
    var _th=thresholdsGet();thHistSync();
    var seuilsInner='<p class="set-note">Tes seuils transforment l\'intensit\u00e9 en rep\u00e8res concrets (allures, watts, pulsations). Ce sont des <b>guides</b> : la <b>VMA</b> = ta vitesse maximale a\u00e9robie en course, la <b>FC max</b> = ta fr\u00e9quence cardiaque maximale, le <b>FTP</b> = la puissance tenue ~1 h \u00e0 v\u00e9lo. Renseigne ce que tu connais (Apple Watch, test terrain) \u2014 le reste se calcule.</p>'+
      '<div class="ff-grid">'+
        '<label>VMA course (km/h)<input type="number" inputmode="decimal" step="0.1" class="th-vma" value="'+esc(_th.vma||"")+'" placeholder="ex : 16"></label>'+
        '<label>FC max (bpm)<input type="number" inputmode="numeric" class="th-fcmax" value="'+esc(_th.fcmax||"")+'" placeholder="ex : 190"></label>'+
        '<label>FTP v\u00e9lo (W)<input type="number" inputmode="numeric" class="th-ftp" value="'+esc(_th.ftp||"")+'" placeholder="ex : 220"></label>'+
      '</div>'+
      '<div class="seuils-out">'+zonesHTML(_th)+'</div>'+
      '<div class="th-hist">'+thHistChartHTML()+'</div>'+
      '<div class="th-test">'+thTestHTML()+'</div>';
    var fuelInner='<p class="set-note">Un guide pour caler ton alimentation autour de la s\u00e9ance, selon son type et sa dur\u00e9e. Ce sont des rep\u00e8res, pas des r\u00e8gles.</p><div class="fuel-wrap">'+fuelWrapHTML()+'</div>';  
    var _ffOpen=settingsFoodOpen||!!settingsFoodSel||settingsFoodNew;
    host.innerHTML=
      settingsGroup("g_profil","👤 Profil & physiologie",
        settingsSec("profil","Profil &amp; métabolisme",profilInner,!!settingsSecOpen.profil)+
        settingsSec("seuils","Seuils &amp; zones · triathlon",seuilsInner,!!settingsSecOpen.seuils)+
        settingsSec("fuel","Carburant de séance",fuelInner,!!settingsSecOpen.fuel),
        !!settingsGrpOpen.g_profil||!!settingsSecOpen.profil||!!settingsSecOpen.seuils||!!settingsSecOpen.fuel)+
      settingsGroup("g_train","🏋️ Entraînement",
        settingsSec("acts","Activités préparées",actsInner,!!settingsSecOpen.acts||!!settingsActEdit)+
        settingsSec("sess","Séances (personnalisation)",sessInner,!!settingsSecOpen.sess)+
        settingsSec("daytypes","Types de jour",dtInner,!!settingsSecOpen.daytypes)+
        settingsSec("obj","Objectifs &amp; échéances",objInner,!!settingsSecOpen.obj||!!settingsEdit)+
        settingsSec("rgoal","🕸️ Ce qui vaut 100 % sur le radar",rgoalInner,!!settingsSecOpen.rgoal),
        !!settingsGrpOpen.g_train||!!settingsSecOpen.acts||!!settingsActEdit||!!settingsSecOpen.sess||!!settingsSecOpen.daytypes||!!settingsSecOpen.obj||!!settingsEdit)+
      settingsGroup("g_track","📊 Suivi & aliments",
        settingsSec("anchors","Ancrages de routines",anchorsInner,!!settingsSecOpen.anchors)+
        fixSec+
        settingsSec("qual","Qualité des aliments",qualInner,!!settingsSecOpen.qual||!!settingsQualSel),
        !!settingsGrpOpen.g_track||!!settingsSecOpen.anchors||_ffOpen||!!settingsSecOpen.qual||!!settingsQualSel)+
      settingsGroup("g_data","💾 Données",
        settingsSec("backup","Sauvegarde",bkpInner,!!settingsSecOpen.backup),
        !!settingsGrpOpen.g_data||!!settingsSecOpen.backup);
    host.querySelectorAll(".rg-in").forEach(function(inp){inp.onchange=function(){
      var k=inp.getAttribute("data-g"),v=inp.value.replace(",",".");
      var p={};p[k]=(v===""?null:num(v));goalsSetToday(p);renderSettings();};});
    host.querySelectorAll(".set-grptog").forEach(function(b){b.onclick=function(){var id=b.getAttribute("data-grp");settingsGrpOpen[id]=!settingsGrpOpen[id];renderSettings();};});  
    host.querySelectorAll(".set-sectog").forEach(function(b){b.onclick=function(){var id=b.getAttribute("data-sec");settingsSecOpen[id]=!settingsSecOpen[id];if(id==="obj"&&!settingsSecOpen.obj)settingsEdit=null;if(id==="acts"&&!settingsSecOpen.acts)settingsActEdit=null;renderSettings();};});
    var be=document.getElementById("bkpExport");if(be)be.onclick=function(){exportBackup();renderSettings();};
    var bi=document.getElementById("bkpImport");if(bi)bi.onclick=pickImport;
    var brs=document.getElementById("bkpReset");if(brs)brs.onclick=function(){
      if(!confirm("Tout effacer ? Action irréversible — exporte d'abord tes données."))return;
      if(!confirm("Dernière confirmation : toutes tes journées, séances et repas seront perdus."))return;
      state={sessions:{},days:{},tri:{}};save();currentSel=null;currentTri=null;
      closeSettings();dayDate=todayStr();activateTab("v-day");};
    (function(){var pf=profileGet();
      function pfRefresh(){var el=host.querySelector(".pf-bmr");if(!el)return;var b=bmr(),w=lastWeight();el.innerHTML=(b!=null?('Métabolisme de base : <b>'+Math.round(b)+' kcal/j</b>'+(w!=null?(' · poids '+fr1(w)+' kg'):'')):'<span class="low">Complète taille + âge pour le calcul.</span>');}
      var sx=host.querySelector(".pf-sex");if(sx)sx.onchange=function(){pf.sex=sx.value;save();pfRefresh();};
      var h=host.querySelector(".pf-h");if(h)h.oninput=function(){pf.height=h.value;save();pfRefresh();};
      var a=host.querySelector(".pf-age");if(a)a.oninput=function(){pf.age=a.value;save();pfRefresh();};
      var w=host.querySelector(".pf-w");if(w)w.oninput=function(){pf.weight=w.value;save();pfRefresh();};
      var kg2=host.querySelector(".pf-kcalgoal");if(kg2)kg2.oninput=function(){state.kcalGoal=kg2.value;save();renderDayRadar();renderProgressRadar();};
    })();
    (function(){var out=host.querySelector(".seuils-out");if(!out)return;var t=thresholdsGet();var histBox=host.querySelector(".th-hist");
      function ref(){out.innerHTML=zonesHTML(t);thHistSync();if(histBox)histBox.innerHTML=thHistChartHTML();}
      var v=host.querySelector(".th-vma");if(v)v.oninput=function(){t.vma=v.value;save();ref();};
      var f=host.querySelector(".th-fcmax");if(f)f.oninput=function(){t.fcmax=f.value;save();ref();};
      var p=host.querySelector(".th-ftp");if(p)p.oninput=function(){t.ftp=p.value;save();ref();};
    })();
    (function(){var box=host.querySelector(".th-test");if(!box)return;
      function wire(){
        box.querySelectorAll(".th-test-tab").forEach(function(b){b.onclick=function(){thTestSel=b.getAttribute("data-tt");box.innerHTML=thTestHTML();wire();};});
        var inp=box.querySelector(".th-test-in"),out=box.querySelector(".th-test-out"),btn=box.querySelector(".th-test-save");
        function res(){var v=num(inp?inp.value:"");if(isNaN(v)||v<=0)return null;return thTestCalc(thTestSel,v);}
        function preview(){if(!out)return;var r=res();out.innerHTML=!r?"":(r.err?('<span class="th-test-err">'+r.err+'</span>'):('<span class="th-test-ok">'+r.txt+'</span>'));}
        if(inp)inp.oninput=preview;
        if(btn)btn.onclick=function(){var r=res();if(!r||r.err){preview();return;}
          var t=thresholdsGet();t[r.key]=r.val;save();thHistSync();
          if(typeof renderOnboard==="function")renderOnboard();
          renderSettings();};
        preview();
      }
      wire();
    })();
    (function(){var wrap=host.querySelector(".fuel-wrap");if(!wrap)return;
      function bind(){var p=fuelPlanGet();
        wrap.querySelectorAll(".fuel-type").forEach(function(b){b.onclick=function(){p.type=b.getAttribute("data-t");save();wrap.innerHTML=fuelWrapHTML();bind();};});
        wrap.querySelectorAll(".fuel-dur").forEach(function(b){b.onclick=function(){p.dur=parseInt(b.getAttribute("data-d"),10);save();wrap.innerHTML=fuelWrapHTML();bind();};});}
      bind();
    })();
    host.querySelectorAll(".sess-pick").forEach(function(b){b.onclick=function(){settingsSessSel=b.getAttribute("data-sess");renderSettings();};});
    host.querySelectorAll(".cr-row").forEach(function(row){var id=row.getAttribute("data-id");var em=row.querySelector(".cr-emoji"),lb=row.querySelector(".cr-label");
      function upd(){var a=findCR(id);if(!a)return;a.icon=(em.value||"").trim();a.label=(lb.value||"").trim();save();refreshDayForm();}
      if(em)em.addEventListener("input",upd);if(lb)lb.addEventListener("input",upd);
      var nt=host.querySelector('.cr-row2[data-id="'+id+'"] .cr-note');
      if(nt)nt.addEventListener("change",function(){var o=findCR(id);if(!o)return;if(nt.checked)o.note=true;else delete o.note;save();refreshDayForm();});
      var lk=host.querySelector('.cr-row2[data-id="'+id+'"] .cr-link');
      if(lk)lk.addEventListener("input",function(){var o=findCR(id);if(!o)return;var v=(lk.value||"").trim();if(v)o.link=v;else delete o.link;save();});
      var del=row.querySelector(".cr-del");if(del)del.onclick=function(){if(confirm("Supprimer cet ancrage ? Son suivi sera retiré des jours notés.")){removeCR(id);save();renderSettings();refreshDayForm();}};
    });
    (function(){var b=host.querySelector(".cr-addbtn");if(!b)return;function addCR(){var ei=host.querySelector(".cr-new-emoji"),li=host.querySelector(".cr-new-label");var lbl=((li&&li.value)||"").trim();if(!lbl)return;if(!Array.isArray(state.customRoutines))state.customRoutines=[];var nn=host.querySelector(".cr-new-note");var nw={id:"cr"+Date.now().toString(36),icon:((ei&&ei.value)||"").trim(),label:lbl};if(nn&&nn.checked)nw.note=true;state.customRoutines.push(nw);settingsSecOpen.anchors=true;save();renderSettings();refreshDayForm();}
      b.onclick=addCR;var li=host.querySelector(".cr-new-label");if(li)li.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();addCR();}});
    })();
    host.querySelectorAll("[data-tgl]").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-tgl");setAct(k,{enabled:!actEnabled(k)});settingsActEdit=null;renderSettings();renderCalendars();};});
    host.querySelectorAll("[data-actedit]").forEach(function(b){b.onclick=function(){settingsActEdit=b.getAttribute("data-actedit");renderSettings();};});
    host.querySelectorAll("[data-edit]").forEach(function(b){b.onclick=function(){settingsEdit=b.getAttribute("data-edit");renderSettings();};});
    host.querySelectorAll("[data-del]").forEach(function(b){b.onclick=function(){var id=b.getAttribute("data-del");if(confirm("Supprimer cette échéance ?")){pRemoveDeadline(id);settingsEdit=null;renderSettings();renderCalendars();}};});
    var sa=document.getElementById("setAdd");if(sa)sa.onclick=function(){settingsEdit="new";renderSettings();};
    var ffTog=host.querySelector(".ff-sectog");if(ffTog)ffTog.onclick=function(){settingsFoodOpen=!settingsFoodOpen;if(!settingsFoodOpen)settingsFoodSel=null;renderSettings();};
    function ffFilter(){var q=(settingsFoodQuery||"").trim().toLowerCase();host.querySelectorAll(".ff-scroll .ff-pick").forEach(function(r){var nm=r.getAttribute("data-nm")||"";r.style.display=(!q||nm.indexOf(q)>=0)?"":"none";});}
    var ffSearch=host.querySelector(".ff-search");if(ffSearch){ffSearch.addEventListener("input",function(){settingsFoodQuery=ffSearch.value;ffFilter();});ffFilter();}
    host.querySelectorAll(".ff-pick").forEach(function(b){b.onclick=function(){settingsFoodSel=b.getAttribute("data-k");renderSettings();var ed=host.querySelector(".ff-scroll .ff-edit");if(ed&&ed.scrollIntoView)ed.scrollIntoView({block:"nearest"});};});
    var ffCancel=host.querySelector(".ff-cancel");if(ffCancel)ffCancel.onclick=function(){settingsFoodSel=null;renderSettings();};
    var ffAdd=host.querySelector(".ff-add");if(ffAdd)ffAdd.onclick=function(){settingsFoodNew=true;settingsFoodSel=null;renderSettings();var f=host.querySelector(".ff-new");if(f&&f.scrollIntoView)f.scrollIntoView({block:"nearest"});var ni=host.querySelector(".ff-newname");if(ni)ni.focus();};
    var ffNewCancel=host.querySelector(".ff-newcancel");if(ffNewCancel)ffNewCancel.onclick=function(){settingsFoodNew=false;renderSettings();};
    var ffScan=host.querySelector(".ff-scan");if(ffScan)ffScan.onclick=function(){var box=host.querySelector(".ff-new");if(!box)return;openScanner(function(res){
      var n=res&&res.nut?res.nut:{};function set(sel,v){var e=box.querySelector(sel);if(e)e.value=(v==null?"":v);}
      var nm=box.querySelector(".ff-newname");if(nm&&!(""+nm.value).trim())nm.value=res.name||"";
      var un=box.querySelector(".ff-unit");if(un)un.value="g";
      set(".ff-base","100");set(".ff-kcal",n.kcal);set(".ff-prot",n.prot);
      set(".ff-k100",n.kcal);set(".ff-p100",n.prot);set(".ff-gluc",n.gluc);set(".ff-lip",n.lip);
    });};
    var ffNewSave=host.querySelector(".ff-newsave");if(ffNewSave)ffNewSave.onclick=function(){var box=host.querySelector(".ff-new");if(!box)return;var nm=(""+box.querySelector(".ff-newname").value).trim();if(!nm){alert("Donne un nom à l'aliment.");box.querySelector(".ff-newname").focus();return;}var k=nm.toLowerCase();var fx=foodFixMap();fx[k]={name:nm,unit:box.querySelector(".ff-unit").value,base:box.querySelector(".ff-base").value,kcal:box.querySelector(".ff-kcal").value,prot:box.querySelector(".ff-prot").value,gPerU:(""+box.querySelector(".ff-gpu").value).trim(),uf:1};var _gl=box.querySelector(".ff-gluc"),_lp=box.querySelector(".ff-lip");if(_gl&&(""+_gl.value).trim()!=="")fx[k].gluc=(""+_gl.value).trim();if(_lp&&(""+_lp.value).trim()!=="")fx[k].lip=(""+_lp.value).trim();save();migrateFood(k);save();settingsFoodNew=false;settingsFoodSel=null;renderSettings();renderDayNutri(dayDate);};
    host.querySelectorAll(".ff-save").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-k");var box=b.closest(".ff-edit");if(!box)return;var gpuEl=box.querySelector(".ff-gpu");var fx=foodFixMap();var _p=fx[k]||{};var nf={unit:box.querySelector(".ff-unit").value,base:box.querySelector(".ff-base").value,kcal:box.querySelector(".ff-kcal").value,prot:box.querySelector(".ff-prot").value,gPerU:gpuEl?(""+gpuEl.value).trim():""};if(_p.uf)nf.uf=_p.uf;if(_p.name)nf.name=_p.name;fx[k]=nf;save();migrateFood(k);save();settingsFoodSel=null;renderSettings();renderDayNutri(dayDate);renderDayBalance(dayDate);};});
    host.querySelectorAll(".ff-calc").forEach(function(b){b.onclick=function(){var box=b.closest(".ff-edit");if(!box)return;var gEl=box.querySelector(".ff-gpu");var g=num(gEl?gEl.value:"");if(isNaN(g)||g<=0){alert("Renseigne d'abord « 1 unité ≈ (g) » (ex. 60).");if(gEl)gEl.focus();return;}var f=g/100;var k100=num(box.querySelector(".ff-k100").value),p100=num(box.querySelector(".ff-p100").value);var kc=box.querySelector(".ff-kcal"),pr=box.querySelector(".ff-prot"),ba=box.querySelector(".ff-base"),un=box.querySelector(".ff-unit");if(!isNaN(k100)&&kc)kc.value=""+Math.round(k100*f);if(!isNaN(p100)&&pr)pr.value=""+(Math.round(p100*f*10)/10);if(ba)ba.value="1";if(un&&(un.value==="g"||un.value==="ml"))un.value="unité";};});
    host.querySelectorAll(".ff-reset").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-k");if(state.foodFix)delete state.foodFix[k];save();settingsFoodSel=null;renderSettings();renderDayNutri(dayDate);};});
    host.querySelectorAll(".ff-migrate").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-k"),cnt=b.getAttribute("data-n");
      if(!confirm("Réécrire "+cnt+" repas déjà notés de « "+k+" » avec les valeurs corrigées ?\n\nLes quantités sont conservées (comptées dans la nouvelle unité). Une sauvegarde va d'abord être téléchargée — réversible en la réimportant."))return;
      try{exportBackup();}catch(e){}
      var done=migrateFood(k);save();settingsFoodSel=null;renderSettings();renderDayNutri(dayDate);
      try{alert(done+" repas mis à jour. Vérifie tes totaux ; en cas de souci, réimporte la sauvegarde téléchargée.");}catch(e){}
    };});
         /* --- éditeur Qualité --- */
    var TOK2W={"0":0,"M":(typeof FQ_MERCURE!=="undefined"?FQ_MERCURE:0),"C":(typeof FQ_CHARCUT!=="undefined"?FQ_CHARCUT:0),"A":(typeof FQ_ALCOOL!=="undefined"?FQ_ALCOOL:0),"S":(typeof FQ_SUCRE!=="undefined"?FQ_SUCRE:0)};
    function fqeFilter(){var q=(settingsQualQuery||"").trim().toLowerCase();host.querySelectorAll(".fqe-scroll .fqe-pick").forEach(function(r){var nm=r.getAttribute("data-nm")||"";r.style.display=(!q||nm.indexOf(q)>=0)?"":"none";});}
    var fqeSearch=host.querySelector(".fqe-search");if(fqeSearch){fqeSearch.addEventListener("input",function(){settingsQualQuery=fqeSearch.value;fqeFilter();});fqeFilter();}
    host.querySelectorAll(".fqe-pick").forEach(function(b){b.onclick=function(){settingsQualSel=b.getAttribute("data-k");settingsSecOpen.qual=true;renderSettings();var ed=host.querySelector(".fqe-scroll .fqe-edit");if(ed&&ed.scrollIntoView)ed.scrollIntoView({block:"nearest"});};});
    var fqeCancel=host.querySelector(".fqe-cancel");if(fqeCancel)fqeCancel.onclick=function(){settingsQualSel=null;renderSettings();};
    host.querySelectorAll(".fqe-save").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-k");var box=b.closest(".fqe-edit");if(!box)return;
      var p=parseInt(box.querySelector(".fqe-p").value,10)||0,n=parseInt(box.querySelector(".fqe-n").value,10)||0,w=TOK2W[box.querySelector(".fqe-w").value]||0;
      foodQualMap()[k]={p:p,n:n,w:w};fqInvalidate();save();settingsQualSel=null;renderSettings();renderDayNutri(dayDate);};});
    host.querySelectorAll(".fqe-reset").forEach(function(b){b.onclick=function(){var k=b.getAttribute("data-k");if(state.foodQual)delete state.foodQual[k];fqInvalidate();save();settingsQualSel=null;renderSettings();renderDayNutri(dayDate);};});
 

    wireActForm();wireDeadlineForm();
  }
  /* ---------------- Sauvegarde / restauration ---------------- */
  function readLS(k){try{return JSON.parse(localStorage.getItem(k)||"null");}catch(e){return null;}}
  function exportBackup(){
    var data={app:"coachmuscu",fmt:1,date:new Date().toISOString(),suiviMuscu_v1:readLS(KEY),planning:readLS(PKEY)};
    try{
      var blob=new Blob([JSON.stringify(data)],{type:"application/json"});
      var url=URL.createObjectURL(blob);var a=document.createElement("a");
      a.href=url;a.download="coachmuscu-sauvegarde-"+todayStr()+".json";document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(url);if(a.parentNode)a.parentNode.removeChild(a);},1500);
    }catch(e){alert("Export impossible sur ce navigateur.");return;}
    if(!state.config)state.config={};state.config.lastBackup=todayStr();save();
  }
  function importBackupObj(obj){
    if(!obj||obj.app!=="coachmuscu"||!obj.suiviMuscu_v1){alert("Fichier de sauvegarde non reconnu.");return;}
    try{
      localStorage.setItem(KEY,JSON.stringify(obj.suiviMuscu_v1));
      if(obj.planning&&typeof obj.planning==="object"){pMutate(function(o){var pl=obj.planning;
        if(pl.states)Object.keys(pl.states).forEach(function(k){o.states[k]=pl.states[k];});
        if(pl.deadlines)pl.deadlines.forEach(function(d){var hit=null;o.deadlines.forEach(function(e){if(e.id===d.id)hit=e;});if(hit){hit.date=d.date;hit.label=d.label;hit.icon=d.icon;}else o.deadlines.push(d);});
        if(pl.events)pl.events.forEach(function(ev){var f=false;o.events.forEach(function(e){if(e.id===ev.id)f=true;});if(!f)o.events.push(ev);});
        if(pl.seeds)Object.keys(pl.seeds).forEach(function(k){o.seeds[k]=pl.seeds[k];});
      });}
      location.reload();
    }catch(e){alert("Import impossible : "+e.message);}
  }
  function pickImport(){
    var inp=document.createElement("input");inp.type="file";inp.accept="application/json,.json";
    inp.onchange=function(){var f=inp.files&&inp.files[0];if(!f)return;var r=new FileReader();
      r.onload=function(){try{var obj=JSON.parse(r.result);if(confirm("Importer cette sauvegarde ? Tes données actuelles de Coach Muscu seront remplacées (le calendrier partagé est fusionné, pas écrasé)."))importBackupObj(obj);}catch(e){alert("Fichier illisible.");}};
      r.readAsText(f);};
    inp.click();
  }
  function backupStaleDays(){var lb=state.config&&state.config.lastBackup;return lb?diffDays(todayStr(),lb):null;}
  function openSettings(){var s=document.getElementById("settings");if(!s)return;settingsEdit=null;settingsSessSel=null;settingsFoodSel=null;settingsFoodOpen=false;settingsFoodQuery="";settingsQualSel=null;settingsQualOpen=false;settingsQualQuery="";settingsSecOpen={};settingsGrpOpen={};renderSettings();s.hidden=false;requestAnimationFrame(function(){s.classList.add("open");});}
  function openSettingsAt(grp,sec){openSettings();if(grp)settingsGrpOpen[grp]=true;if(sec)settingsSecOpen[sec]=true;renderSettings();var el=document.querySelector('#settingsBody .set-sectog[data-sec="'+sec+'"]');if(el&&el.scrollIntoView)el.scrollIntoView({block:"center"});}  function closeSettings(){var s=document.getElementById("settings");if(!s)return;s.classList.remove("open");setTimeout(function(){s.hidden=true;},260);}

  /* ---------------- Initialisation ---------------- */
  function init(){
    if(!STORAGE_OK){var wb=document.getElementById("warnbar");if(wb)wb.hidden=false;}
    renderApps();
    var mb=document.getElementById("menuBtn");if(mb)mb.addEventListener("click",openDrawer);
    var dcl=document.getElementById("drawerClose");if(dcl)dcl.addEventListener("click",closeDrawer);
    var dbg=document.getElementById("drawerBg");if(dbg)dbg.addEventListener("click",closeDrawer);
    var sb=document.getElementById("settingsBtn");if(sb)sb.addEventListener("click",function(){closeDrawer();openSettings();});
    var sc=document.getElementById("settingsClose");if(sc)sc.addEventListener("click",closeSettings);
    document.addEventListener("keydown",function(e){if(e.key==="Escape"){closeDrawer();closeSettings();closeDaySheet();}});
    document.querySelectorAll(".tab").forEach(function(t){t.addEventListener("click",function(){activateTab(t.getAttribute("data-view"));});});wireSwipe();
    window.addEventListener("resize",function(){if(currentSel)setExoStickyTop();});
    wireBnd();wireAxis();wireStick();syncStickTop();
    var tpt=document.getElementById("triPlanToggle");if(tpt)tpt.addEventListener("click",function(){var c=document.getElementById("triPlanCard"),b=document.getElementById("triPlanBody");var open=!c.classList.contains("open");c.classList.toggle("open",open);b.classList.toggle("collapsed",!open);});
    (function(){var card=document.getElementById("todayNutri"),sp=document.getElementById("stickyProt");
      if(card&&sp&&"IntersectionObserver" in window){
        var io=new IntersectionObserver(function(es){var e=es[0];var onToday=document.getElementById("v-day").classList.contains("active")&&dayDate===todayStr();var show=onToday&&!e.isIntersecting&&e.boundingClientRect.top<60;sp.classList.toggle("show",show);},{rootMargin:"-56px 0px 0px 0px",threshold:0});
        io.observe(card);
      }})();
    var dp=document.getElementById("dayPrev"),dn=document.getElementById("dayNext");
    if(dp)dp.addEventListener("click",function(){dayDate=isoOf(addDays(dayDate,-1));renderDay();window.scrollTo(0,0);});
    if(dn)dn.addEventListener("click",function(){var c=isoOf(addDays(dayDate,1));if(c<=todayStr()){dayDate=c;renderDay();window.scrollTo(0,0);}});
    var csb=document.getElementById("calSheetBg");if(csb)csb.addEventListener("click",closeDaySheet);
    /* Au retour sur l'app (ou si l'autre app a modifié le store partagé), on relit et on rafraîchit. */
    document.addEventListener("visibilitychange",function(){if(!document.hidden)renderCalendars();});
    window.addEventListener("focus",function(){renderCalendars();});
    window.addEventListener("storage",function(e){if(e.key===PKEY||e.key==="memoDSCG_v1")renderCalendars();});
    var dg=document.getElementById("dataGo");if(dg)dg.addEventListener("click",function(){openSettingsAt("g_data","backup");});
    var bc=document.getElementById("bilanCopy");if(bc)bc.addEventListener("click",function(){
      var ta=document.getElementById("bilanText");var txt=ta.value;
      function ok(){bc.textContent="Bilan copié ✓";setTimeout(function(){bc.textContent="Copier le bilan";},1600);}
      function fb(){try{ta.focus();ta.select();document.execCommand("copy");ok();}catch(e){}}
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(ok,fb);}else{fb();}
    });
    pRenameDeadlinesOnce();pEnsureSeed();pMigrateStates();pMigrateDayTypes();seedPlanOnce();loadFoodDB();wireFqTaps();
    if("serviceWorker" in navigator){try{navigator.serviceWorker.register("sw.js").catch(function(){});}catch(e){}}
    activateTab("v-day");
  }
  init();

})();
