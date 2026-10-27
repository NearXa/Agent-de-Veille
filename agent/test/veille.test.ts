import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchOnce } from '../src/commands/watch.js';
import { findDuplicate, normalizeTitle } from '../src/ingest/dedup.js';
import { diffArticles, summarizeDiff } from '../src/ingest/diff.js';
import { HttpClient, HttpError } from '../src/sources/http.js';
import { itemsSince, parseFeed } from '../src/sources/rss.js';
import { store } from '../src/store/repository.js';
import type { ArticleRecord, TexteRecord } from '../src/store/types.js';
import { fileExists } from '../src/utils/fs.js';
import { paths } from '../src/utils/paths.js';
import { useTmpRoot } from './helpers/tmp-root.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const realRoot = path.resolve(here, '..', '..');

const article = (numero: string, contenu: string, titre: string | null = null): ArticleRecord => ({
  numero,
  titre,
  contenu,
  ancre: `#art_${numero}`,
  type: 'article',
  position: Number(numero),
});

describe('diff par article', () => {
  it('détecte ajouts, suppressions et modifications avec extrait', () => {
    const before = [article('1', 'Alpha.\nBeta.'), article('2', 'Gamma.'), article('3', 'Delta.')];
    const after = [
      article('1', 'Alpha.\nBeta modifiée.'),
      article('3', 'Delta.'),
      article('4', 'Epsilon.'),
    ];
    const diff = diffArticles(before, after);
    expect(diff.articles_ajoutes).toEqual(['4']);
    expect(diff.articles_supprimes).toEqual(['2']);
    expect(diff.articles_modifies).toEqual(['1']);
    expect(diff.details[0]).toMatchObject({
      numero: '1',
      lignes_ajoutees: 1,
      lignes_supprimees: 1,
    });
    expect(diff.details[0]?.extrait).toContain('+ Beta modifiée.');
    expect(summarizeDiff(diff)).toBe('1 ajouté(s), 1 supprimé(s), 1 modifié(s)');
  });

  it('ignore les différences d’espaces et considère un titre changé comme une modification', () => {
    expect(diffArticles([article('1', 'A  B')], [article('1', 'A B')]).articles_modifies).toEqual(
      [],
    );
    expect(
      diffArticles([article('1', 'A', 'Titre')], [article('1', 'A', 'Autre')]).articles_modifies,
    ).toEqual(['1']);
  });
});

describe('déduplication inter-sources', () => {
  const base: TexteRecord = {
    id: 'TX-0001',
    source: 'eurlex',
    reference: 'CELEX:32022R2554',
    titre: 'Règlement (UE) 2022/2554 (Texte présentant de l’intérêt pour l’EEE)',
    type: 'Règlement UE',
    url_officielle: 'https://eur-lex.europa.eu/x',
    urls_connues: [],
    date_publication: null,
    date_entree_en_vigueur: null,
    date_entree_en_application: null,
    statut_texte: 'En vigueur',
    hash_sha256: 'c'.repeat(64),
    collecte_le: '2026-10-27T16:01:00.000Z',
    derniere_modification_detectee: null,
    fichier_source: null,
    applicable: 'À déterminer',
    justification_applicabilite: null,
    confiance_applicabilite: null,
    resume: null,
    nombre_articles: 0,
    articles: [],
    run_id: 'RUN-20261027-1601',
    version: 1,
    historique: [],
  };

  it('retrouve un doublon par référence, hash puis titre normalisé', () => {
    expect(
      findDuplicate([base], {
        source: 'eurlex',
        reference: 'CELEX:32022R2554',
        hash_sha256: 'x'.repeat(64),
        titre: 'autre',
      })?.raison,
    ).toBe('reference');
    expect(
      findDuplicate([base], {
        source: 'legifrance',
        reference: 'JORF1',
        hash_sha256: 'c'.repeat(64),
        titre: 'autre',
      })?.raison,
    ).toBe('hash');
    expect(
      findDuplicate([base], {
        source: 'legifrance',
        reference: 'JORF1',
        hash_sha256: 'd'.repeat(64),
        titre: 'Règlement (UE) 2022/2554',
      })?.raison,
    ).toBe('titre');
    expect(
      findDuplicate([base], {
        source: 'legifrance',
        reference: 'JORF1',
        hash_sha256: 'd'.repeat(64),
        titre: 'Directive NIS2',
      }),
    ).toBeUndefined();
    expect(
      normalizeTitle('Règlement (UE) 2022/2554 (Texte présentant de l’intérêt pour l’EEE)'),
    ).toBe('reglement ue 2022 2554');
  });
});

