# Modèle de données : les six bases Notion

Généré depuis `agent/src/notion/schema.ts` par `pnpm exec tsx scripts/gen-modele-donnees.mts`. Une base Notion = une data source (API 2025-09-03) ; la propriété title porte l’ID métier (`TX-0001`, `EX-0001`, `CT-0001`, `RK-0001`, `JP-0001`, `LA-0001`) ; les relations sont bidirectionnelles (`dual_property`).

Le store local `data/store/*.json` porte les mêmes objets avec des champs supplémentaires internes (articles segmentés, détail de confiance, détail de couverture, historique des versions) ; les schémas Zod correspondants sont dans `agent/src/store/types.ts` et leurs miroirs pydantic dans `cockpit/models.py`.

## Textes

| Propriété                      | Type                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ID                             | title                                                                                                                                                        |
| Titre                          | rich_text                                                                                                                                                    |
| Source                         | select (EUR-Lex, Légifrance, Judilibre, Assemblée nationale, Sénat, CNIL, ANSSI, Fichier local)                                                              |
| Type                           | select (Règlement UE, Directive UE, Loi, Ordonnance, Décret, Arrêté, Projet de loi, Proposition de loi, Décision, Délibération, Recommandation, Référentiel) |
| Référence officielle           | rich_text                                                                                                                                                    |
| URL officielle                 | url                                                                                                                                                          |
| Date de publication            | date                                                                                                                                                         |
| Date d'entrée en vigueur       | date                                                                                                                                                         |
| Date d'entrée en application   | date                                                                                                                                                         |
| Statut du texte                | select (En vigueur, Projet, Adopté, Abrogé, Modifié)                                                                                                         |
| Hash contenu                   | rich_text                                                                                                                                                    |
| Date de collecte               | date                                                                                                                                                         |
| Dernière modification détectée | date                                                                                                                                                         |
| Applicable à l'organisation    | select (Oui, Non, À déterminer)                                                                                                                              |
| Justification applicabilité    | rich_text                                                                                                                                                    |
| Confiance applicabilité        | number                                                                                                                                                       |
| Résumé                         | rich_text                                                                                                                                                    |
| Nombre d'articles              | number                                                                                                                                                       |
| Run ID                         | rich_text                                                                                                                                                    |
| Exigences                      | relation ← Exigences (miroir de « Texte »)                                                                                                                   |

## Exigences

| Propriété                 | Type                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ID                        | title                                                                                                         |
| Titre                     | rich_text                                                                                                     |
| Description               | rich_text                                                                                                     |
| Article(s) de référence   | rich_text                                                                                                     |
| Extrait verbatim          | rich_text                                                                                                     |
| URL de l'article          | url                                                                                                           |
| Vérifié dans la source    | checkbox                                                                                                      |
| Type d'obligation         | select (Obligation de faire, Interdiction, Notification, Documentaire, Gouvernance, Contractuelle, Technique) |
| Destinataires             | multi_select                                                                                                  |
| Échéance                  | date                                                                                                          |
| Type d'échéance           | select (Entrée en application, Transposition, Délai de notification, Périodique, Non précisée)                |
| Sanction                  | rich_text                                                                                                     |
| Niveau de sanction        | select (Faible, Moyen, Élevé, Critique, Non précisé)                                                          |
| Niveau de confiance       | number                                                                                                        |
| Statut de validation      | select (À valider, Validée, Corrigée, Rejetée, À revalider)                                                   |
| Validateur                | rich_text                                                                                                     |
| Date de validation        | date                                                                                                          |
| Commentaire de validation | rich_text                                                                                                     |
| Version corrigée          | rich_text                                                                                                     |
| Processus impactés        | multi_select                                                                                                  |
| Systèmes impactés         | multi_select                                                                                                  |
| Données concernées        | multi_select                                                                                                  |
| Contrats concernés        | rich_text                                                                                                     |
| Effort estimé             | select (Faible, Moyen, Élevé)                                                                                 |
| Couverture                | select (Couverte, Partielle, Non couverte, À évaluer)                                                         |
| Run ID                    | rich_text                                                                                                     |
| Texte                     | relation → Textes (miroir « Exigences »)                                                                      |
| Contrôles                 | relation → Contrôles (miroir « Exigences couvertes »)                                                         |
| Risques                   | relation → Risques (miroir « Exigences liées »)                                                               |
| Jurisprudence             | relation → Jurisprudence (miroir « Exigences liées »)                                                         |
| Lots d'action             | relation → Lots d'action (miroir « Exigences »)                                                               |

