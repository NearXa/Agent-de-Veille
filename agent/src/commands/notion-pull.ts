import { pullFromNotion } from '../notion/pull.js';
import { store } from '../store/repository.js';

export default async function notionPullCommand(): Promise<void> {
  const s = await pullFromNotion();
  console.log(
    `${s.pages_lues} page(s) lue(s) · ${s.exigences_mises_a_jour} exigence(s) mise(s) à jour · ${s.decisions_journalisees} décision(s) journalisée(s) · ${s.lots_mis_a_jour} lot(s) mis à jour · ${s.calls} requête(s)`,
  );
  console.log(`journal : ${store.validations.file}`);
}
