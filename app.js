/* =========================================================
   Suivi mémoire & révisions DSCG — data.js
   Données uniquement (aucune logique). Chargé AVANT app.js.
   Source : Google Sheet "Récap / Calendrier / Notation".
   ========================================================= */

/* ---------- Mes autres apps (menu lanceur ☰) ----------
   here:true = app courante · ready:true + url = cliquable · ready:false = "bientôt". */
var APPS = [
  {name:"Musculation",               icon:"💪", ready:true,  url:"https://ricardospec.github.io/coachmuscu/"},
  {name:"Français — L'Atelier",      icon:"✏️", ready:true,  url:"https://ricardospec.github.io/Lateliergram/"},
  {name:"Anglais — English Fly",     icon:"🇬🇧", ready:true,  url:"https://ricardospec.github.io/English-Fly/"},
  {name:"Budget — Grand livre",      icon:"💶", ready:true,  url:"https://ricardospec.github.io/Budgetisation/"},
  {name:"Suivi mémoire & révisions", icon:"📚", here:true},
  {name:"Espagnol",                  icon:"🇪🇸", ready:false}
];

/* ---------- Échéances & constantes ---------- */
var MEMO_TARGET = "2026-07-27";   // objectif perso de rendu
var MEMO_LIMIT  = "2026-08-31";   // limite de dépôt (feuille)
var SNAPSHOT    = "2026-06-20";   // date de la photo du tableur

/* Matrice de conversion : type de jour -> heures dispo (feuille "Calendrier") */
var HOURS = { semaine:0.5, weekend:6, "congé":6, indispo:0 };

/* =========================================================
   1) AVANCEMENT DU MÉMOIRE
   Chaque partie : poids d'effort (w) + % d'avancement (pct).
   % global = Σ(w × pct) / Σ(w).   (pages = info secondaire)

   NB cohérence : l'en-tête de la feuille affiche "32,06 %"
   (dernier relevé MANUEL du 15/06). Les cases par partie
   ci-dessous calculent ≈ 42 %, ce qui correspond au point
   du 20/06 sur la courbe de progression. Tout est modifiable.
   ========================================================= */
var MEMO_GROUPS = [
  {id:"lim",     label:"Éléments liminaires"},
  {id:"intro",   label:"Introduction"},
  {id:"p1",      label:"Partie 1"},
  {id:"p2",      label:"Partie 2"},
  {id:"concl",   label:"Conclusion"},
  {id:"ann",     label:"Annexes & bibliographie"},
  {id:"terrain", label:"Études terrain"},
  {id:"corr",    label:"Corrections"}
];