describe('flux RSS et Atom', () => {
  it('parse RSS 2.0 et filtre par date', () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>CNIL</title>
      <item><title>Délibération n° 2026-001</title><link>https://www.cnil.fr/a</link><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[Résumé <b>A</b>]]></description><guid>a</guid></item>
      <item><title>Recommandation B</title><link>https://www.cnil.fr/b</link><pubDate>Mon, 20 Oct 2026 10:00:00 GMT</pubDate></item>
      </channel></rss>`;
    const feed = parseFeed(rss);
    expect(feed.titre).toBe('CNIL');
    expect(feed.items).toHaveLength(2);
    expect(feed.items[0]).toMatchObject({
      titre: 'Délibération n° 2026-001',
      lien: 'https://www.cnil.fr/a',
      date: '2026-10-26T10:00:00.000Z',
      guid: 'a',
    });
    expect(feed.items[0]?.description).toContain('Résumé');
    expect(itemsSince(feed.items, '2026-10-22T00:00:00.000Z').map((i) => i.titre)).toEqual([
      'Délibération n° 2026-001',
    ]);
  });

  it('parse Atom', () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>ANSSI</title>
      <entry><title>Avis 1</title><link rel="alternate" href="https://www.cert.ssi.gouv.fr/avis/1/"/><updated>2026-10-25T08:00:00Z</updated><id>urn:1</id><summary>S</summary></entry></feed>`;
    const feed = parseFeed(atom);
    expect(feed.titre).toBe('ANSSI');
    expect(feed.items[0]).toMatchObject({
      titre: 'Avis 1',
      lien: 'https://www.cert.ssi.gouv.fr/avis/1/',
      date: '2026-10-25T08:00:00.000Z',
      guid: 'urn:1',
    });
  });
});

describe('client HTTP', () => {
  const sequence = (
    responses: (() => Response)[],
  ): { fetchImpl: typeof fetch; calls: string[] } => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      const next = responses.shift();
      if (!next) throw new Error('plus de réponse prévue');
      return next();
    }) as typeof fetch;
    return { fetchImpl, calls };
  };

  it('réessaie sur 5xx puis réussit', async () => {
    const { fetchImpl, calls } = sequence([
      () => new Response('boom', { status: 500 }),
      () =>
        new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ]);
    const client = new HttpClient({ fetchImpl, retries: 2, minIntervalMs: 0 });
    const res = await client.get('https://example.org/doc');
    expect(res.ok).toBe(true);
    expect(res.text()).toContain('ok');
    expect(calls).toHaveLength(2);
    expect(client.requests).toBe(2);
  });

  it('ne réessaie pas sur 404 et signale un 202 vide comme un refus', async () => {
    const a = sequence([() => new Response('absent', { status: 404 })]);
    await expect(
      new HttpClient({ fetchImpl: a.fetchImpl, retries: 2, minIntervalMs: 0 }).get(
        'https://example.org/x',
      ),
    ).rejects.toThrow(HttpError);
    expect(a.calls).toHaveLength(1);
    const b = sequence([() => new Response(null, { status: 202 })]);
    await expect(
      new HttpClient({ fetchImpl: b.fetchImpl, retries: 2, minIntervalMs: 0 }).get(
        'https://eur-lex.europa.eu/x',
      ),
    ).rejects.toThrow(/202 sans contenu/);
    expect(b.calls).toHaveLength(1);
  });
});

describe('watch --once (source fichier local)', () => {
  let tmp: ReturnType<typeof useTmpRoot>;
  beforeEach(() => {
    tmp = useTmpRoot();
    cpSync(path.join(realRoot, 'config'), path.join(tmp.root, 'config'), { recursive: true });
    mkdirSync(path.join(tmp.root, 'data', 'sources'), { recursive: true });
    cpSync(
      path.join(here, 'fixtures', 'dora-art5-7.html'),
      path.join(tmp.root, 'data', 'sources', 'dora-32022R2554-fr.html'),
    );
  });
  afterEach(() => tmp.cleanup());

  it('ingère les documents déclarés puis les reconnaît inchangés, et ignore les sources désactivées', async () => {
    const noNetwork = (async () => {
      throw new Error('réseau interdit dans les tests');
    }) as unknown as typeof fetch;
    const first = await watchOnce({ source: 'local-file,legifrance', fetchImpl: noNetwork });
    expect(first.sources.map((s) => s.source)).toEqual(['local-file']);
    expect(first.sources[0]).toMatchObject({
      statut: 'ok',
      references: 1,
      nouveaux: 1,
      modifies: 0,
      inchanges: 0,
      extraits: 0,
    });
    expect(store.textes.readAll()[0]).toMatchObject({
      id: 'TX-0001',
      source: 'eurlex',
      reference: 'CELEX:32022R2554',
    });
    expect(fileExists(paths.runs('watch-state.json'))).toBe(true);

    const second = await watchOnce({ source: 'local-file', fetchImpl: noNetwork });
    expect(second.sources[0]).toMatchObject({ references: 1, nouveaux: 0, inchanges: 1 });
  });
});
