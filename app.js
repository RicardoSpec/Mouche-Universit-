/* =========================================================
   Suivi mémoire & révisions DSCG — app.js
   Toute la logique : stockage, calculs, rendu, interactions.
   Dépend de data.js (APPS, MEMO_PARTS, MEMO_GROUPS, CORRECTIONS,
   HISTORY, EXAMS, MEMO_EXAM, EXAM_REVISIONS, DSCG_RULES, HOURS,
   DAY_EXCEPTIONS, COMMON_DAYS, EVENTS, NOTE_CRITERIA, NOTE_LEVELS,
   MEMO_TARGET, MEMO_LIMIT, SNAPSHOT).
   ========================================================= */
"use strict";
(function(){

  /* ---------------- Stockage local ---------------- */
  var KEY = "memoDSCG_v1";
  var STORAGE_OK = (function(){try{var k="__t_"+Date.now();localStorage.setItem(k,"1");localStorage.removeItem(k);return true;}catch(e){return false;}})();
  var memStore = null;
  function rawLoad(){if(!STORAGE_OK)return memStore;try{var r=localStorage.getItem(KEY);return r?JSON.parse(r):null;}catch(e){return null;}}
  function save(){try{var s=JSON.stringify(state);if(STORAGE_OK)localStorage.setItem(KEY,s);else memStore=s;}catch(e){}}

  /* ---------------- Store PARTAGÉ (calendrier commun avec Coach Muscu) ----------------
     Même origine github.io ⇒ même localStorage. RÈGLE ANTI-CLOBBER : toute
     écriture passe par pMutate(fn), qui relit le store FRAIS depuis le disque
     puis ne modifie QUE l'entrée visée (upsert par clé/id). Jamais d'écrasement
     global : Coach Muscu écrit aussi dedans. resetData() n'y touche JAMAIS. */
  var PKEY = "ricardospec_planning_v1";
  var pMem = null; // repli mémoire si localStorage indisponible
  function pNorm(s){ // garantit le squelette SANS perdre les clés inconnues (autre app)
    s=(s&&typeof s==="object")?s:{};
    if(!s.states||typeof s.states!=="object")s.states={};
    if(!Array.isArray(s.events))s.events=[];
    if(!Array.isArray(s.deadlines))s.deadlines=[];
    if(!s.removed||typeof s.removed!=="object")s.removed={};
    if(!s.seeds||typeof s.seeds!=="object")s.seeds={};
    return s;
  }
  function pLoadFresh(){var r=null;try{r=STORAGE_OK?localStorage.getItem(PKEY):pMem;}catch(e){}var s=null;try{s=r?JSON.parse(r):null;}catch(e){}return pNorm(s);}
  var pCache = pNorm(null);
  function pRefresh(){pCache=pLoadFresh();}
  function pMutate(fn){var s=pLoadFresh();fn(s);s.rev=Date.now();try{var j=JSON.stringify(s);if(STORAGE_OK)localStorage.setItem(PKEY,j);else pMem=j;}catch(e){}pCache=s;}

  /* Vocabulaire commun des types de jour (+ migration héritée) */
  var ST_MAP={"occupé":"indispo","occupe":"indispo","vacances":"conge","congé":"conge"};
  var ST_OK={cours:1,conge:1,repos:1,indispo:1};
  function normType(t){t=ST_MAP[t]||t;return ST_OK[t]?t:"";}
  function getDayState(iso){return normType(pCache.states[iso]||"");}
  function setDayState(iso,st){st=normType(st);pMutate(function(s){if(st)s.states[iso]=st;else delete s.states[iso];});}

  /* Étape B : échéances communes (lecture seule — l'édition vit côté Coach Muscu).
     Tri par date, passées filtrées, tombstones (removed) respectés. */
  function pDeadlines(){
    var t=todayISO();
    return pCache.deadlines.filter(function(d){
      return d&&d.date&&d.date>=t&&!(d.id&&pCache.removed[d.id]);
    }).sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0;});
  }

  /* Semis one-shot des exceptions DSCG (garde seeds.dscgExc) — n'écrase jamais l'existant */
  function seedShared(){
    if(pLoadFresh().seeds.dscgExc)return;
    pMutate(function(s){
      if(s.seeds.dscgExc)return;
      for(var iso in DAY_EXCEPTIONS){
        if(s.states[iso])continue; // priorité absolue à ce que le store contient déjà
        var st=normType(DAY_EXCEPTIONS[iso]); // congé→conge · indispo→indispo
        if(st)s.states[iso]=st;
      }
      s.seeds.dscgExc=true;
    });
  }

  /* ---------------- État (valeurs de la feuille + saisies) ---------------- */
  function seedState(){
    var st={parts:{}, corr:[], rev:{}, note:{}, done:{}, ui:{open:{}}};
    MEMO_PARTS.forEach(function(p){st.parts[p.id]=p.pct;});
    CORRECTIONS.forEach(function(){st.corr.push(false);});
    Object.keys(EXAM_REVISIONS).forEach(function(ue){st.rev[ue]=EXAM_REVISIONS[ue].map(function(){return false;});});
    ["forme","fond","soutenance"].forEach(function(g){NOTE_CRITERIA[g].forEach(function(c){st.note[c.id]=c.level;});});
    return st;
  }
  function mergeState(saved){
    var st=seedState();
    if(!saved||typeof saved!=="object")return st;
    if(saved.parts)for(var id in st.parts)if(typeof saved.parts[id]==="number")st.parts[id]=clamp(saved.parts[id]);
    if(Array.isArray(saved.corr))st.corr=st.corr.map(function(v,i){return !!saved.corr[i];});
    if(saved.rev)for(var ue in st.rev)if(Array.isArray(saved.rev[ue]))st.rev[ue]=st.rev[ue].map(function(v,i){return !!saved.rev[ue][i];});
    if(saved.note)for(var cid in st.note)if(typeof saved.note[cid]==="number")st.note[cid]=saved.note[cid];
    if(saved.done&&typeof saved.done==="object")for(var dk in saved.done){var dv=saved.done[dk];if(typeof dv==="number"&&isFinite(dv)&&dv>=0&&/^\d{4}-\d{2}-\d{2}$/.test(dk))st.done[dk]=dv;}
    if(saved.ui&&saved.ui.open&&typeof saved.ui.open==="object")for(var uk in saved.ui.open)st.ui.open[uk]=!!saved.ui.open[uk];
    return st;
  }
  var state = mergeState(rawLoad());
  function isOpen(id){return !!(state.ui&&state.ui.open&&state.ui.open[id]);}

  /* ---------------- Dates ---------------- */
  var JJ=["dim.","lun.","mar.","mer.","jeu.","ven.","sam."];
  var MM=["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
  var MOIS=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  function parseISO(s){return new Date(s+"T00:00:00");}
  function isoOf(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
  function todayISO(){return isoOf(new Date());}
  function daysUntil(iso){return Math.round((parseISO(iso)-parseISO(todayISO()))/86400000);}
  function fmtFR(iso){var d=parseISO(iso);return JJ[d.getDay()]+" "+d.getDate()+" "+MM[d.getMonth()];}
  function ddmm(iso){var d=parseISO(iso);return String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0");}
  function eachDay(a,b,cb){var d=parseISO(a),end=parseISO(b);while(d<=end){cb(isoOf(d));d.setDate(d.getDate()+1);}}

  /* ---------------- Utilitaires ---------------- */
  function esc(s){return (""+(s==null?"":s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function clamp(n){n=Math.round(n/10)*10;return n<0?0:n>100?100:n;}
  function fr(n,dec){return (dec?n.toFixed(dec):Math.round(n)+"").replace(".",",");}
  function frH(h){return (h%1===0?h:h.toFixed(1).replace(".",","))+" h";}
  function gId(id){return document.getElementById(id);}
  function set(id,html){var el=gId(id);if(el)el.innerHTML=html;}

  /* ---------------- Calculs : mémoire ---------------- */
  function partPct(id){return typeof state.parts[id]==="number"?state.parts[id]:0;}
  function memoOverall(){var W=0,WP=0;MEMO_PARTS.forEach(function(p){W+=p.w;WP+=p.w*partPct(p.id)/100;});return W?WP/W*100:0;}
  function groupPct(gid){var W=0,WP=0;MEMO_PARTS.forEach(function(p){if(p.g===gid){W+=p.w;WP+=p.w*partPct(p.id)/100;}});return W?WP/W*100:0;}
  function pagesTotals(){var d=0,t=0;MEMO_PARTS.forEach(function(p){if(p.pages){d+=p.pages.done;t+=p.pages.target;}});return{done:d,target:t};}
  function corrDone(){return state.corr.filter(Boolean).length;}

  /* ---------------- Calculs : calendrier ---------------- */
  function baseType(iso){var wd=parseISO(iso).getDay();return (wd===0||wd===6)?"weekend":"semaine";}
  function dayType(iso){return getDayState(iso)||baseType(iso);} /* semaine|weekend|cours|conge|repos|indispo */
  function dayHours(iso){
    var st=getDayState(iso);
    if(st==="indispo")return 0;
    if(st==="cours")return 0.5;
    if(st==="conge")return 6;
    return HOURS[baseType(iso)]||0; /* repos & normal → base du jour */
  }
  function hoursBetween(a,b){if(parseISO(b)<parseISO(a))return 0;var s=0;eachDay(a,b,function(iso){s+=dayHours(iso);});return s;}
  function daysAvailBetween(a,b){if(parseISO(b)<parseISO(a))return 0;var n=0;eachDay(a,b,function(iso){if(dayHours(iso)>0)n++;});return n;}
  function isCommon(iso){return COMMON_DAYS.indexOf(iso)>=0;}

  /* ---------------- Calculs : examens & note ---------------- */
  function revPct(ue){var a=state.rev[ue]||[];if(!a.length)return 0;return a.filter(Boolean).length/a.length*100;}
  function noteMean(ids){var s=0,n=0;ids.forEach(function(id){var v=state.note[id];if(v>0){s+=v;n++;}});return n?s/n:0;}
  function noteEcrit(){return noteMean(NOTE_CRITERIA.forme.concat(NOTE_CRITERIA.fond).map(function(c){return c.id;}))*10;}
  function noteSout(){return noteMean(NOTE_CRITERIA.soutenance.map(function(c){return c.id;}))*10;}
  function noteGlobal(){return noteEcrit()+noteSout();}

  /* ---------------- Anneau & graphique (SVG) ---------------- */
  function ringSVG(pct){
    var r=48,C=2*Math.PI*r,off=C*(1-Math.max(0,Math.min(100,pct))/100);
    return '<svg viewBox="0 0 108 108"><defs><linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1">'
      +'<stop offset="0" stop-color="#1f6fb0"/><stop offset="1" stop-color="#F4622B"/></linearGradient></defs>'
      +'<circle class="track" cx="54" cy="54" r="'+r+'"/>'
      +'<circle class="fill" cx="54" cy="54" r="'+r+'" stroke-dasharray="'+C.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/></svg>';
  }
  function historySVG(){
    var pts=HISTORY.map(function(h){return{d:h.d,p:h.p};});
    pts.push({d:todayISO(),p:memoOverall()});
    var W=320,H=150,pl=26,pr=8,pt=8,pb=20,iw=W-pl-pr,ih=H-pt-pb;
    var t0=parseISO(pts[0].d).getTime(), t1=parseISO(MEMO_LIMIT).getTime();
    if(t1<=t0)t1=parseISO(pts[pts.length-1].d).getTime()+86400000;
    function X(iso){var t=parseISO(iso).getTime();var f=(t-t0)/(t1-t0);return pl+Math.max(0,Math.min(1,f))*iw;}
    function Y(p){return pt+(1-Math.max(0,Math.min(100,p))/100)*ih;}
    var grid="";[0,25,50,75,100].forEach(function(g){var y=Y(g);grid+='<line x1="'+pl+'" y1="'+y.toFixed(1)+'" x2="'+(W-pr)+'" y2="'+y.toFixed(1)+'" stroke="#eef2f6" stroke-width="1"/>';if(g%50===0)grid+='<text x="'+(pl-5)+'" y="'+(y+3).toFixed(1)+'" font-size="9" fill="#9aa7b3" text-anchor="end">'+g+'</text>';});
    var line=pts.map(function(o,i){return (i?"L":"M")+X(o.d).toFixed(1)+" "+Y(o.p).toFixed(1);}).join(" ");
    var dots=pts.map(function(o){return '<circle cx="'+X(o.d).toFixed(1)+'" cy="'+Y(o.p).toFixed(1)+'" r="2.4" fill="#12466B"/>';}).join("");
    var last=pts[pts.length-1];
    var proj="";
    if(daysUntil(MEMO_TARGET)>0)proj='<line x1="'+X(last.d).toFixed(1)+'" y1="'+Y(last.p).toFixed(1)+'" x2="'+X(MEMO_TARGET).toFixed(1)+'" y2="'+Y(100).toFixed(1)+'" stroke="#F4622B" stroke-width="1.6" stroke-dasharray="3 3"/>'
      +'<circle cx="'+X(MEMO_TARGET).toFixed(1)+'" cy="'+Y(100).toFixed(1)+'" r="2.6" fill="#F4622B"/>'
      +'<text x="'+X(MEMO_TARGET).toFixed(1)+'" y="'+(Y(100)-5).toFixed(1)+'" font-size="8.5" fill="#F4622B" text-anchor="end" font-weight="700">100% • 27/07</text>';
    var xlabs='<text x="'+X(pts[0].d).toFixed(1)+'" y="'+(H-6)+'" font-size="8.5" fill="#9aa7b3">'+ddmm(pts[0].d)+'</text>'
      +'<text x="'+X(last.d).toFixed(1)+'" y="'+(H-6)+'" font-size="8.5" fill="#12466B" text-anchor="middle" font-weight="700">auj.</text>'
      +'<text x="'+(W-pr)+'" y="'+(H-6)+'" font-size="8.5" fill="#9aa7b3" text-anchor="end">'+ddmm(MEMO_LIMIT)+'</text>';
    return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Progression du mémoire">'+grid+proj
      +'<path d="'+line+'" fill="none" stroke="#1f6fb0" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>'+dots+xlabs+'</svg>';
  }

  /* ---------------- Compte à rebours (carte héro) ---------------- */
  function cdBox(iso,label){
    var d=daysUntil(iso);
    var n=d<0?"–":d, u=d<0?"passé":(d===0?"auj.":"jours");
    var urg=d>=0&&d<=14?" urgent":"";
    return '<div class="cd'+urg+'"><div class="n">'+n+'</div><div class="u">'+u+'</div><div class="l">'+esc(label)+'</div></div>';
  }

  /* ---------------- Rendu : en-tête ---------------- */
  function renderHdr(){
    var d=daysUntil(MEMO_TARGET);
    set("hdrChip", d>=0?("Rendu J-"+d):("Limite J-"+Math.max(0,daysUntil(MEMO_LIMIT))));
  }

  /* ---------------- Rendu : Accueil ---------------- */
  function renderHome(){
    var ov=memoOverall(), pg=pagesTotals();
    set("heroCard",
      '<div class="hero"><div class="lbl">Objectif — rendu du mémoire</div>'
      +'<h2>'+fmtFR(MEMO_TARGET)+'</h2>'
      +'<div class="meta">Limite de dépôt : '+fmtFR(MEMO_LIMIT)+'</div>'
      +'<div class="cd-row">'+cdBox(MEMO_TARGET,"Rendu 27/07")+cdBox(MEMO_LIMIT,"Limite 31/08")+cdBox(EXAMS[0].date,"Examens oct.")+'</div>'
      +'<div class="hero-foot">'
        +'<div class="hf"><div class="v">'+fr(ov,1)+'%</div><div class="k">Mémoire</div></div>'
        +'<div class="hf"><div class="v">'+frH(dayHours(todayISO()))+'</div><div class="k">Dispo aujourd\'hui</div></div>'
        +'<div class="hf"><div class="v">'+fr(hoursBetween(todayISO(),MEMO_LIMIT))+' h</div><div class="k">Dispo → 31/08</div></div>'
      +'</div></div>');

    // Étape B : échéances communes (store partagé) + événements locaux à venir.
    // Si le store contient des échéances, il fait foi → on masque les doublons locaux (deadline/exam).
    var dls=pDeadlines();
    var rows=dls.map(function(dd){return {date:dd.date,label:(dd.icon?dd.icon+" ":"")+dd.label,type:"deadline"};})
      .concat(EVENTS.filter(function(e){
        if(daysUntil(e.start)<0)return false;
        if(dls.length&&(e.type==="deadline"||e.type==="exam"))return false;
        return true;
      }).map(function(e){return {date:e.start,label:e.label,type:e.type};}))
      .sort(function(a,b){return a.date<b.date?-1:1;}).slice(0,8);
    set("upNext", rows.length?rows.map(function(r){
      var j=daysUntil(r.date);
      return '<div class="ev-row"><span class="ev-date">J-'+j+'</span><span class="ev-name">'+esc(r.label)+'</span><span class="ev-pill '+r.type+'">'+pillLabel(r.type)+'</span></div>';
    }).join(""):'<p class="muted" style="margin:0">Plus d\'échéance à venir 🎉</p>');

    var ng=noteGlobal();
    set("homeStats",
      stat(fr(ov,1)+'%','Avancement du mémoire')
      +stat(fr(ng,1)+'<span style="font-size:14px;color:var(--muted)">/20</span>','Note projetée')
      +stat(fr(hoursBetween(todayISO(),MEMO_LIMIT))+' h','Heures dispo → 31/08')
      +stat(daysAvailBetween(todayISO(),MEMO_LIMIT)+'','Jours dispo restants'));
  }
  function stat(v,k){return '<div class="stat"><div class="v">'+v+'</div><div class="k">'+esc(k)+'</div></div>';}
  function pillLabel(t){return {ferie:"Férié",perso:"Perso",deadline:"Échéance",exam:"Examen",revision:"Révisions"}[t]||t;}

  /* ---------------- Étape D : journal "révisé aujourd'hui" (local, hors PKEY) ---------------- */
  var DONE_CHOICES=[0,0.5,1,1.5,2,2.5,3,3.5,4,5,6,8];
  function doneToday(){var v=state.done[todayISO()];return typeof v==="number"?v:null;}
  function setDone(h){var k=todayISO();if(h==null)delete state.done[k];else state.done[k]=h;save();renderAll();}
  function weekBounds(){var t=parseISO(todayISO()),wd=(t.getDay()+6)%7,m=new Date(t);m.setDate(t.getDate()-wd);return{a:isoOf(m),b:todayISO()};}
  function renderToday(){
    var cur=doneToday(), plan=dayHours(todayISO());
    var opts='<option value=""'+(cur===null?' selected':'')+'>Non saisi</option>'
      +DONE_CHOICES.map(function(h){var on=(cur!==null&&Math.abs(cur-h)<1e-9);return '<option value="'+h+'"'+(on?' selected':'')+'>'+(h%1===0?h:fr(h,1))+' h</option>';}).join("");
    var wb=weekBounds(), real=0, realW=0, n=0;
    for(var k in state.done){real+=state.done[k];n++;if(k>=wb.a&&k<=wb.b)realW+=state.done[k];}
    var planW=hoursBetween(wb.a,wb.b);
    set("todaySub","— "+fmtFR(todayISO())+" · prévu "+frH(plan));
    set("todayLog",
      '<label class="done-row"><span class="done-lb">Heures faites aujourd\'hui</span>'
      +'<select class="done-select" id="doneSelect" aria-label="Heures révisées aujourd\'hui">'+opts+'</select></label>'
      +'<div class="stat-grid" style="margin-top:12px">'
        +stat(frH(realW)+'<span style="font-size:13px;color:var(--muted)"> / '+frH(planW)+'</span>','Réel / prévu cette semaine')
        +stat(frH(real),'Total saisi · '+n+' j')
      +'</div>');
  }

  /* ---------------- Rendu : Mémoire ---------------- */
  function renderMemo(){
    var ov=memoOverall(), pg=pagesTotals();
    var dAv=daysAvailBetween(todayISO(),MEMO_TARGET);
    var need=dAv>0?(100-ov)/dAv:0;
    set("memoOverall",
      '<div class="ring-wrap"><div class="ring">'+ringSVG(ov)+'<div class="ring-num"><div class="p">'+fr(ov,0)+'%</div><div class="s">avancé</div></div></div>'
      +'<div class="ring-side"><div class="big">Reste '+fr(100-ov,0)+'% avant le rendu</div>'
      +'<div class="sm">'+(dAv>0?('Soit ~<b>'+fr(need,1)+'%</b>/jour dispo d\'ici le 27/07 ('+dAv+' j).'):'Échéance du 27/07 atteinte.')
      +'<br>Pages rédigées : <b>'+fr(pg.done,0)+'</b> / '+pg.target+'.</div></div></div>');
    set("msPct", fr(ov,1)+"%"); set("msRest", "reste "+fr(100-ov,0)+"% avant le rendu");
    var _mf=gId("msFill"); if(_mf)_mf.style.width=Math.max(0,Math.min(100,ov))+"%";

    // Parties par groupe
    var html="";
    MEMO_GROUPS.forEach(function(g){
      var parts=MEMO_PARTS.filter(function(p){return p.g===g.id;});
      if(!parts.length)return;
      var oid="grp_"+g.id, op=isOpen(oid);
      html+='<div class="grp acc'+(op?' open':'')+'"><button class="acc-head" data-acc="'+oid+'" aria-expanded="'+op+'"><span class="acc-title">'+esc(g.label)+'</span><span class="acc-badge push">'+fr(groupPct(g.id),0)+'%</span><span class="chev">›</span></button><div class="acc-body">';
      parts.forEach(function(p){
        var pc=partPct(p.id), full=pc>=100;
        var badge="";
        if(p.pages)badge='<span class="part-pages">'+fr(p.pages.done,0)+'/'+p.pages.target+' p.</span>';
        else if(typeof p.resp==="number")badge='<span class="part-pages">'+fr(p.resp,0)+'% rép.</span>';
        html+='<div class="part"><div class="part-top">'
          +'<div class="part-name">'+esc(p.name)+badge+'</div>'
          +'<div class="part-pct'+(full?' done':'')+'">'+pc+'%</div></div>'
          +'<div class="part-bottom"><div class="part-bar"><div class="part-fill'+(full?' full':'')+'" style="width:'+pc+'%"></div></div>'
          +'<div class="step"><button class="step-btn" data-part="'+p.id+'" data-dir="-1"'+(pc<=0?' disabled':'')+'>−</button>'
          +'<button class="step-btn" data-part="'+p.id+'" data-dir="1"'+(pc>=100?' disabled':'')+'>+</button></div></div></div>';
      });
      html+='</div></div>';
    });
    set("memoParts", html);

    // Corrections
    set("corrCount", "— "+corrDone()+"/"+CORRECTIONS.length+" faites");
    set("corrections", CORRECTIONS.map(function(c,i){
      var ok=state.corr[i];
      return '<label class="check'+(ok?' ok':'')+'"><input type="checkbox" data-corr="'+i+'"'+(ok?' checked':'')+'><span class="ck-txt">'+esc(c)+'</span></label>';
    }).join(""));

    set("histChart", historySVG());
  }

  /* ---------------- Rendu : Examens ---------------- */
  function renderExams(){
    set("examList", EXAMS.map(function(e){
      var d=daysUntil(e.date), urg=d>=0&&d<=21, rp=revPct(e.id), themes=EXAM_REVISIONS[e.id]||[], rev=state.rev[e.id]||[];
      var checks=themes.map(function(t,i){
        var ok=rev[i];
        return '<label class="check'+(ok?' ok':'')+'"><input type="checkbox" data-ue="'+e.id+'" data-idx="'+i+'"'+(ok?' checked':'')+'><span class="ck-txt">'+esc(t)+'</span></label>';
      }).join("");
      return '<div class="card pad"><div class="exam">'
        +'<div class="exam-head"><div class="exam-cd'+(urg?' urgent':'')+'"><div class="n">'+(d<0?"–":d)+'</div><div class="u">'+(d<0?"passé":"jours")+'</div></div>'
        +'<div class="exam-info"><span class="exam-code">'+e.code+'</span>'
        +'<div class="exam-title">'+esc(e.short)+'</div>'
        +'<div class="exam-sub">'+esc(e.name)+'</div>'
        +'<div class="exam-meta"><span class="exam-tag">'+fmtFR(e.date)+'</span><span class="exam-tag">'+e.time+'</span><span class="exam-tag">'+e.duration+'</span><span class="exam-tag">coef '+fr(e.coef,e.coef%1?1:0)+'</span><span class="exam-tag">'+e.ects+' ECTS</span></div>'
        +'</div></div>'
        +'<div class="exam-prog">Révisions : '+rev.filter(Boolean).length+'/'+themes.length+' thèmes · '+fr(rp,0)+'%</div>'
        +'<div class="part-bar" style="margin-top:8px"><div class="part-fill'+(rp>=100?' full':'')+'" style="width:'+rp+'%"></div></div>'
        +'<div style="margin-top:10px">'+checks+'</div>'
        +'</div></div>';
    }).join(""));

    var dS=daysUntil(MEMO_EXAM.date), ng=noteGlobal();
    var elim=ng<DSCG_RULES.eliminatoire, pass=ng>=DSCG_RULES.moyenne;
    set("examFoot",
      '<div class="sec-title">Soutenance & validation</div>'
      +'<div class="exam" style="border-top:none;padding-top:0"><div class="exam-head">'
      +'<div class="exam-cd'+(dS>=0&&dS<=21?' urgent':'')+'"><div class="n">'+(dS<0?"–":dS)+'</div><div class="u">'+(dS<0?"passé":"jours")+'</div></div>'
      +'<div class="exam-info"><span class="exam-code">'+MEMO_EXAM.code+'</span><div class="exam-title">'+esc(MEMO_EXAM.name)+'</div>'
      +'<div class="exam-meta"><span class="exam-tag">'+fmtFR(MEMO_EXAM.date)+'</span><span class="exam-tag">'+MEMO_EXAM.duration+'</span><span class="exam-tag">coef '+MEMO_EXAM.coef+'</span><span class="exam-tag">'+MEMO_EXAM.ects+' ECTS</span></div>'
      +'</div></div></div>'
      +'<div style="margin-top:12px;font-size:13px;color:var(--muted);line-height:1.5">Diplôme validé si <b style="color:var(--ink)">moyenne générale ≥ 10/20</b> et <b style="color:var(--ink)">aucune note &lt; 6/20</b> (éliminatoire).</div>'
      +'<div style="margin-top:10px;padding:11px 13px;border-radius:11px;background:'+(elim?'#fdecea':pass?'#e2f3ea':'#fff3e8')+';font-size:13px;font-weight:700;color:'+(elim?'var(--danger)':pass?'var(--done-ink)':'var(--accent)')+'">Note mémoire projetée : '+fr(ng,1)+'/20 '+(elim?'— ⚠ sous le seuil éliminatoire':pass?'— au-dessus de la moyenne ✓':'— sous la moyenne (10), à remonter')+'</div>');
  }

  /* ---------------- Rendu : Planning ---------------- */
  var _n=new Date(), calY=_n.getFullYear(), calM=_n.getMonth(); // ouvre sur le mois courant
  function renderPlanning(){
    var first=new Date(calY,calM,1), nb=new Date(calY,calM+1,0).getDate();
    var off=(first.getDay()+6)%7; // lundi = 0
    set("calMonth", MOIS[calM]+" "+calY);
    var cells="";
    for(var i=0;i<off;i++)cells+='<div class="cal-cell empty"></div>';
    for(var day=1;day<=nb;day++){
      var iso=calY+"-"+String(calM+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
      var t=dayType(iso), h=dayHours(iso);
      var cls="cal-cell "+t+(iso===todayISO()?" today":"");
      var ev=EVENTS.some(function(e){return iso>=e.start&&iso<=(e.end||e.start);});
      cells+='<div class="'+cls+'" data-iso="'+iso+'" role="button" aria-label="'+fmtFR(iso)+'"><div class="d">'+day+'</div><div class="h">'+(h%1===0?h:fr(h,1))+'h</div>'
        +(isCommon(iso)?'<span class="dot" title="Jour commun Tina"></span>':'')
        +(ev?'<span class="ev"></span>':'')+'</div>';
    }
    set("calGrid", cells);

    // Heures dispo (stats)
    var mEnd=calY+"-"+String(calM+1).padStart(2,"0")+"-"+String(nb).padStart(2,"0");
    var mStart=calY+"-"+String(calM+1).padStart(2,"0")+"-01";
    set("planStats",
      stat(fr(hoursBetween(todayISO(),MEMO_TARGET))+' h','Dispo → 27/07 (rendu)')
      +stat(fr(hoursBetween(todayISO(),MEMO_LIMIT))+' h','Dispo → 31/08 (limite)')
      +stat(daysAvailBetween(todayISO(),MEMO_LIMIT)+'','Jours dispo restants')
      +stat(fr(hoursBetween(mStart,mEnd))+' h','Total ce mois-ci'));

    // Événements du mois
    set("evTitle", "Événements — "+MOIS[calM]);
    var evs=EVENTS.filter(function(e){var s=e.start,en=e.end||e.start;return (s>=mStart&&s<=mEnd)||(en>=mStart&&en<=mEnd)||(s<mStart&&en>mEnd);}).sort(function(a,b){return a.start<b.start?-1:1;});
    set("evList", evs.length?evs.map(function(e){
      var dt=e.end?(ddmm(e.start)+"–"+ddmm(e.end)):ddmm(e.start);
      return '<div class="ev-row"><span class="ev-date">'+dt+'</span><span class="ev-name">'+esc(e.label)+'</span><span class="ev-pill '+e.type+'">'+pillLabel(e.type)+'</span></div>';
    }).join(""):'<p class="muted" style="margin:0">Aucun événement ce mois-ci.</p>');
  }
  function calShift(n){var d=new Date(calY,calM+n,1);calY=d.getFullYear();calM=d.getMonth();renderPlanning();}

  /* ---------------- Rendu : Note ---------------- */
  var LVL_SHORT={"0.2":"TI","0.4":"I","0.6":"S","0.8":"B","1":"TB"};
  function lvlLabel(v){var f=NOTE_LEVELS.filter(function(l){return l.v===v;})[0];return f?f.label:"—";}
  function renderNote(){
    var ec=noteEcrit(), so=noteSout(), gl=noteGlobal();
    var elim=gl<DSCG_RULES.eliminatoire, pass=gl>=DSCG_RULES.moyenne;
    set("noteOut",
      '<div class="note-out"><div class="note-box"><div class="v">'+fr(ec,1)+'<small>/10</small></div><div class="k">Écrit (forme + fond)</div></div>'
      +'<div class="note-box alt"><div class="v">'+fr(so,1)+'<small>/10</small></div><div class="k">Soutenance</div></div></div>'
      +'<div class="note-global '+(pass?'pass':'fail')+'"><div class="v">'+fr(gl,1)+'<small>/20</small></div>'
      +'<div class="k">'+(elim?'⚠ Sous le seuil éliminatoire (6/20)':pass?'Au-dessus de la moyenne (10/20) ✓':'Sous la moyenne (10/20) — à remonter')+'</div></div>');
    renderCrit("critForme", NOTE_CRITERIA.forme);
    renderCrit("critFond", NOTE_CRITERIA.fond);
    renderCrit("critSout", NOTE_CRITERIA.soutenance);
  }
  function renderCrit(host, list){
    set(host, list.map(function(c){
      var cur=state.note[c.id]||0;
      var segs=NOTE_LEVELS.filter(function(l){return l.v>0;}).map(function(l){
        var on=Math.abs(cur-l.v)<1e-9;
        return '<button class="seg-btn'+(on?' on':'')+'" data-crit="'+c.id+'" data-lvl="'+l.v+'">'+(LVL_SHORT[(""+l.v)]||l.v)+'</button>';
      }).join("");
      var cap=cur>0?('Niveau : <b>'+esc(lvlLabel(cur))+'</b>'):'<i>Non noté — touche un niveau (re-touche pour effacer)</i>';
      return '<div class="crit"><div class="crit-name">'+esc(c.label)+'</div><div class="seg">'+segs+'</div><div class="seg-cap">'+cap+'</div></div>';
    }).join(""));
  }

  /* ---------------- Bilan à copier ---------------- */
  function buildBilan(){
    var ov=memoOverall(), pg=pagesTotals(), ng=noteGlobal();
    var L=[];
    L.push("SUIVI MÉMOIRE & RÉVISIONS DSCG — "+fmtFR(todayISO()));
    L.push("");
    L.push("MÉMOIRE : "+fr(ov,1)+"% global");
    L.push("• Rendu 27/07 : J-"+daysUntil(MEMO_TARGET)+" · Limite 31/08 : J-"+daysUntil(MEMO_LIMIT));
    L.push("• Pages rédigées : "+fr(pg.done,0)+"/"+pg.target);
    L.push("• Note projetée : "+fr(ng,1)+"/20 (écrit "+fr(noteEcrit(),1)+" + soutenance "+fr(noteSout(),1)+")");
    var todo=MEMO_PARTS.filter(function(p){return partPct(p.id)<100;});
    if(todo.length){
      L.push("• Parties à finir :");
      todo.forEach(function(p){L.push("   - "+p.name.replace(/\s+/g," ")+" : "+partPct(p.id)+"%");});
    }
    var cr=CORRECTIONS.filter(function(c,i){return !state.corr[i];});
    L.push("• Corrections restantes : "+cr.length+"/"+CORRECTIONS.length);
    cr.forEach(function(c){L.push("   - "+c);});
    L.push("");
    L.push("EXAMENS (oct.) : J-"+daysUntil(EXAMS[0].date));
    EXAMS.forEach(function(e){var r=state.rev[e.id]||[];L.push("• "+e.short+" "+e.code+" ("+ddmm(e.date)+") : "+r.filter(Boolean).length+"/"+r.length+" thèmes révisés");});
    L.push("• Soutenance : "+fmtFR(MEMO_EXAM.date));
    L.push("");
    L.push("PLANNING : "+fr(hoursBetween(todayISO(),MEMO_LIMIT))+" h dispo d'ici le 31/08 sur "+daysAvailBetween(todayISO(),MEMO_LIMIT)+" jours.");
    var _r=0,_n=0;for(var _k in state.done){_r+=state.done[_k];_n++;}
    if(_n)L.push("• Heures réellement saisies : "+frH(_r)+" sur "+_n+" j");
    return L.join("\n");
  }
  function renderBilan(){var el=gId("bilanText");if(el)el.value=buildBilan();}

  /* ---------------- Rendu global ---------------- */
  function renderAll(){renderHdr();renderHome();renderToday();renderMemo();renderExams();renderPlanning();renderNote();renderBilan();}

  /* ---------------- Interactions : état ---------------- */
  function stepPart(id,dir){if(!(id in state.parts))return;state.parts[id]=clamp(state.parts[id]+dir*10);save();renderAll();}
  function toggleCorr(i){state.corr[i]=!state.corr[i];save();renderAll();}
  function toggleRev(ue,i){if(!state.rev[ue])return;state.rev[ue][i]=!state.rev[ue][i];save();renderAll();}
  function setLevel(id,v){state.note[id]=(Math.abs((state.note[id]||0)-v)<1e-9)?0:v;save();renderAll();}

  /* ---------------- Export / Import / Reset ---------------- */
  function exportData(){
    try{
      var blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
      var url=URL.createObjectURL(blob), a=document.createElement("a");
      a.href=url;a.download="memoire-dscg-"+todayISO()+".json";document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(url);a.remove();},100);
    }catch(e){alert("Export impossible sur ce navigateur.");}
  }
  function importData(file){
    var fr2=new FileReader();
    fr2.onload=function(){try{state=mergeState(JSON.parse(fr2.result));save();renderAll();alert("Données importées ✅");}catch(e){alert("Fichier invalide.");}};
    fr2.readAsText(file);
  }
  function resetData(){
    if(!confirm("Réinitialiser toutes tes saisies avec les valeurs de la feuille ? (corrections, révisions et curseurs reviennent à l'état de départ ; le journal d'heures est conservé)"))return;
    // NB : ne touche volontairement PAS au store partagé PKEY, ni au journal d'heures (state.done).
    var keepDone=state.done;state=seedState();state.done=keepDone;save();renderAll();
  }

  /* ---------------- Étape A : édition du type de jour (bottom-sheet) ---------------- */
  var DAY_TYPES=[
    {id:"",        label:"Normal",           ic:"—"},
    {id:"cours",   label:"Cours / travail",  ic:"📚"},
    {id:"conge",   label:"Congé",            ic:"🏖️"},
    {id:"repos",   label:"Repos",            ic:"😴", note:"sport bloqué"},
    {id:"indispo", label:"Indisponible",     ic:"🚫", note:"sport bloqué"}
  ];
  var sheetIso=null;
  function typeHours(iso,id){
    if(id==="indispo")return "0 h";
    if(id==="cours")return "0,5 h";
    if(id==="conge")return "6 h";
    return frH(HOURS[baseType(iso)]||0); /* Normal / Repos → base du jour */
  }
  function openDaySheet(iso){
    sheetIso=iso;
    var cur=getDayState(iso);
    set("sheetTitle", fmtFR(iso));
    set("sheetOpts", DAY_TYPES.map(function(t){
      var on=(cur===t.id);
      return '<button class="sh-opt'+(on?' on':'')+'" data-type="'+t.id+'">'
        +'<span class="sh-ic">'+t.ic+'</span><span class="sh-lb">'+esc(t.label)+'</span>'
        +'<span class="sh-h">'+typeHours(iso,t.id)+(t.note?' · '+t.note:'')+'</span></button>';
    }).join(""));
    var bg=gId("sheetBg"),sh=gId("daySheet");if(!bg||!sh)return;
    bg.hidden=false;sh.hidden=false;
    requestAnimationFrame(function(){bg.classList.add("open");sh.classList.add("open");});
  }
  function closeDaySheet(){
    var bg=gId("sheetBg"),sh=gId("daySheet");if(!bg||!sh||sh.hidden)return;
    bg.classList.remove("open");sh.classList.remove("open");sheetIso=null;
    setTimeout(function(){bg.hidden=true;sh.hidden=true;},220);
  }

  /* ---------------- Menu lanceur d'apps ---------------- */
  function renderApps(){
    var host=gId("appList");if(!host||typeof APPS==="undefined")return;
    host.innerHTML=APPS.map(function(a){
      var ic='<span class="app-ic">'+esc(a.icon||(a.name||"?").charAt(0))+'</span>';
      var nm='<span class="app-name">'+esc(a.name)+'</span>';
      if(a.here)return '<div class="app-item here">'+ic+nm+'</div>';
      if(a.ready&&a.url)return '<a class="app-item" href="'+esc(a.url)+'">'+ic+nm+'<span class="app-arrow">›</span></a>';
      return '<div class="app-item soon">'+ic+nm+'<span class="app-badge">bientôt</span></div>';
    }).join("");
  }
  function openDrawer(){var d=gId("drawer"),bg=gId("drawerBg"),b=gId("menuBtn");if(!d||!bg)return;bg.hidden=false;d.hidden=false;requestAnimationFrame(function(){bg.classList.add("open");d.classList.add("open");});if(b)b.setAttribute("aria-expanded","true");}
  function closeDrawer(){var d=gId("drawer"),bg=gId("drawerBg"),b=gId("menuBtn");if(!d||!bg)return;bg.classList.remove("open");d.classList.remove("open");if(b)b.setAttribute("aria-expanded","false");setTimeout(function(){bg.hidden=true;d.hidden=true;},240);}

  /* ---------------- Onglets ---------------- */
  function headerH(){var h=document.querySelector(".top");return h?h.offsetHeight:56;}
  var _stickTick=false;
  function updateMemoSticky(){
    _stickTick=false;
    var view=gId("v-memoire"), bar=gId("memoSticky"), ring=gId("memoOverall");
    if(!view||!bar||!ring)return;
    var th=headerH(); bar.style.top=th+"px";
    var show=view.classList.contains("active") && ring.getBoundingClientRect().bottom < th+4;
    bar.classList.toggle("show",show); bar.setAttribute("aria-hidden",show?"false":"true");
  }
  function onScroll(){if(!_stickTick){_stickTick=true;(window.requestAnimationFrame||function(f){f();})(updateMemoSticky);}}
  function activateTab(view){
    document.querySelectorAll(".view").forEach(function(v){v.classList.toggle("active",v.id===view);});
    document.querySelectorAll(".tab").forEach(function(t){t.classList.toggle("on",t.getAttribute("data-view")===view);});
    window.scrollTo(0,0);
    updateMemoSticky();
  }

  /* ---------------- Initialisation ---------------- */
  function init(){
    if(!STORAGE_OK){var wb=gId("warnbar");if(wb)wb.hidden=false;}
    renderApps();
    [["accCorr","corr"],["accNoteForme","note_forme"],["accNoteFond","note_fond"],["accNoteSout","note_sout"]].forEach(function(p){
      var card=gId(p[0]);if(!card)return;var op=isOpen(p[1]);card.classList.toggle("open",op);
      var h=card.querySelector(".acc-head");if(h)h.setAttribute("aria-expanded",op);
    });
    var mb=gId("menuBtn");if(mb)mb.addEventListener("click",openDrawer);
    var dcl=gId("drawerClose");if(dcl)dcl.addEventListener("click",closeDrawer);
    var dbg=gId("drawerBg");if(dbg)dbg.addEventListener("click",closeDrawer);
    document.addEventListener("keydown",function(e){if(e.key==="Escape"){closeDrawer();closeDaySheet();}});
    document.querySelectorAll(".tab").forEach(function(t){t.addEventListener("click",function(){activateTab(t.getAttribute("data-view"));});});

    var cp=gId("calPrev"),cn=gId("calNext");
    if(cp)cp.addEventListener("click",function(){calShift(-1);});
    if(cn)cn.addEventListener("click",function(){calShift(1);});

    var be=gId("btnExport");if(be)be.addEventListener("click",exportData);
    var fi=gId("fileImport");if(fi)fi.addEventListener("change",function(){if(this.files&&this.files[0])importData(this.files[0]);this.value="";});
    var br=gId("btnReset");if(br)br.addEventListener("click",resetData);
    var bc=gId("bilanCopy");if(bc)bc.addEventListener("click",function(){
      var ta=gId("bilanText");if(!ta)return;
      function done(){bc.textContent="Copié ✅";setTimeout(function(){bc.textContent="Copier le bilan";},1600);}
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ta.value).then(done).catch(function(){ta.select();try{document.execCommand("copy");}catch(e){}done();});}
      else{ta.select();try{document.execCommand("copy");}catch(e){}done();}
    });

    // Délégation : steppers, segments, cases à cocher
    var main=document.querySelector("main");
    if(main){
      main.addEventListener("click",function(e){
        var ah=e.target.closest&&e.target.closest(".acc-head[data-acc]");
        if(ah){var aid=ah.getAttribute("data-acc"),acc=ah.closest(".acc");if(acc){var op=!acc.classList.contains("open");acc.classList.toggle("open",op);ah.setAttribute("aria-expanded",op);state.ui.open[aid]=op;save();}return;}
        var s=e.target.closest&&e.target.closest(".step-btn");if(s){stepPart(s.getAttribute("data-part"),parseInt(s.getAttribute("data-dir"),10));return;}
        var g=e.target.closest&&e.target.closest(".seg-btn[data-crit]");if(g){setLevel(g.getAttribute("data-crit"),parseFloat(g.getAttribute("data-lvl")));return;}
      });
      main.addEventListener("change",function(e){
        var t=e.target;
        if(t.id==="doneSelect"){setDone(t.value===""?null:parseFloat(t.value));return;}
        if(t.matches&&t.matches("input[data-corr]")){toggleCorr(parseInt(t.getAttribute("data-corr"),10));return;}
        if(t.matches&&t.matches("input[data-ue]")){toggleRev(t.getAttribute("data-ue"),parseInt(t.getAttribute("data-idx"),10));return;}
      });
    }

    // Étape A : tap sur un jour → bottom-sheet type de jour
    var grid=gId("calGrid");
    if(grid)grid.addEventListener("click",function(e){
      var c=e.target.closest&&e.target.closest(".cal-cell[data-iso]");
      if(c)openDaySheet(c.getAttribute("data-iso"));
    });
    var shx=gId("sheetClose");if(shx)shx.addEventListener("click",closeDaySheet);
    var shb=gId("sheetBg");if(shb)shb.addEventListener("click",closeDaySheet);
    var sho=gId("sheetOpts");
    if(sho)sho.addEventListener("click",function(e){
      var b=e.target.closest&&e.target.closest(".sh-opt");
      if(!b||sheetIso==null)return;
      setDayState(sheetIso,b.getAttribute("data-type"));
      closeDaySheet();
      renderAll(); // Planning + Accueil (heures, stats, bilan) se recalculent
    });

    // Store partagé : semis one-shot + rafraîchissement quand Coach Muscu écrit
    window.addEventListener("scroll",onScroll,{passive:true});
    window.addEventListener("resize",updateMemoSticky);
    seedShared();pRefresh();
    window.addEventListener("storage",function(e){if(e.key===PKEY){pRefresh();renderAll();}});
    document.addEventListener("visibilitychange",function(){if(!document.hidden){pRefresh();renderAll();}});
    window.addEventListener("focus",function(){pRefresh();renderAll();});

    renderAll();
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();

})();