var MEMO_PARTS = [
  {id:"miseenpage", g:"lim", name:"Mise en page du mémoire",     w:0.1, pct:60},
  {id:"garde",      g:"lim", name:"Page de garde, glossaire",    w:0.2, pct:90},
  {id:"confid",     g:"lim", name:"Note de confidentialité",     w:0.1, pct:90},
  {id:"remer",      g:"lim", name:"Remerciements",               w:0.5, pct:90},
  {id:"tdm",        g:"lim", name:"Table des matières",          w:0.5, pct:30},
  {id:"tdi",        g:"lim", name:"Table des illustrations",     w:0.5, pct:10},
  {id:"tableaux",   g:"lim", name:"Tableaux",                    w:0.5, pct:10},
  {id:"avpropos",   g:"lim", name:"Avant-propos",                w:1.0, pct:90},
  {id:"attest",     g:"lim", name:"Attestation de l'employeur",  w:0.5, pct:60},
  {id:"agrement",   g:"lim", name:"Fiche d'agrément",            w:2.0, pct:80},
  {id:"missions",   g:"lim", name:"Missions cabinet",            w:1.0, pct:30},

  {id:"intro",      g:"intro", name:"Introduction",              w:2.0, pct:90, pages:{done:3.5, target:4}},

  {id:"p1c1", g:"p1", name:"Chap. I — Une fondation solide pour des informations fiables et régulières", w:10, pct:70, pages:{done:8, target:8}},
  {id:"p1c2", g:"p1", name:"Chap. II — L'harmonisation des procédures (efficience & pérennisation)",      w:10, pct:70, pages:{done:6, target:7}},
  {id:"p1c3", g:"p1", name:"Chap. III — De la mesure à la valorisation (image fidèle, pilotage)",         w:10, pct:70, pages:{done:5, target:7}},

  {id:"p2c1", g:"p2", name:"Chap. I — Méthodologie de la recherche & collecte des données", w:10, pct:30, pages:{done:5, target:5}},
  {id:"p2c2", g:"p2", name:"Chap. II — Analyse des résultats & vérification des hypothèses", w:10, pct:30, pages:{done:9, target:9}},
  {id:"p2c3", g:"p2", name:"Chap. III — Optimisations opérationnelles & perspectives",       w:10, pct:30, pages:{done:7, target:7}},

  {id:"concl",   g:"concl", name:"Conclusion",                   w:5.0, pct:10, pages:{done:0, target:1}},

  {id:"annexes", g:"ann", name:"Table des annexes",              w:5.0, pct:20, pages:{done:43.5, target:48}},
  {id:"biblio",  g:"ann", name:"Bibliographie",                  w:1.0, pct:20},

  {id:"sondage", g:"terrain", name:"Sondage",                    w:10, pct:10, resp:22},
  {id:"itw",     g:"terrain", name:"Enquête / entretiens",       w:10, pct:40, resp:16.67},

  {id:"corr",    g:"corr", name:"Traiter les prochaines corrections", w:2.0, pct:10}
];

/* ---------- Corrections à traiter (checklist "Prochaines corrections") ---------- */
var CORRECTIONS = [
  "Faire des phrases courtes",
  "Reprendre tous les commentaires → version finale intégrant les commentaires",
  "Vérifier la retranscription des entretiens (itw)",
  "Vérifier la suppression des sources .com (BCG)",
  "Conserver les échanges avec l'IA",
  "Faire des phrases de transition avant les hypothèses de recherche (HR)",
  "Mettre à jour le numéro des tableaux, figures et annexes",
  "Vérifier que les locutions latines et les citations sont en italique (et les vérifier)"
];

/* ---------- Historique d'avancement (relevés réels de la feuille) ---------- */
var HISTORY = [
  {d:"2026-04-26", p:3.88},
  {d:"2026-04-27", p:4.00},
  {d:"2026-05-14", p:11.25},
  {d:"2026-05-15", p:12.37},
  {d:"2026-05-16", p:16.90},
  {d:"2026-05-18", p:18.02},
  {d:"2026-05-23", p:19.15},
  {d:"2026-05-24", p:19.15},
  {d:"2026-05-25", p:27.74},
  {d:"2026-05-30", p:27.74},
  {d:"2026-05-31", p:27.74},
  {d:"2026-06-07", p:28.14},
  {d:"2026-06-15", p:32.06}
];

/* =========================================================
   2) EXAMENS DSCG — session 2026 (BO n°1 du 01/01/2026)
   Écrits 27–29 oct. · oraux (anglais & soutenance) dès le 02 nov.
   ========================================================= */
var EXAMS = [
  {id:"ue1", code:"UE1", short:"Droit", name:"Gestion juridique, fiscale et sociale", date:"2026-10-28", time:"14h–18h",     duration:"4h", coef:1.5, ects:20},
  {id:"ue5", code:"UE5", short:"MSI",   name:"Management des systèmes d'information", date:"2026-10-29", time:"9h30–12h30", duration:"3h", coef:1,   ects:15},
  {id:"ue3", code:"UE3", short:"MCG",   name:"Management & contrôle de gestion",      date:"2026-10-29", time:"14h–18h",     duration:"4h", coef:1.5, ects:20}
];
var MEMO_EXAM = {code:"UE7", name:"Mémoire — soutenance orale", date:"2026-11-02", duration:"1h max", coef:1, ects:15};

