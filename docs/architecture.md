# Architecture

## Vue d'ensemble

```
Sources officielles (EUR-Lex, Légifrance/PISTE, Judilibre/PISTE, AN, Sénat, CNIL, ANSSI, fichier local)
        │
        ▼
[Connecteurs TypeScript]  ──►  data/raw/<source>/<ref>/<hash>.json   (cache brut, horodaté)
        │
        ▼
[Ingestion] normalisation, segmentation en articles, hash SHA-256, dédup, détection de modifications
        │
        ▼
[Pipeline d'analyse, AI SDK + Zod]
   applicabilité → extraction → enrichissement → jurisprudence → impact → couverture → risques → confiance
        │
        ▼
data/store/*.json  (vérité du pipeline, IDs stables)   +   data/runs/<run_id>/ (artefacts, métriques)
        │                                   │
        ▼                                   ▼
[Matrices M1..M5]  output/matrices/      [Gouvernance TOGAF/ITIL]  output/gouvernance/
        │
        ▼
[Workers Notion push / pull / watch]  ◄──►  Notion (6 bases reliées)  ◄──►  [Serveur MCP Notion]
                                                   ▲
                                                   │ lecture + écriture des décisions
                                         [Cockpit Streamlit, 4 vues + bulle Assistant GRC]  ──►  API Anthropic
```

## Choix techniques

- **Agent** : Node.js 22+, TypeScript strict ESM, Vercel AI SDK 7 (`generateText` + `Output.object`), Zod 4, commander, pino, cheerio, yaml.
- **Appel LLM structuré** (`agent/src/llm/structured.ts`) : schéma Zod comme contrat ; structured outputs natifs d'Anthropic (`structuredOutputMode: 'auto'`) ; jusqu'à 3 tentatives en renvoyant au modèle la sortie brute et les erreurs de validation ; cache par hash (`data/cache/llm/`) ; compteur de tokens et de coût par run avec garde-fou `LLM_MAX_COST_PER_RUN`. Les modèles Claude 5.x n'acceptent pas `temperature` : elle n'est pas envoyée.
- **Store** : fichiers JSON écrits de façon atomique (`data/store/`), validés par Zod à la lecture. Les matrices sont des projections déterministes du store ; le LLM ne génère jamais une matrice.
- **Notion** : API data sources (version `2025-09-03`), une base = une data source, propriété title = ID métier (upsert trivial), relations bidirectionnelles posées après création des bases, rate limit respecté (≈ 3 requêtes/s, backoff sur 429).
- **Cockpit** : Streamlit multipage, lecture Notion avec cache de 60 s et repli automatique en lecture seule sur `data/store/` ; les décisions humaines sont écrites uniquement dans Notion (page + commentaire d'audit). La bulle « Assistant GRC », présente sur toutes les pages, ne répond qu'aux questions GRC : un filtre de périmètre en sortie structurée, puis une boucle d'outils en lecture seule sur les mêmes données (SDK Python `anthropic`).

## Identifiants stables

`data/store/ids-registry.json` associe une clé métier normalisée à un identifiant :

- textes : `TX|<source>|<référence>` ;
- exigences : `EX|<texte_id>|<articles normalisés>|<titre normalisé>`.

Un nouveau run réutilise les identifiants connus et n'en crée que pour les clés nouvelles. Aucune
renumérotation. Les runs sont identifiés `RUN-AAAAMMJJ-HHMM`.

## Score de confiance

```
confiance = 0,5 × confiance_llm
          + 0,3 × verbatim_retrouve   (1 si l'extrait normalisé est une sous-chaîne du texte source, sinon 0)
          + 0,2 × article_existe      (1 si chaque article cité existe dans la segmentation, sinon 0)
```

Normalisation pour le test de sous-chaîne (`agent/src/utils/text.ts`) : retrait des accents, de la
ponctuation, des espaces multiples et de la casse. Seuils d'affichage : ≥ 0,8 vert, 0,6 à 0,8 orange,
< 0,6 rouge. Toute exigence sous 0,6 ou avec `verifie_dans_source = false` est marquée à relire en
priorité ; elle n'est jamais supprimée silencieusement.

## Étapes d'analyse et garde-fous

| Étape         | Entrée                                                  | Sortie (contrat Zod)                     | Contrôle par code                                                                    |
| ------------- | ------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| applicability | articles de champ d'application et définitions + profil | `ApplicabiliteSchema`                    | arrêt du pipeline si non ou indéterminé (sauf `--force`)                             |
| extract       | chunks d'articles                                       | `ExtractionResultSchema`                 | verbatim et articles vérifiés, confiance pondérée, IDs stables                       |
| enrich        | exigences + articles transversaux                       | `EnrichissementSchema`                   | date ISO exigée, repli sur la date d'application du texte                            |
| jurisprudence | requêtes générées, Judilibre ou corpus local            | `JurisprudenceMatchSchema`               | seuil de pertinence 0,5, URL officielle conservée                                    |
| impact        | exigences + listes fermées de l'organisation            | `ImpactSchema` (énumérations dynamiques) | valeurs hors liste rejetées par le schéma                                            |
| coverage      | exigences + catalogue de contrôles                      | `CouvertureSchema`                       | statut normalisé selon l'état réel du contrôle, liens inverses                       |
| risks         | exigences non couvertes ou partielles                   | `RisqueSchema`                           | criticité brute et résiduel calculés par code (table d'atténuation)                  |
| governance    | synthèse des exigences, couverture, risques             | `GouvernanceSchema`                      | lots d'action, RACI, dépendances et KPI calculés par code ; décision humaine séparée |

## Flux de données d'un run

1. `ingest` : lecture du fichier officiel, segmentation, hash, écriture de `TX-xxxx` dans `textes.json`.
2. `extract` : chunks par groupes d'articles, appel structuré par chunk, fusion des doublons, vérification
   verbatim et articles, calcul de la confiance, IDs via le registre, écriture de `exigences.json`.
3. `matrices` : projections CSV / XLSX / MD dans `output/matrices/`.
4. `notion push` : upsert des pages, relations, statuts « À valider ».
5. Cockpit : validation humaine, écrite dans Notion, puis `notion pull` vers `data/store/validations.json`.
