# CLAUDE.md : conventions et commandes du projet

Projet d'atelier EPITA : agent de veille continue GRC et législative. **Lire `SPEC.md` en entier avant
toute modification.** Les phases, critères de fin et règles de travail y sont définis (sections 17 et 18).

## Commandes

| Action                      | Commande                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Installer                   | `scripts/setup.sh` (ou `pnpm install` puis `python3 -m venv .venv && .venv/bin/pip install -r cockpit/requirements.txt`) |
| Aide CLI                    | `pnpm agent --help`                                                                                                      |
| Vérifier la configuration   | `pnpm agent config`                                                                                                      |
| Lint / typecheck / tests TS | `pnpm lint` · `pnpm typecheck` · `pnpm test` (ou `pnpm check` pour les trois)                                            |
| Tests Python                | `pnpm cockpit:test` (`.venv/bin/python -m pytest cockpit/tests -q`)                                                      |
| Cockpit                     | `pnpm cockpit` (`.venv/bin/streamlit run cockpit/app.py`)                                                                |
| Parcours de démo            | `pnpm agent demo` (phase 1)                                                                                              |
| Workers Notion              | `pnpm notion init` · `pnpm notion push` · `pnpm notion pull` · `pnpm notion watch`                                       |

## Conventions (SPEC.md, section 5)

- Agent : Node.js **22+** (exigé par AI SDK 7), TypeScript strict, ESM (`module: NodeNext`, imports relatifs avec `.js`), `import type` obligatoire pour les types.
- Cockpit : Python 3.11+, Streamlit multipage (`st.navigation`), pydantic en miroir des schémas Zod.
- Code, commentaires et logs en français ; identifiants de code en anglais (`fetchDocument`, `verbatimCheck`) ; termes techniques non traduits.
- Dates stockées en ISO 8601, affichées au format français dans l'UI.
- Conventional commits (`feat(ingest): …`, `fix(notion): …`), un commit par fonctionnalité, lint + typecheck + tests avant chaque commit.
- Aucun secret dans le code ni dans git : `.env` (ignoré) et `.env.example` (à jour). `data/raw/`, `data/cache/`, `data/runs/`, `output/`, `notion/ids.json` sont ignorés ; `data/sources/` (textes officiels) et `data/store/` sont versionnés.
- Fichiers courts, une responsabilité par module, interfaces TypeScript documentées pour le travail en parallèle.

## Règles dures (SPEC.md, section 18)

1. Terminer la phase en cours avant d'ajouter autre chose ; la démo reste fonctionnelle sur `main`.
2. Ne jamais inventer une référence d'article, une URL, une décision de justice ou une échéance : ce qui n'est pas vérifié est marqué `non vérifié` et remonté.
3. Vérifier la documentation officielle (AI SDK, Notion, PISTE) avant d'implémenter un appel d'API.
4. Ne jamais modifier les fichiers de `data/sources/` (originaux officiels).
5. Demander avant toute opération destructive (bases Notion, store, données).
6. Les interprétations juridiques sont marquées pour validation humaine, jamais tranchées.
7. Tenir `docs/journal.md` à jour à chaque phase (« fait pendant l'atelier » / « ajouté après »).

## Décisions techniques à connaître

- LLM via Vercel AI SDK 7 : `generateText` + `Output.object` (schéma Zod) ; `generateObject` est déprécié. Les modèles Claude 5.x n'acceptent pas `temperature` : elle n'est jamais envoyée, la reproductibilité vient du cache `data/cache/llm/` (clé = hash provider + modèle + schéma + version du prompt + contenu).
- Appel structuré centralisé dans `agent/src/llm/structured.ts` (cache, 3 tentatives avec renvoi des erreurs Zod, compteur de coût et garde-fou `LLM_MAX_COST_PER_RUN`).
- Notion : API « data sources » (`Notion-Version: 2025-09-03`), une base = une data source, upsert par la propriété title (ID métier), relations `dual_property` posées après la création des 6 bases.
- IDs stables via `data/store/ids-registry.json` (`agent/src/store/ids.ts`) : jamais de renumérotation.
- Chemins relatifs à la racine du dépôt (`agent/src/utils/paths.ts`), commandes à lancer depuis la racine.
- Piège d'écriture de fichiers : les séquences `\uXXXX` écrites dans un heredoc shell peuvent devenir des caractères littéraux ; préférer `String.fromCharCode` ou vérifier avec `grep -P`.
- Tests : vitest avec `LOG_LEVEL=silent`, fixtures `agent/test/fixtures/` (extrait officiel DORA art. 5 à 7, réponse LLM rejouable), faux client Notion `agent/test/helpers/fake-notion.ts`.

## Structure

Voir `SPEC.md` section 6. Points d'entrée : `agent/src/cli.ts` (commandes), `agent/src/commands/` (une commande par fichier), `cockpit/app.py` (navigation Streamlit), `config/*.yaml` (organisation, contrôles, risques, sources).
