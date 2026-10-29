# Support de soutenance : agent de veille continue GRC et législative

## 1. Problème

- Une société de gestion de portefeuille fictive (« Aurelia Gestion d'Actifs », ~800 salariés, agréée AMF, entité financière
  au sens de DORA) doit suivre des textes longs et mouvants : DORA seul compte 64 articles et 106 considérants.
- La veille manuelle ne garantit ni l'exhaustivité, ni la traçabilité (article exact, extrait, URL), ni le lien avec les
  contrôles, les risques et les décisions de gouvernance.

## 2. Réponse : un agent qui propose, un humain qui valide

- Agent TypeScript (Node 22, Vercel AI SDK 7 + Zod) : connecteurs de sources officielles, ingestion et segmentation, pipeline
  d'analyse structurée (applicabilité, extraction, enrichissement, jurisprudence, impact, couverture, risques, gouvernance).
- Tout ce que produit le LLM est un objet validé par un schéma Zod, puis contrôlé par du code : verbatim retrouvé dans la
  source, articles existants, score de confiance `0,5 × LLM + 0,3 × verbatim + 0,2 × article`, listes fermées, résiduel
  calculé, lots d'action et RACI construits par code. Le LLM ne génère jamais une matrice.
- Notion : six bases reliées (Textes, Exigences, Contrôles, Risques, Jurisprudence, Lots d'action), workers push / pull /
  watch, serveur MCP officiel pour l'interrogation en langage naturel.
- Cockpit Streamlit à quatre vues : fil de veille, textes et matrices (M1 à M5, graphiques, exports), validation humaine
  (Valider / Corriger / Rejeter écrits dans Notion avec commentaire d'audit), pilotage (KPI, échéances, lots, décision de
  cadre de gouvernance).

## 3. Démonstration (voir `docs/demo-script.md`)

Parcours en six étapes sur DORA (articles 5 à 16), puis analyse complète, gouvernance, veille continue et MCP.

## 4. Résultats mesurés (27/10/2026, `claude-opus-5-5`)

| Indicateur                                             | Valeur                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Articles traités (extraction)                          | 12 (art. 5 à 16), 3 chunks                                                                                                                                |
| Exigences extraites                                    | 85, toutes vérifiées dans la source (article et verbatim), confiance moyenne 0,99                                                                         |
| Précision estimée (relecture manuelle de 11 exigences) | 11 / 11 obligations réelles et bien délimitées ; 8 / 11 visent la catégorie d'entité de l'organisation (3 visent d'autres entités, signalées par l'agent) |
| Enrichissement                                         | 85 échéances (17/01/2025, art. 64), 85 sanctions (art. 50 à 54)                                                                                           |
| Couverture par 38 contrôles                            | 5 couvertes, 71 partielles, 9 non couvertes                                                                                                               |
| Risques                                                | 80 scénarios : 3 critiques, 18 élevés, 41 modérés, 18 faibles                                                                                             |
| Gouvernance                                            | recommandation Hybride (TOGAF 55 / ITIL 65), 14 lots d'action, 9 points de décision humaine                                                               |
| Coût et temps                                          | extraction 1,23 $ / 7 min 46 ; pipeline complet 2,91 $ / 15 min ; gouvernance 0,29 $ / 2 min 20 ; rejeu avec cache 0 $ / 36 s                             |
| Veille multi-sources                                   | 5 sources réseau en 2 min 05 : 17 actes JOUE, 1 AN, 1 Sénat, 1 CNIL, 5 CERT-FR                                                                            |
| Qualité                                                | 77 tests vitest, 13 tests pytest, lint, typecheck, CI GitHub Actions                                                                                      |

## 5. Fait pendant l'atelier (4 h) / ajouté après

| Phase                    | Fait pendant l'atelier (tag `atelier-4h`)                                                                                     | Ajouté après (tag `rendu-final`)                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 Fondations             | Scaffold, configuration (4 YAML), store et IDs stables, factory LLM avec cache et coût, CLI, cockpit squelette                | —                                                                                                                                                                                                      |
| 1 MVP six étapes         | Connecteur fichier local, parser EUR-Lex, extraction vérifiée, M1, `notion init` / `push`, validation dans le cockpit, `demo` | —                                                                                                                                                                                                      |
| 2 Veille multi-sources   | —                                                                                                                             | EUR-Lex (Cellar, RSS), Légifrance et Judilibre via PISTE, AN, Sénat (open data), CNIL, CERT-FR, diff par article, « À revalider », dédup, `watch` cron, workflow de veille                             |
| 3 Analyse complète       | —                                                                                                                             | Applicabilité, enrichissement, jurisprudence, impact, couverture, risques, `run`, M1 à M5 (CSV, XLSX, MD), `pull`, `notion watch`                                                                      |
| 4 Gouvernance et cockpit | —                                                                                                                             | Recommandation TOGAF / ITIL / Hybride, lots d'action, plan, décision humaine, 4 vues complètes, `agent ask` (MCP), Docker Compose                                                                      |
| 5 Qualité et rendu       | —                                                                                                                             | Tests, CI, documentation, mesures, relecture sur machine propre                                                                                                                                        |
| 6 Assistant de chat      | —                                                                                                                             | Application Next.js + AI SDK 7 inspirée du template « Chatbot » de Vercel : questions en langage naturel sur les exigences, risques, échéances et lots, outils de lecture seule sur le store et Notion |

## 6. Limites et suite

- Le modèle peut mal délimiter une obligation ou l'attribuer à la mauvaise catégorie d'entité : la vérification par code
  garantit la traçabilité, pas l'interprétation juridique, qui reste à un juriste (statut « À valider » par défaut).
- Légifrance et Judilibre sont implémentés et testés hors ligne, sans identifiants PISTE réels ; la matrice M5 est vide.
- EUR-Lex bloque les clients automatisés : passage par le Cellar de l'Office des publications.
- Suite : identifiants PISTE, corpus de jurisprudence, planification sur GitHub Actions ou Docker, relecture juridique
  d'un échantillon plus large, suivi des RTS de DORA.
