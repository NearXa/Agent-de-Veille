# Résultats et limites

Mesures réalisées le 27/10/2026 sur le règlement DORA (CELEX 32022R2554, version française, HTML EUR-Lex), avec
`claude-opus-5-5` (effort medium) via le Vercel AI SDK, l'organisation fictive « Aurelia Gestion d'Actifs » et le catalogue
de 38 contrôles de `config/controles.yaml`. Tous les chiffres proviennent de `data/runs/<run_id>/metrics.json` et du store.

## Chiffres mesurés

| Mesure                                 | Valeur                                                                                                                                                                                                                                                                                                                                                                                            | Source                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Texte ingéré                           | 64 articles, 106 considérants, hash de contenu identique entre le fichier local et le Cellar                                                                                                                                                                                                                                                                                                      | `pnpm agent ingest`, sonde Cellar                         |
| Articles analysés                      | 12 (articles 5 à 16, chapitre II), 3 chunks de 5 716, 5 454 et 1 474 tokens estimés                                                                                                                                                                                                                                                                                                               | `extract --dry-run`                                       |
| Exigences extraites                    | 85 (13 pour l'art. 5, 12 pour l'art. 6, 18 pour l'art. 11, 11 pour l'art. 16 ; 0 pour l'art. 15, adressé aux AES)                                                                                                                                                                                                                                                                                 | `data/store/exigences.json`                               |
| Vérification dans la source            | 85 / 85 : article cité existant et extrait verbatim retrouvé (sous-chaîne normalisée)                                                                                                                                                                                                                                                                                                             | `confiance_detail`                                        |
| Confiance                              | moyenne 0,99, minimum 0,88, maximum 1                                                                                                                                                                                                                                                                                                                                                             | `confiance`                                               |
| Précision estimée (relecture manuelle) | échantillon déterministe de 11 exigences (1 sur 8) : 11 / 11 sont de vraies obligations, correctement délimitées, avec verbatim et article exacts ; 8 / 11 visent la catégorie d'entité de l'organisation, 3 visent d'autres entités (prestataires de services de communication de données, art. 12 §3 ; régime simplifié de l'art. 16 × 2), ce que l'agent avait signalé dans ses avertissements | relecture du 27/10/2026                                   |
| Avertissements juridiques remontés     | 16 à l'extraction (ex. art. 6 §9 et §10 facultés et non obligations ; fréquences non chiffrées ; applicabilité de l'art. 16), 9 points de décision humaine en gouvernance                                                                                                                                                                                                                         | `data/runs/*/extract-summary.json`, `recommandation.json` |
| Enrichissement                         | 85 échéances (17/01/2025, entrée en application, art. 64), 85 sanctions (art. 50 à 54)                                                                                                                                                                                                                                                                                                            | `enrich`                                                  |
| Impact                                 | efforts : 37 faibles, 33 moyens, 15 élevés                                                                                                                                                                                                                                                                                                                                                        | `impact`                                                  |
| Couverture                             | 5 couvertes, 71 partielles, 9 non couvertes ; 36 contrôles liés sur 38                                                                                                                                                                                                                                                                                                                            | `coverage`                                                |
| Risques                                | 80 scénarios (une exigence non couverte ou partielle sur 80) : 3 critiques, 18 élevés, 41 modérés, 18 faibles                                                                                                                                                                                                                                                                                     | `risks`                                                   |
| Gouvernance                            | Hybride (TOGAF 55 / ITIL 65), mapping 30 TOGAF / 55 ITIL, 14 lots (3 P1, 8 P2, 3 P3)                                                                                                                                                                                                                                                                                                              | `governance`                                              |
| Coût et temps par run                  | extraction seule : 3 appels, 39 103 + 53 496 tokens, 1,23 $, 7 min 46 ; pipeline complet : 28 appels, 243 877 + 157 961 tokens, 2,91 $, 15 min 16 ; gouvernance : 1 appel, 0,29 $, 2 min 20 ; rejeu intégral avec cache : 0 $, 36 s                                                                                                                                                               | `pnpm agent status --all`                                 |
| Notion                                 | init : 6 bases, 7 relations, 1 formule ; push complet : 26 textes, 85 exigences, 38 contrôles, 80 risques, 14 lots, 179 relations, 579 requêtes en 5 min 52 ; lecture par le cockpit des six bases en 2,7 s                                                                                                                                                                                       | `pnpm notion push`                                        |
| Veille                                 | passage sur 5 sources réseau en 2 min 05 : 17 actes du JOUE (Cellar), 1 AN, 1 Sénat, 1 CNIL, 5 CERT-FR ; 3 rectificatifs indisponibles signalés                                                                                                                                                                                                                                                   | `pnpm agent watch --once`                                 |
| Assistant GRC (29/10/2026)             | filtre de périmètre : 9 classements conformes sur 9 ; refus en 1,7 s pour 0,003 $ ; réponse avec outils en 8,7 s pour 0,02 à 0,05 $ (`claude-sonnet-5-5`, effort low)                                                                                                                                                                                                                             |
| Qualité                                | 79 tests vitest (16 fichiers), 39 tests pytest, lint, typecheck, format ; CI GitHub Actions                                                                                                                                                                                                                                                                                                       |

