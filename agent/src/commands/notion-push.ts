import { PUSH_COLLECTIONS, pushToNotion, type PushCollection } from '../notion/push.js';
import { AppError } from '../utils/errors.js';

export interface NotionPushCommandOptions {
  run?: string;
  only?: string;
}

export default async function notionPushCommand(options: NotionPushCommandOptions): Promise<void> {
  let only: PushCollection[] | undefined;
  if (options.only) {
    only = options.only.split(',').map((v) => v.trim()) as PushCollection[];
    for (const c of only) {
      if (!PUSH_COLLECTIONS.includes(c))
        throw new AppError(`Collection inconnue : ${c} (attendu : ${PUSH_COLLECTIONS.join(', ')})`);
    }
  }
  const summary = await pushToNotion({ only, runId: options.run });
  console.log(
    `Textes    : ${summary.textes.created} créé(s), ${summary.textes.updated} mis à jour`,
  );
  console.log(
    `Exigences : ${summary.exigences.created} créée(s), ${summary.exigences.updated} mise(s) à jour`,
  );
  console.log(
    `Contrôles : ${summary.controles.created} créé(s), ${summary.controles.updated} mis à jour · Risques : ${summary.risques.created} / ${summary.risques.updated} · Jurisprudence : ${summary.jurisprudence.created} / ${summary.jurisprudence.updated} · Lots : ${summary.lots.created} / ${summary.lots.updated} · relations : ${summary.relations}`,
  );
  console.log(`${summary.calls} requête(s) Notion`);
}
