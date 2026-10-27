// Génère docs/modele-de-donnees.md à partir du schéma Notion du code (agent/src/notion/schema.ts),
// pour que la documentation ne dérive jamais de l'implémentation.
import { writeFileSync } from 'node:fs';
import {
  BASES,
  BASE_KEYS,
  FORMULAS,
  RELATIONS,
  type PropertySchema,
} from '../agent/src/notion/schema.ts';

function typeOf(schema: PropertySchema): string {
  const key = Object.keys(schema)[0] as keyof PropertySchema;
  if (key === 'select' || key === 'multi_select') {
    const options =
      (
        schema as {
          select?: { options: { name: string }[] };
          multi_select?: { options: { name: string }[] };
        }
      )[key]?.options ?? [];
    return `${key}${options.length ? ` (${options.map((o) => o.name).join(', ')})` : ''}`;
  }
  return key;
}

const lines: string[] = [
  '# Modèle de données : les six bases Notion',
  '',
  'Généré depuis `agent/src/notion/schema.ts` par `pnpm exec tsx scripts/gen-modele-donnees.mts`. Une base Notion = une data source (API 2025-09-03) ; la propriété title porte l’ID métier (`TX-0001`, `EX-0001`, `CT-0001`, `RK-0001`, `JP-0001`, `LA-0001`) ; les relations sont bidirectionnelles (`dual_property`).',
  '',
  'Le store local `data/store/*.json` porte les mêmes objets avec des champs supplémentaires internes (articles segmentés, détail de confiance, détail de couverture, historique des versions) ; les schémas Zod correspondants sont dans `agent/src/store/types.ts` et leurs miroirs pydantic dans `cockpit/models.py`.',
  '',
];
for (const key of BASE_KEYS) {
  const base = BASES[key];
  lines.push(`## ${base.titre}`, '', '| Propriété | Type |', '| --- | --- |');
  for (const [name, schema] of Object.entries(base.properties))
    lines.push(`| ${name} | ${typeOf(schema)} |`);
  for (const rel of RELATIONS.filter((r) => r.from === key))
    lines.push(
      `| ${rel.property} | relation → ${BASES[rel.to].titre} (miroir « ${rel.syncedName} ») |`,
    );
  for (const rel of RELATIONS.filter((r) => r.to === key))
    lines.push(
      `| ${rel.syncedName} | relation ← ${BASES[rel.from].titre} (miroir de « ${rel.property} ») |`,
    );
  for (const f of FORMULAS.filter((f) => f.base === key))
    lines.push(`| ${f.property} | formula \`${f.expression}\` |`);
  lines.push('');
}
lines.push(
  '## Journal de validation',
  '',
  'Chaque décision humaine crée un commentaire sur la page Notion de l’exigence (`AAAA-MM-JJ HH:MM · Validée par … · motif`) ; `pnpm notion pull` recopie statut, validateur, date, commentaire et version corrigée dans `data/store/exigences.json` et journalise la décision dans `data/store/validations.json` (`id`, `exigence_id`, `action`, `validateur`, `date`, `commentaire`, `champs_modifies`, `source`).',
  '',
  '## Identifiants et runs',
  '',
  'Les identifiants sont attribués par `data/store/ids-registry.json` (clé métier normalisée → ID, jamais de renumérotation). Chaque exécution porte un `run_id` (`RUN-AAAAMMJJ-HHMM`) et laisse ses artefacts dans `data/runs/<run_id>/` (prompts, réponses, diffs, `metrics.json`).',
  '',
);
writeFileSync('docs/modele-de-donnees.md', lines.join('\n'), 'utf8');
console.log('docs/modele-de-donnees.md généré :', lines.length, 'lignes');