/* Validation du diplôme : moyenne générale ≥ 10/20 · note éliminatoire < 6/20. */
var DSCG_RULES = {moyenne:10, eliminatoire:6};

/* ---------- Révisions : thèmes de départ par UE (programme DSCG, modifiables) ---------- */
var EXAM_REVISIONS = {
  ue1: [
    "L'entreprise & son environnement juridique (contrats, responsabilité)",
    "Droit des sociétés (constitution, fonctionnement, restructurations)",
    "Pérennité de l'entreprise (difficultés, transmission)",
    "Associations & autres groupements",
    "Droit fiscal (IS, IR, TVA, intégration, fiscalité internationale)",
    "Droit social (relations individuelles & collectives, protection sociale)"
  ],
  ue5: [
    "Gouvernance & alignement stratégique des SI",
    "Gestion de projet SI",
    "Architecture, réseaux & ERP",
    "Sécurité des SI",
    "Données, dématérialisation & RGPD",
    "Audit & contrôle des SI"
  ],
  ue3: [
    "Diagnostic & analyse stratégique",
    "Choix stratégiques & gouvernance",
    "Pilotage de la performance (coûts, budgets)",
    "Tableaux de bord & reporting",
    "Conduite du changement & structures",
    "Management des activités & des processus"
  ]
};

/* =========================================================
   3) PLANNING — jours & heures dispo (feuille "Calendrier")
   Type par défaut : lun–ven = semaine, sam–dim = weekend.
   DAY_EXCEPTIONS surcharge le défaut (congé / indispo).
   COMMON_DAYS = jours "ok" communs avec Tina (repère 🟢).
   ========================================================= */
var DAY_EXCEPTIONS = {
  "2026-05-01":"congé","2026-05-03":"indispo","2026-05-08":"indispo","2026-05-09":"indispo","2026-05-10":"indispo",
  "2026-05-14":"congé","2026-05-15":"congé","2026-05-25":"congé",
  "2026-06-06":"indispo","2026-06-22":"congé",
  "2026-06-23":"indispo","2026-06-24":"indispo","2026-06-25":"indispo","2026-06-26":"indispo","2026-06-27":"indispo","2026-06-28":"indispo",
  "2026-07-04":"indispo","2026-07-05":"indispo","2026-07-13":"congé","2026-07-14":"congé",
  "2026-07-27":"congé","2026-07-28":"congé","2026-07-29":"congé","2026-07-30":"congé","2026-07-31":"congé",
  "2026-08-01":"congé","2026-08-02":"congé","2026-08-03":"congé","2026-08-04":"congé",
  "2026-08-05":"indispo","2026-08-06":"indispo","2026-08-07":"indispo","2026-08-08":"indispo",
  "2026-08-09":"indispo","2026-08-10":"indispo","2026-08-11":"indispo","2026-08-12":"indispo",
  "2026-08-13":"congé","2026-08-14":"congé","2026-08-15":"congé","2026-08-16":"congé","2026-08-17":"congé"
};

var COMMON_DAYS = [
  "2026-04-25","2026-04-26","2026-05-01","2026-05-02","2026-05-14","2026-05-15","2026-05-16","2026-05-17",
  "2026-05-30","2026-05-31","2026-06-07","2026-06-20","2026-06-21",
  "2026-07-11","2026-07-12","2026-07-13","2026-07-14","2026-07-18","2026-07-19",
  "2026-07-25","2026-07-26","2026-07-27","2026-07-28","2026-07-29","2026-07-30","2026-07-31",
  "2026-08-01","2026-08-02","2026-08-03","2026-08-22","2026-08-23","2026-08-29","2026-08-30"
];