## Contrôles

| Propriété               | Type                                                          |
| ----------------------- | ------------------------------------------------------------- |
| ID                      | title                                                         |
| Nom                     | rich_text                                                     |
| Description             | rich_text                                                     |
| Référentiel             | select (ISO 27001:2022, NIST CSF 2.0, CIS v8, Interne, Autre) |
| Référence               | rich_text                                                     |
| Propriétaire            | rich_text                                                     |
| Statut de mise en œuvre | select (En place, Partiel, Planifié, Absent)                  |
| Efficacité              | select (Non évaluée, Faible, Satisfaisante, Forte)            |
| Preuves                 | rich_text                                                     |
| Écart constaté          | rich_text                                                     |
| Exigences couvertes     | relation ← Exigences (miroir de « Contrôles »)                |
| Risques atténués        | relation ← Risques (miroir de « Contrôles atténuants »)       |

## Risques

| Propriété            | Type                                                              |
| -------------------- | ----------------------------------------------------------------- |
| ID                   | title                                                             |
| Intitulé             | rich_text                                                         |
| Scénario             | rich_text                                                         |
| Catégorie            | select (Juridique, Financier, Opérationnel, Réputationnel, Cyber) |
| Probabilité          | number                                                            |
| Impact               | number                                                            |
| Risque résiduel      | number                                                            |
| Niveau résiduel      | select (Faible, Modéré, Élevé, Critique)                          |
| Traitement           | select (Réduire, Accepter, Transférer, Éviter)                    |
| Propriétaire         | rich_text                                                         |
| Statut               | select (Identifié, En traitement, Accepté, Clos)                  |
| Contrôles atténuants | relation → Contrôles (miroir « Risques atténués »)                |
| Exigences liées      | relation ← Exigences (miroir de « Risques »)                      |
| Lots d'action        | relation ← Lots d'action (miroir de « Risques »)                  |
| Criticité brute      | formula `prop("Probabilité") * prop("Impact")`                    |

## Jurisprudence

| Propriété                  | Type                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| ID                         | title                                                                       |
| Juridiction                | select (Cour de cassation, Conseil d'État, CJUE, Cour d'appel, CNIL, Autre) |
| Numéro                     | rich_text                                                                   |
| Date de décision           | date                                                                        |
| URL officielle             | url                                                                         |
| Résumé                     | rich_text                                                                   |
| Solution retenue           | rich_text                                                                   |
| Portée pour l'organisation | rich_text                                                                   |
| Pertinence                 | number                                                                      |
| Mots-clés                  | multi_select                                                                |
| Exigences liées            | relation ← Exigences (miroir de « Jurisprudence »)                          |

## Lots d'action

| Propriété            | Type                                               |
| -------------------- | -------------------------------------------------- |
| ID                   | title                                              |
| Titre                | rich_text                                          |
| Description          | rich_text                                          |
| Priorité             | select (P1, P2, P3, P4)                            |
| Responsable          | rich_text                                          |
| Échéance cible       | date                                               |
| Statut               | select (À planifier, En cours, Terminé, Bloqué)    |
| Cadre de gouvernance | select (TOGAF, ITIL, Hybride)                      |
| Phase ou pratique    | rich_text                                          |
| Livrable attendu     | rich_text                                          |
| Effort               | select (Faible, Moyen, Élevé)                      |
| Risques              | relation → Risques (miroir « Lots d'action »)      |
| Exigences            | relation ← Exigences (miroir de « Lots d'action ») |

## Journal de validation

Chaque décision humaine crée un commentaire sur la page Notion de l’exigence (`AAAA-MM-JJ HH:MM · Validée par … · motif`) ; `pnpm notion pull` recopie statut, validateur, date, commentaire et version corrigée dans `data/store/exigences.json` et journalise la décision dans `data/store/validations.json` (`id`, `exigence_id`, `action`, `validateur`, `date`, `commentaire`, `champs_modifies`, `source`).

## Identifiants et runs

Les identifiants sont attribués par `data/store/ids-registry.json` (clé métier normalisée → ID, jamais de renumérotation). Chaque exécution porte un `run_id` (`RUN-AAAAMMJJ-HHMM`) et laisse ses artefacts dans `data/runs/<run_id>/` (prompts, réponses, diffs, `metrics.json`).
