# Journal du projet

Tenu à chaque phase. Il distingue ce qui a été fait pendant l'atelier de 4 h (tag `atelier-4h`) de ce
qui a été ajouté ensuite (tag `rendu-final`), conformément à la section 16 de `SPEC.md`.

| Phase                            | Date       | Fait pendant l'atelier                                                                                                                                                                                              | Ajouté après                                                                                                                                                                                                                                                  | Démo de l'état courant                                  |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 0 Fondations                     | 27/10/2026 | Scaffold du monorepo, configuration (4 YAML), store JSON et registre d'IDs, factory LLM avec cache et coût, CLI squelette, cockpit Streamlit (4 vues, repli local), tests                                           |                                                                                                                                                                                                                                                               | `pnpm agent config`, `pnpm cockpit`                     |
| 1 MVP six étapes                 | 27/10/2026 | Connecteur fichier local, parser EUR-Lex, `ingest`, schéma Zod et prompt d'extraction, `extract` vérifié (85 exigences), matrice M1, `notion init` et `push`, validation dans le cockpit écrite dans Notion, `demo` |                                                                                                                                                                                                                                                               | `pnpm agent demo`, `pnpm cockpit`                       |
| 2 Veille multi-sources           | 27/10/2026 |                                                                                                                                                                                                                     | Connecteurs EUR-Lex (Cellar), Légifrance et Judilibre (PISTE), Assemblée nationale, Sénat, CNIL, CERT-FR ; diff par article et « À revalider » ; dédup ; `watch` cron ; workflow de veille                                                                    | `pnpm agent watch --once`                               |
| 3 Analyse complète et matrices   | 27/10/2026 |                                                                                                                                                                                                                     | Applicabilité, enrichissement, jurisprudence, impact, couverture, risques, `run`, M1 à M5 (CSV, XLSX, MD), `notion pull` et `watch`                                                                                                                           | `pnpm agent run --texte TX-0001 --articles 5-16`        |
| 4 Gouvernance et cockpit complet | 27/10/2026 |                                                                                                                                                                                                                     | Recommandation TOGAF / ITIL / Hybride, 14 lots d'action, plan de gouvernance, décision humaine, 4 vues complètes, `agent ask` (MCP), Docker Compose                                                                                                           | `pnpm agent governance --texte TX-0001`, `pnpm cockpit` |
| 5 Qualité et rendu               | 27/10/2026 |                                                                                                                                                                                                                     | CI, documentation complète, mesures, répétition de la démo, relecture sur clone propre                                                                                                                                                                        | `pnpm agent demo`, `pnpm cockpit`                       |
| 6 Assistant GRC                  | 29/10/2026 |                                                                                                                                                                                                                     | Demande de l'enseignant hors spec : bulle « Assistant GRC » sur toutes les pages du cockpit, filtre qui refuse toute question hors GRC, outils de lecture seule ; relations Notion relues en entier ; correctif de l'extraction qui effaçait l'enrichissement | `pnpm cockpit`, bulle en bas à droite                   |

## Phase 0 : fondations (27/10/2026)

**Paramètres validés** (section 2 de la spec) : DORA (CELEX 32022R2554, HTML EUR-Lex en français),
Anthropic `claude-opus-5-5` via `@ai-sdk/anthropic`, pnpm via corepack, organisation fictive
« Aurelia Gestion d'Actifs » avec le profil par défaut.

**Fait** :

- Dépôt git initialisé, `package.json` (pnpm 12.15, Node ≥ 22), TypeScript strict ESM, ESLint flat config, Prettier, Vitest.
- `config/organisation.yaml`, `config/controles.yaml` (38 contrôles ISO 27001:2022 + internes), `config/risques.yaml`, `config/sources.yaml`, validés par Zod (`agent/src/config/`).
- Store JSON atomique, schémas des enregistrements (`agent/src/store/types.ts`), registre d'IDs stables, suivi des runs (`data/runs/<run_id>/metrics.json`).
- Couche LLM : factory de provider (Anthropic, OpenAI, Mistral), cache par hash, table de prix et garde-fou de coût, appel structuré avec reprise sur erreur de schéma.
- CLI `pnpm agent` : toutes les commandes de la spec déclarées avec leurs options ; `config` et `status` opérationnelles, les autres annoncent leur phase.
- Cockpit Streamlit : navigation 4 vues, champ Validateur, indicateur de source, bouton Rafraîchir, repli lecture seule sur `data/store/`, vue Validation humaine complète côté UI (écriture Notion en phase 1).
- Texte DORA déposé manuellement par l'équipe dans `data/sources/dora-32022R2554-fr.html` (SHA-256 `92497e61f691e2487b673f48cd729d2be1bb4e80a59445503fc4b9f48b258d95`).