/* ---------- Événements & jalons ---------- */
var EVENTS = [
  {start:"2026-05-01", label:"Férié — 1er mai", type:"ferie"},
  {start:"2026-05-03", label:"Triathlon", type:"perso"},
  {start:"2026-05-08", end:"2026-05-10", label:"WK Surf", type:"perso"},
  {start:"2026-05-14", label:"Férié — Ascension", type:"ferie"},
  {start:"2026-05-25", label:"Férié — Pentecôte", type:"ferie"},
  {start:"2026-06-06", label:"Gala Tina", type:"perso"},
  {start:"2026-06-23", end:"2026-06-28", label:"Escalade", type:"perso"},
  {start:"2026-07-04", label:"Théâtre Nico", type:"perso"},
  {start:"2026-07-05", label:"Vide-maison maman", type:"perso"},
  {start:"2026-07-14", label:"Férié — 14 juillet", type:"ferie"},
  {start:"2026-07-27", label:"🎯 Rendu mémoire (objectif)", type:"deadline"},
  {start:"2026-08-05", end:"2026-08-08", label:"Vacances (sans révision)", type:"perso"},
  {start:"2026-08-09", end:"2026-08-12", label:"Révisions exams", type:"revision"},
  {start:"2026-08-31", label:"⏳ Limite dépôt mémoire", type:"deadline"},
  {start:"2026-10-28", label:"Examen Droit — UE1", type:"exam"},
  {start:"2026-10-29", label:"Examens MSI (UE5) & MCG (UE3)", type:"exam"},
  {start:"2026-11-02", label:"Soutenance mémoire", type:"exam"}
];

/* =========================================================
   4) NOTATION — simulateur /20 (feuille "Notation")
   Note /10 = moyenne des niveaux notés × 10.
   Écrit = forme + fond  ·  Soutenance = 4 critères.
   Globale = écrit + soutenance.
   État actuel de la feuille : 6,2 (écrit) + 6,0 (soutenance) = 12,2/20.
   ========================================================= */
var NOTE_LEVELS = [
  {v:0,   label:"—"},
  {v:0.2, label:"Très insuffisant"},
  {v:0.4, label:"Insuffisant"},
  {v:0.6, label:"Satisfaisant"},
  {v:0.8, label:"Bien"},
  {v:1.0, label:"Très bien"}
];

var NOTE_CRITERIA = {
  forme: [
    {id:"f1", label:"Respect des normes de communication (bibliographie APA, sommaire & table paginés)", level:0.8},
    {id:"f2", label:"Qualité de la présentation écrite (lisibilité, illustrations, structure, annexes)", level:0.8},
    {id:"f3", label:"Qualité de l'expression écrite (orthographe, syntaxe, clarté)", level:0.8}
  ],
  fond: [
    {id:"d1", label:"Présentation des missions réalisées dans la structure d'accueil", level:0},
    {id:"d2", label:"Traitement du sujet", level:0.8},
    {id:"d3", label:"Formuler une problématique pertinente", level:0.6},
    {id:"d4", label:"Choisir des références bibliographiques pertinentes", level:0.4},
    {id:"d5", label:"Méthodologie & qualité de l'approche scientifique", level:0.6},
    {id:"d6", label:"Analyser les résultats au regard de la problématique", level:0.4},
    {id:"d7", label:"Capacité de synthèse — limites & prolongements", level:0.4},
    {id:"d8", label:"Mettre en avant les apports managériaux", level:0.6}
  ],
  soutenance: [
    {id:"s1", label:"Construire un exposé & mettre en valeur le travail", level:0.6},
    {id:"s2", label:"S'exprimer à l'oral (aisance, fluidité, niveau de langage)", level:0.6},
    {id:"s3", label:"Écouter & comprendre les questions du jury", level:0.6},
    {id:"s4", label:"Apporter des réponses pertinentes aux questions", level:0.6}
  ]
};