## Limites

- **Interprétation juridique** : le score de confiance mesure la traçabilité (verbatim, article), pas la justesse juridique.
  Le modèle peut mal délimiter une obligation, la rattacher à une mauvaise catégorie d'entité ou manquer une nuance ; chaque
  exigence naît « À valider » et la décision finale appartient à un juriste ou au RCCI. Les justifications, résumés, scénarios de
  risque et scores P × I sont des propositions à relire.
- **Applicabilité fine** : l'applicabilité est évaluée au niveau du texte. Des exigences visant d'autres catégories d'entités
  (prestataires de services de communication de données, dépositaires centraux, entités du régime simplifié de l'art. 16)
  sont extraites et signalées, mais non filtrées automatiquement.
- **Jurisprudence** : connecteur Judilibre et notation de pertinence implémentés et testés hors ligne, mais non exercés faute
  d'identifiants PISTE (inscription gratuite sur piste.gouv.fr) ; la matrice M5 est vide. Un corpus local
  `data/sources/jurisprudence/*.json` permet une démonstration sans PISTE.
- **Sources** : EUR-Lex refuse les clients automatisés (page de contrôle anti-bot) ; le Cellar sert de repli, sans les
  rectificatifs (404). cyber.gouv.fr applique aussi un contrôle anti-bot : seuls les flux CERT-FR sont exploités. L'export
  open data des dossiers de l'Assemblée nationale (zip de 11 Mo) n'est pas exploité ; les pages d'actualité sont ingérées
  comme section unique.
- **Quotas et disponibilité** : quotas PISTE non publiés ; Notion limité à ≈ 3 requêtes par seconde (un push complet dure
  plusieurs minutes) ; un run complet coûte ≈ 3 $ et 15 min avec Opus 5.5 (le cache rend les rejeux gratuits).
- **PDF** : pris en charge par `unpdf` avec segmentation par regex, moins fiable que le HTML EUR-Lex ou le JSON Légifrance.
- **Mots-clés de veille** : jusqu'au 29/10/2026, les mots-clés étaient cherchés comme sous-chaînes. Le sigle « TIC » se trouvait
  donc dans « article », « NIS » dans « définis » et « DORA » dans « dorade », et presque tout acte du Journal officiel passait le
  filtre EUR-Lex : 24 actes sans rapport sont entrés dans le store. Les mots-clés sont désormais comparés par mot entier, et les
  sigles en majuscules. Rejoué sur les titres du store, le filtre ne retient plus que DORA parmi les actes EUR-Lex, sans rien
  écarter des autres sources.
- **Assistant GRC** : le périmètre repose sur un classement fait par le modèle, pas sur une règle déterministe. Les essais
  (9 sur 9) ne garantissent pas l'absence d'erreur ; en cas de doute ou d'échec du classement, l'assistant refuse. Ses réponses
  sont des lectures des données du cockpit, à vérifier dans les vues avant toute décision.
- **Dépôt sur `/mnt/c` (WSL)** : les imports Python y sont lents. Le premier affichage du cockpit prend ≈ 20 s, et le SDK
  Anthropic se charge ensuite en ≈ 25 s en arrière-plan.
- **Captures d'écran** : celles de l'assistant sont dans `docs/captures/` (Firefox headless). Celles des quatre vues restent à
  réaliser par l'équipe (`pnpm cockpit`, puis chaque vue).

## Pistes d'amélioration

1. Obtenir des identifiants PISTE pour exercer Légifrance (loi Informatique et Libertés, fonds CNIL) et Judilibre en réel.
2. Filtrer l'applicabilité au niveau de chaque exigence (destinataires contre le profil de l'organisation).
3. Étendre l'extraction à l'ensemble de DORA (64 articles) et à NIS2, puis suivre les RTS et ITS associés.
4. Mesurer la précision sur un échantillon relu par un juriste et ajuster les prompts (évaluation continue).
5. Planifier la veille (GitHub Actions ou Docker Compose) et activer `analyse_automatique` avec un plafond de coût.
6. Utiliser le cache de prompt Anthropic pour les articles transversaux répétés dans chaque lot (coût de l'enrichissement).