**Écarts par rapport à la spec, documentés** :

- Node 22+ au lieu de 20+ (exigence d'AI SDK 7).
- `generateObject` déprécié : `generateText` + `Output.object`.
- `temperature` non supportée par les modèles Claude 5.x : non envoyée, reproductibilité via le cache LLM.
- Téléchargement EUR-Lex impossible en automatique depuis le poste (anti-bot) : fichier enregistré depuis le navigateur.

**Reste** : phase 1 (parcours de démonstration en six étapes).

## Phase 1 : MVP du parcours en six étapes (27/10/2026)

**Fait** :

- Interface `SourceConnector`, connecteur `local-file`, parser EUR-Lex (cheerio : `div.eli-subdivision#art_N`,
  titres `oj-sti-art`, paragraphes et points des tableaux), segmenteur de repli par regex, détection de la date
  d'entrée en application, hash de contenu et copie brute horodatée. `pnpm agent ingest` : TX-0001, 64 articles.
- Contrat `ExtractionResultSchema`, prompt versionné `extraction.md` (le texte juridique est une donnée),
  chunking équilibré sans couper un article (3 chunks pour les articles 5 à 16), map puis reduce (fusion par
  clé et par similarité de titres), vérification par code (articles, verbatim normalisé), confiance pondérée,
  IDs stables et préservation des décisions humaines existantes. Fixture LLM rejouable pour les tests.
- Matrice M1 en CSV (UTF-8 BOM, pied de page) et Markdown, `--only-validated`.
- Notion : schéma des 6 bases, `init` idempotent (réutilisation, propriétés manquantes, relations
  `dual_property` renommées, formule de criticité), `push` par upsert sur l'ID métier sans écraser les champs
  de validation, limiteur de débit et reprise sur 429 / 5xx. Testé hors ligne avec un faux client.
- Cockpit : lecture Notion (noms de propriétés lus dans `notion/ids.json`), écriture des décisions (page +
  commentaire d'audit), repli local en lecture seule, test de démarrage `AppTest`.
- `pnpm agent demo` et `scripts/demo.sh` / `demo.ps1`.

**Mesures réelles (27/10/2026, `claude-opus-5-5`, effort medium)** : étape 2 sur les articles 5 à 16 = 3 chunks,
85 exigences extraites, 85 vérifiées dans la source (articles et verbatim), 16 avertissements juridiques remontés,
39 103 tokens en entrée et 53 496 en sortie, 1,23 $, 7 min 46 s. Étape 4 : M1 générée (85 lignes).

**Validation de bout en bout (27/10/2026, page Notion « GRC EPITA », intégration « Devoir EPITA »)** :

- étape 5 : `pnpm agent demo` complet en 92,5 s (extraction relue du cache, 0 $), 6 bases créées avec 20 / 31 / 12 /
  15 / 11 / 13 propriétés, 7 relations bidirectionnelles, formule « Criticité brute », 1 texte et 85 exigences
  « À valider » ; rejeu idempotent : `notion init` réutilise les 6 bases (13 requêtes), `notion push` met à jour
  1 + 85 pages (86 requêtes, 52 s) ;
- étape 6 : le cockpit lit Notion (indicateur « Source de données : Notion », 85 exigences), la validation d'une
  exigence met à jour la page (statut, validateur, date, commentaire) et crée le commentaire d'audit
  `2026-10-27 18:02 · Validée par Neyl Kaci · …` ; test réalisé puis remis à l'état initial.

**Phase 1 close : tag `atelier-4h`.** Limites connues à ce stade : échéances et sanctions laissées à `null` par
conception (enrichissement en phase 3), applicabilité à l'organisation non évaluée (phase 3), M2 à M5 absentes,
relation « Exigences » côté Textes limitée à 25 références par lecture de page (pagination Notion), premier run
LLM à 1,23 $ et 7 min 46 s.

## Phase 2 : veille multi-sources (27/10/2026, ajouté après l'atelier)

**Vérifications préalables (règle 3)** : deux agents de recherche ont confirmé les URL et formats officiels
avant implémentation (PISTE OAuth2 sandbox / production, Légifrance `lf-engine-app`, Judilibre v1.0 avec
en-tête `KeyId`, flux RSS prédéfinis EUR-Lex, Cellar de l'Office des publications, exports open data de
l'Assemblée nationale et du Sénat, flux CNIL et CERT-FR). Aucune URL n'a été inventée ; celles qui n'ont pas pu
être vérifiées en direct (cyber.gouv.fr derrière un contrôle anti-bot) sont signalées en commentaire dans
`config/sources.yaml`.

**Fait** :

- Socle commun : client HTTP (délai, 3 reprises avec backoff, limitation de débit par source, User-Agent
  explicite, détection des réponses anti-bot), parser RSS 2.0 / Atom, copie brute horodatée avec métadonnées.
- Connecteurs : `eurlex` (texte par CELEX, URL officielle puis repli Cellar en négociation de contenu
  `application/xhtml+xml` / `fra`, veille par flux RSS filtrée par mots-clés), `legifrance` (OAuth2 PISTE avec
  cache de jeton, `/consult/legiPart`, `/consult/getArticle`, `/search` LODA), `judilibre` (`/search`,
  `/decision`, zones de décision), `senat` (CSV open data quotidien + flux RSS), `assemblee-nationale`, `cnil`,
  `anssi` (flux officiels + page HTML ou PDF, segmentation de repli), `local-file` étendu au PDF (unpdf).
- Détection de modifications : hash du contenu normalisé, diff par article (ajouté, supprimé, modifié avec
  extrait), historique des versions dans le texte, exigences validées ou corrigées citant un article modifié
  passées « À revalider » dans le store puis dans Notion (commentaire d'audit, idempotent).
- Déduplication inter-sources : (source, référence), puis hash, puis titre normalisé ; URL connues fusionnées.
- `pnpm agent watch` : passage unique (`--once`, `--source`), planification cron par source (node-cron),
  fenêtre initiale de 30 jours, 20 documents maximum par source et par passage, extraction automatique
  optionnelle (`analyse_automatique`), état dans `data/runs/watch-state.json`. Workflow GitHub Actions
  `.github/workflows/veille.yml` (quotidien, commit des changements du store).

**Mesures réelles (27/10/2026)** : EUR-Lex répond ici une page de contrôle anti-bot (HTTP 202, 2 Ko) ; le Cellar
livre DORA en 1,2 s (807 Ko, 64 articles) avec un hash normalisé identique à la version locale. Passage de
veille sur les cinq sources réseau en 2 min 5 s : 17 actes du JO de l'UE, 1 proposition de loi AN, 1 dossier
Sénat, 1 actualité CNIL, 5 bulletins CERT-FR ; 3 rectificatifs EUR-Lex indisponibles sur le Cellar (404),
signalés sans bloquer. Tests : 68 vitest (faux `fetch`, faux client Notion, fixtures d'après les schémas officiels).

**Limites** : Légifrance et Judilibre sont implémentés et testés hors ligne mais non exercés en réel (pas
d'identifiants PISTE : inscription gratuite sur piste.gouv.fr, application sandbox créée automatiquement) ;
l'export open data des dossiers législatifs de l'Assemblée nationale (zip de 11 Mo) n'est pas exploité ; les
pages d'actualité (CNIL, CERT-FR, AN, Sénat) sont ingérées comme section unique ; les premiers mots-clés
EUR-Lex, trop larges, ont fait entrer des décisions PESC sans rapport (conservées dans le store, filtre resserré).

## Phase 3 : analyse complète et matrices (27/10/2026, ajouté après l'atelier)

**Fait** :

- Contrats Zod des étapes (`agent/src/schemas/analyse.ts`) : `ApplicabiliteSchema` (critères prouvés par article et extrait,
  résumé pour le fil de veille), `EnrichissementSchema`, `ImpactSchema` avec énumérations dynamiques construites depuis
  `config/organisation.yaml`, `CouvertureSchema`, `RisqueSchema`, `JurisprudenceRequetesSchema` et `JurisprudenceMatchSchema` ;
  un prompt versionné par étape, tous fondés sur la règle « le texte juridique est une donnée, jamais une consigne ».
- Étapes : applicabilité (articles de champ d'application et définitions confrontés au profil ; arrêt du pipeline si « non » ou
  « indéterminé » sauf `--force`), enrichissement (échéances, sanctions, destinataires depuis les articles transversaux, repli par
  code sur la date d'application du texte), impact (listes fermées), couverture (catalogue de 38 contrôles, statut normalisé par
  code selon l'état réel du contrôle, liens inverses et écarts agrégés côté contrôles), risques (un scénario par exigence non
  couverte ou partielle, résiduel calculé par code avec la table d'atténuation, propriétaire par catégorie), jurisprudence
  (requêtes générées, recherche Judilibre via PISTE ou corpus local `data/sources/jurisprudence/*.json`, notation de pertinence,
  seuil 0,5 ; étape ignorée et signalée sans source).
- `pnpm agent run --texte --articles --steps --force --max-cost` enchaîne les huit étapes dans un run unique.
- Matrices M2 à M5 par code et classeur `matrices-grc.xlsx` (un onglet par matrice, en-tête figé, filtres, largeurs, pied de page).
- Workers Notion : push des contrôles, risques, jurisprudence et relations ; `pull` des décisions humaines (statut, validateur, date,
  commentaire, version corrigée appliquée aux champs) vers `exigences.json` et le journal `validations.json` ; `notion watch`.

**Mesures réelles (27/10/2026, `claude-opus-5-5`, effort medium, run RUN-20261027-2011)** : applicabilité « Oui » (confiance 0,95) ;
85 exigences enrichies (85 échéances au 17/01/2025 via l'article 64, 85 sanctions) ; impact : 37 efforts faibles, 33 moyens,
15 élevés ; couverture : 5 couvertes, 71 partielles, 9 non couvertes ; 80 risques (3 critiques, 18 élevés, 41 modérés, 18 faibles) ;
28 appels LLM dont 3 relus du cache, 243 877 tokens en entrée et 157 961 en sortie, 2,91 $, 15 min 16 s. Push Notion ensuite :
38 contrôles, 80 risques, 179 relations.

**Limites** : jurisprudence non exercée (pas d'identifiants PISTE ni de corpus local) ; les scores de risque restent une
proposition du modèle à relire ; le résumé d'applicabilité et les justifications sont des textes générés à valider.

## Phase 4 : gouvernance et cockpit complet (27/10/2026, ajouté après l'atelier)

**Fait** :

- `GouvernanceSchema` et prompt `gouvernance.md` reprenant la grille de décision de la spec (transformation d'architecture → TOGAF,
  run et processus → ITIL, parts comparables → Hybride) ; recommandation chiffrée (scores, critères pondérés), mapping exigence →
  cadre → phase ou pratique → livrable, alternatives et points de décision humaine ; `output/gouvernance/recommandation.json`.
- Lots d'action construits par code (un lot par couple cadre / phase pour les exigences non couvertes ou partielles, priorité
  selon le risque résiduel maximal, responsable RACI, échéance cible, effort), IDs `LA-xxxx` stables ; plan
  `output/gouvernance/plan-gouvernance.md` (copie `docs/plan-gouvernance.md`) : recommandation, mapping, feuille de route avec
  dépendances, RACI, indicateurs de pilotage, points de décision humaine.
- Décision humaine : vue « Pilotage » du cockpit (TOGAF / ITIL / Hybride + commentaire) écrite dans Notion (propriété « Cadre de
  gouvernance » de chaque lot, page « Décision de gouvernance » sous la page parente) et dans `output/gouvernance/decision.json`
  avec auteur et date ; refusée en mode local.
- Cockpit complet : fil de veille (filtres source, type, applicabilité, période ; badges ; diffs par article), textes et matrices
  (M1 à M5 rendues depuis les données, téléchargements CSV et XLSX, graphiques Plotly : exigences par type, couverture, heatmap
  probabilité × impact), validation humaine, pilotage (KPI, timeline des échéances à 30 / 90 / 365 jours avec dépassements en rouge,
  lots par priorité, bloc de recommandation et de décision, exports) ; lecture Notion des six bases avec relations résolues.
- `pnpm agent ask "…"` : interrogation des bases Notion en langage naturel via le serveur MCP Notion officiel (transport stdio) et
  le client MCP de l'AI SDK, outils de lecture seulement ; `.mcp.json` pointe vers le serveur hébergé pour Claude Code.
- `docker-compose.yml` (services `cockpit` et `scheduler`) et Dockerfiles.

**Mesures réelles (27/10/2026)** : recommandation **Hybride** (TOGAF 55, ITIL 65), 30 exigences côté TOGAF et 55 côté ITIL,
14 lots d'action (3 P1, 8 P2, 3 P3), 9 points de décision humaine, un appel LLM de 0,29 $ en 2 min 20 s ; push Notion des lots
et relations ; cockpit lisant les six bases en 2,7 s.

## Phase 5 : qualité et rendu (27/10/2026, ajouté après l'atelier)

**Fait** :

- CI GitHub Actions `.github/workflows/ci.yml` (lint, typecheck, vitest, format, pytest) à chaque push.
- Documentation de la section 16 : README final, `docs/architecture.md`, `docs/modele-de-donnees.md` (généré depuis le schéma
  Notion du code par `scripts/gen-modele-donnees.mts`), `docs/demo-script.md` (8 minutes), `docs/plan-gouvernance.md`,
  `docs/matrices/` (exports finaux M1 à M5 en CSV, MD et XLSX), `docs/resultats-et-limites.md` (chiffres mesurés, précision
  estimée sur 11 exigences relues, limites, pistes), `docs/presentation.md` avec le tableau « fait pendant l'atelier / ajouté après ».
- Répétition de la démo avec le cache LLM : pipeline complet rejoué en 36 s pour 0 $ (28 appels relus du cache), démo complète
  en 2 min 50 (poussée Notion comprise).
- Relecture du README sur un clone propre : `git clone`, `scripts/setup.sh`, `pnpm agent config`, `pnpm check`, `pytest`,
  `ingest`, `extract --dry-run`, `matrices` : installation complète sans intervention, `.env` créé depuis l'exemple, 77 tests
  vitest et 13 tests pytest verts, 64 articles segmentés avec le même hash de contenu (`e1e54d9230e86244…`), cinq matrices
  régénérées depuis le store versionné (M3 : 85 lignes, M4 : 80 lignes). Seules les clés restent à renseigner.
- Tag `rendu-final`.

## Phase 6 : assistant GRC (29/10/2026, demande de l'enseignant, hors SPEC.md)

**Demande** : implémenter l'équivalent du template https://vercel.com/templates/next.js/chatbot, un chatbot qui répond via
l'API. Une première version, le 29/10, était une application Next.js séparée (`chat/`, port 3000, `pnpm chat`). Neyl l'a écartée
le même jour : tout doit rester dans le cockpit, sans autre port ni commande, et l'assistant ne doit répondre qu'aux questions
GRC. L'application Next.js a été retirée.

**Fait** :

- bulle « Assistant GRC » fixée en bas à droite de toutes les pages (`st.popover` dans un fragment, positionné en CSS) ;
  conversation en streaming, appels d'outils affichés, suggestions, coût de la conversation et plafond (`LLM_CHAT_MAX_COST`) ;
- filtre de périmètre : un appel court en sortie structurée (`messages.parse`, schéma pydantic `Classement`) classe chaque
  question `grc`, `salutation` ou `hors_perimetre`. Hors périmètre, ou si le classement échoue, l'assistant refuse sans appeler
  le modèle de réponse ;
- réponse : boucle d'outils en streaming (SDK Python `anthropic`) avec neuf outils en lecture seule sur les données du cockpit.
  Les entrées sont validées par pydantic avant exécution, l'historique est en ajout seul, le repli serveur `fallbacks: "default"`
  est actif ;
- correctif de la lecture Notion du cockpit : les relations risques ↔ contrôles, lots ↔ risques et contrôles ↔ exigences
  n'étaient pas relues, et les contrôles des exigences restaient des identifiants de pages Notion. L'assistant affirmait donc
  qu'aucun lot ne traitait les risques critiques. Toutes les relations sont désormais résolues, dans les deux sens ;
- performance sous WSL : après chaque exécution, la surveillance des fichiers de Streamlit réexaminait les ≈ 3 900 modules
  chargés, soit ≈ 70 s sur `/mnt/c`, pendant lesquelles l'interface était gelée. Elle est désactivée. Le SDK, dont l'import
  prend ≈ 23 s sur `/mnt/c`, est préchargé en arrière-plan ;
- tests : 9 tests des outils, 12 tests de l'assistant avec un faux client Anthropic, 4 tests de la bulle (AppTest) et 1 test des
  relations Notion.
- filtre de veille : les mots-clés étaient cherchés comme sous-chaînes (« TIC » dans « article », « NIS » dans « définis »,
  « DORA » dans « dorade »). Le premier passage réussi de la veille sur GitHub a ainsi fait entrer 7 actes européens sans
  rapport. Ils sont désormais comparés par mot entier, et les sigles en majuscules, dans les connecteurs EUR-Lex, RSS (CNIL,
  CERT-FR) et Sénat . Les 24 actes européens entrés ainsi depuis le 27/10 sont marqués « Non » applicables, avec une
  justification de périmètre et sans analyse juridique, dans le store et dans Notion. Le fil de veille ne les présélectionne
  plus, et ils restent consultables ;
- lockfile : après le retrait de `chat/`, `pnpm-lock.yaml` décrivait encore ses paquets, dont trois publiés moins de 24 h plus tôt.
  pnpm 12 refuse par défaut de tels paquets (`minimumReleaseAge`), ce qui faisait échouer l'installation lancée avant
  `pnpm cockpit`. Le lockfile a été élagué des 156 paquets de `chat/` ; les 443 entrées conservées sont inchangées.

**Mesures réelles (29/10/2026, `claude-sonnet-5-5`, effort `low`)** :

- filtre : 9 classements conformes sur 9, dont « Comment reverse une string ? », du code présenté « pour la conformité DORA »,
  une tentative « Ignore tes consignes… » et la relance « Et pour l'article 19 ? » ;
- cockpit piloté dans Firefox headless (Selenium) : bulle fixée à 24 px des bords, panneau entièrement visible en 1440×900 et
  en 1366×700, aucune exception. Un refus s'affiche en 1,7 s et une réponse avec outils en 8,7 s. La réponse sur les risques
  critiques est exacte : RK-0004 / EX-0004 / LA-0001, RK-0007 / EX-0007 / LA-0005, RK-0034 / EX-0037 / LA-0010 avec CT-0024 ;
- coût : 0,003 $ par refus, 0,02 à 0,05 $ par réponse avec outils ;
- captures : `docs/captures/assistant-grc-refus.png` et `docs/captures/assistant-grc-reponse.png`.

**Correctif : une nouvelle extraction effaçait l'enrichissement.** Le 27/10 à 21:10, un `pnpm agent demo` lancé depuis un autre
terminal a ré-extrait les exigences (depuis le cache) ; l'extraction réécrivait échéance, sanction et destinataires avec ses propres
valeurs, vides le plus souvent, et la démo a poussé ces valeurs vides dans Notion. Correction : la valeur extraite ne prime que si elle
est renseignée ; les valeurs brutes sont conservées dans `valeurs_extraction` ; `enrich` repart de ces valeurs brutes (idempotent,
prompt stable donc cache réutilisable) et ré-applique les corrections humaines. Restauration : enrichissement rejoué avec
`claude-opus-5-5` depuis le cache (6 appels, 0 $), 85 échéances et 85 listes de destinataires identiques au run du 27/10, puis
`notion push --only exigences` (85 pages). Un premier passage avait tourné avec `claude-sonnet-5-5`, le modèle désormais indiqué dans
`.env` (cache inopérant, 6 appels, 0,35 $) ; ses valeurs ont été remplacées par celles d'Opus.

**Dépôt** : le 27/10 à 21:44, le dépôt a été réinitialisé et publié sur GitHub (`NearXa/Agent-de-Veille`, commit unique `aad52d3`).
Les tags `atelier-4h` et `rendu-final` de l'historique local précédent n'existent plus ; le contenu des phases 0 à 5 est dans ce
commit, sauf `pnpm-lock.yaml` et `pnpm-workspace.yaml`, ajoutés sur la branche `feat/assistant-chat` (indispensables à la CI et aux
images Docker).
