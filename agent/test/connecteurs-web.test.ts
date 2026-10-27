import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EurlexConnector, celexFromLink, normalizeCelex } from '../src/sources/eurlex.js';
import { HttpClient } from '../src/sources/http.js';
import { RssPageConnector, feedReference } from '../src/sources/rss-page.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(here, 'fixtures', 'dora-art5-7.html'));

function router(routes: Record<string, () => Response>): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return key ? routes[key]!() : new Response('absent', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('EUR-Lex', () => {
  it('normalise les CELEX et les extrait des liens de flux', () => {
    expect(normalizeCelex('32022R2554')).toBe('CELEX:32022R2554');
    expect(normalizeCelex('celex:32022R2554')).toBe('CELEX:32022R2554');
    expect(
      celexFromLink('https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32022L2555'),
    ).toBe('CELEX:32022L2555');
    expect(celexFromLink('http://publications.europa.eu/resource/celex/32016R0679')).toBe(
      'CELEX:32016R0679',
    );
    expect(celexFromLink('https://eur-lex.europa.eu/eli/reg/2022/2554/oj')).toBeNull();
  });

  it('récupère le HTML officiel, replie sur une URL alternative, et signale un refus 202', async () => {
    const official = 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554';
    const alt = 'http://publications.europa.eu/resource/celex/32022R2554';
    const ok = router({
      [official]: () =>
        new Response(fixture, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const connector = new EurlexConnector(
      new HttpClient({ fetchImpl: ok.fetchImpl, minIntervalMs: 0, retries: 0 }),
      {
        references: [{ reference: '32022R2554', titre: 'DORA', suivi: true }],
        urlsAlternatives: ['http://publications.europa.eu/resource/celex/{celex}'],
      },
    );
    const refs = await connector.listRecent();
    expect(refs[0]).toMatchObject({ reference: 'CELEX:32022R2554', url_officielle: official });
    const raw = await connector.fetchDocument({
      reference: 'CELEX:32022R2554',
      url_officielle: official,
    });
    const texte = await connector.parse(raw);
    expect(texte.articles).toHaveLength(3);
    expect(ok.calls).toEqual([official]);

    const fallback = router({
      [official]: () => new Response(null, { status: 202 }),
      [alt]: () => new Response(fixture, { status: 200 }),
    });
    const c2 = new EurlexConnector(
      new HttpClient({ fetchImpl: fallback.fetchImpl, minIntervalMs: 0, retries: 0 }),
      {
        references: [],
        urlsAlternatives: ['http://publications.europa.eu/resource/celex/{celex}'],
      },
    );
    const raw2 = await c2.fetchDocument({ reference: '32022R2554', url_officielle: '' });
    expect(fallback.calls).toEqual([official, alt]);
    expect((await c2.parse(raw2)).articles).toHaveLength(3);

    const refused = router({ [official]: () => new Response(null, { status: 202 }) });
    const c3 = new EurlexConnector(
      new HttpClient({ fetchImpl: refused.fetchImpl, minIntervalMs: 0, retries: 0 }),
      { references: [] },
    );
    await expect(c3.fetchDocument({ reference: '32022R2554', url_officielle: '' })).rejects.toThrow(
      /connecteur fichier local/,
    );
  });

  it('lit les nouveautés d’un flux et filtre par mots-clés', async () => {
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>JOUE</title>
      <item><title>Règlement résilience numérique</title><link>https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32022R2554</link><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate></item>
      <item><title>Pêche au thon</title><link>https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32026R0001</link><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate></item>
      <item><title>Ancien texte numérique</title><link>https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679</link><pubDate>Mon, 01 Jan 2024 08:00:00 GMT</pubDate></item>
      </channel></rss>`;
    const r = router({
      'https://example.org/feed': () =>
        new Response(feed, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
    });
    const connector = new EurlexConnector(
      new HttpClient({ fetchImpl: r.fetchImpl, minIntervalMs: 0 }),
      { references: [], feeds: ['https://example.org/feed'], motsCles: ['numérique'] },
    );
    const refs = await connector.listRecent('2026-10-01T00:00:00.000Z');
    expect(refs.map((x) => x.reference)).toEqual(['CELEX:32022R2554']);
  });
});

describe('connecteur flux + page', () => {
  it('liste les entrées récentes puis récupère et segmente la page', async () => {
    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>CNIL</title>
      <item><title>Délibération SAN-2026-001</title><link>https://www.cnil.fr/fr/deliberation-1</link><guid>https://www.cnil.fr/fr/deliberation-1</guid><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate><description>Sanction</description></item>
      <item><title>Actualité sans rapport</title><link>https://www.cnil.fr/fr/actu</link><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate></item>
      </channel></rss>`;
    const page = `<html><head><title>Délibération SAN-2026-001</title></head><body><h1>Délibération SAN-2026-001</h1><p>Article 1</p><p>La société est condamnée.</p><p>Article 2</p><p>La présente délibération sera publiée.</p></body></html>`;
    const r = router({
      'https://www.cnil.fr/rss': () =>
        new Response(feed, { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
      'https://www.cnil.fr/fr/deliberation-1': () =>
        new Response(page, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    });
    const connector = new RssPageConnector(
      new HttpClient({ fetchImpl: r.fetchImpl, minIntervalMs: 0 }),
      {
        id: 'cnil',
        feeds: ['https://www.cnil.fr/rss'],
        typeParDefaut: 'Délibération',
        motsCles: ['délibération', 'sanction'],
      },
    );
    const refs = await connector.listRecent();
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      reference: 'https://www.cnil.fr/fr/deliberation-1',
      type: 'Délibération',
    });
    expect(
      feedReference({ titre: 'x', lien: 'https://a', date: null, description: null, guid: null }),
    ).toBe('https://a');
    const raw = await connector.fetchDocument({
      reference: refs[0]!.reference,
      url_officielle: refs[0]!.url_officielle,
      type: 'Délibération',
    });
    const texte = await connector.parse(raw);
    expect(texte.source).toBe('cnil');
    expect(texte.type).toBe('Délibération');
    expect(texte.articles.map((a) => a.numero)).toEqual(['1', '2']);
    expect(texte.articles[0]?.contenu).toBe('La société est condamnée.');
  });

  it('transforme une page sans articles en section unique', async () => {
    const page = `<html><body><h1>Avis CERT-FR</h1><p>Une vulnérabilité critique affecte le produit X.</p></body></html>`;
    const r = router({
      'https://www.cert.ssi.gouv.fr/avis/1/': () =>
        new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }),
    });
    const connector = new RssPageConnector(
      new HttpClient({ fetchImpl: r.fetchImpl, minIntervalMs: 0 }),
      { id: 'anssi', feeds: [], typeParDefaut: 'Recommandation' },
    );
    const raw = await connector.fetchDocument({
      reference: 'avis-1',
      url_officielle: 'https://www.cert.ssi.gouv.fr/avis/1/',
      titre: 'Avis CERT-FR',
    });
    const texte = await connector.parse(raw);
    expect(texte.articles).toHaveLength(1);
    expect(texte.articles[0]).toMatchObject({
      numero: 'document',
      type: 'section',
      url: 'https://www.cert.ssi.gouv.fr/avis/1/',
    });
    expect(texte.articles[0]?.contenu).toContain('vulnérabilité critique');
    expect(texte.hash_sha256).toHaveLength(64);
  });
});

describe('Sénat (open data CSV)', () => {
  it('parse le CSV « ; » ISO-8859-1, filtre par date et mots-clés, puis complète par le flux', async () => {
    const { parseCsv, parseDossiersSenat, parseSenatDate, SenatConnector } =
      await import('../src/sources/senat.js');
    expect(parseCsv('a;"b;c";"d ""e"""\nf;g;h\n')).toEqual([
      ['a', 'b;c', 'd "e"'],
      ['f', 'g', 'h'],
    ]);
    expect(parseSenatDate('2026-10-23')).toBe('2026-10-23');
    expect(parseSenatDate('23/10/2026')).toBe('2026-10-23');
    expect(parseSenatDate('23 octobre 2026')).toBe('2026-10-23');
    const csvText =
      'Titre;Type de dossier;Date initiale;URL du dossier;État du dossier;Décision du CC;Date de la décision;Date de promulgation;Numéro de la loi;Thèmes\n' +
      'Projet de loi résilience numérique;Projet de loi;2026-10-20;https://www.senat.fr/dossier-legislatif/pjl26-001.html;En cours;;;;;Économie et finances|Société\n' +
      'Proposition de loi pêche;Proposition de loi;2026-10-21;https://www.senat.fr/dossier-legislatif/ppl26-002.html;En cours;;;;;Agriculture\n' +
      'Ancien projet cyber;Projet de loi;2020-01-01;https://www.senat.fr/dossier-legislatif/pjl19-003.html;Promulgué;;;;2020-1;Société\n';
    const latin1 = Buffer.from(csvText, 'latin1');
    const dossiers = parseDossiersSenat(new TextDecoder('iso-8859-1').decode(latin1));
    expect(dossiers).toHaveLength(3);
    expect(dossiers[0]).toMatchObject({
      titre: 'Projet de loi résilience numérique',
      type: 'Projet de loi',
      date_initiale: '2026-10-20',
      themes: ['Économie et finances', 'Société'],
    });

    const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Sénat</title><item><title>Texte cyber N° 93</title><link>http://www.senat.fr/leg/ppr26-093.html</link><pubDate>Fri,23 Oct 2026 17:38:54 GMT</pubDate></item></channel></rss>`;
    const r = router({
      'https://data.senat.fr/data/dosleg/dossiers-legislatifs.csv': () =>
        new Response(latin1, { status: 200, headers: { 'content-type': 'text/csv' } }),
      'https://www.senat.fr/rss/textes.rss': () =>
        new Response(feed, { status: 200, headers: { 'content-type': 'application/x-rss+xml' } }),
    });
    const connector = new SenatConnector(
      new HttpClient({ fetchImpl: r.fetchImpl, minIntervalMs: 0 }),
      {
        csv: 'https://data.senat.fr/data/dosleg/dossiers-legislatifs.csv',
        feeds: ['https://www.senat.fr/rss/textes.rss'],
        motsCles: ['numérique', 'cyber'],
      },
    );
    const refs = await connector.listRecent('2026-01-01T00:00:00.000Z');
    expect(refs.map((x) => x.reference)).toEqual([
      'https://www.senat.fr/dossier-legislatif/pjl26-001.html',
      'http://www.senat.fr/leg/ppr26-093.html',
    ]);
    expect(refs[0]?.type).toBe('Projet de loi');
    expect(refs[1]?.date).toBe('2026-10-23T17:38:54.000Z');
  });
});
