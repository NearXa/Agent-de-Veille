import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/sources/http.js';
import {
  JudilibreClient,
  JudilibreConnector,
  decisionToArticles,
  judilibreDecisionUrl,
} from '../src/sources/judilibre.js';
import {
  LegifranceConnector,
  flattenLegifrance,
  legifranceUrl,
  natureToType,
  toIsoDate,
} from '../src/sources/legifrance.js';
import { PISTE_URLS, PisteAuth } from '../src/sources/piste.js';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Routeur de réponses par préfixe d'URL, avec enregistrement des requêtes. */
function fakeFetch(routes: Record<string, (req: Recorded) => unknown>): {
  fetchImpl: typeof fetch;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {}))
      headers[k.toLowerCase()] = v;
    const body = init?.body
      ? typeof init.body === 'string'
        ? init.body
        : init.body.toString()
      : null;
    const req: Recorded = { url, method: init?.method ?? 'GET', headers, body };
    calls.push(req);
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[route]!(req)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('PisteAuth', () => {
  it('demande un jeton client_credentials, le met en cache et le renouvelle à expiration', async () => {
    let tokens = 0;
    const { fetchImpl, calls } = fakeFetch({
      [PISTE_URLS.sandbox.oauth]: () => ({
        access_token: `tok-${++tokens}`,
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    });
    let now = 1_000_000;
    const auth = new PisteAuth(
      { clientId: 'id', clientSecret: 'secret', env: 'sandbox' },
      new HttpClient({ fetchImpl, minIntervalMs: 0 }),
      () => now,
    );
    expect(await auth.getToken()).toBe('tok-1');
    expect(await auth.getToken()).toBe('tok-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(calls[0]!.body).toBe(
      'grant_type=client_credentials&client_id=id&client_secret=secret&scope=openid',
    );
    now += 3600 * 1000;
    expect(await auth.getToken()).toBe('tok-2');
    expect(await auth.authHeaders()).toEqual({ Authorization: 'Bearer tok-2' });
  });
});

describe('Légifrance', () => {
  const texte = {
    id: 'LEGITEXT000006068624',
    cid: 'LEGITEXT000006068624',
    title: "Loi n° 78-17 du 6 janvier 1978 relative à l'informatique, aux fichiers et aux libertés",
    nature: 'LOI',
    etat: 'VIGUEUR',
    dateParution: '1978-01-07',
    dateDebutVersion: 1700000000000,
    nor: null,
    eli: null,
    articles: [
      {
        id: 'LEGIARTI000037822962',
        num: '1',
        content: '<p>L&#39;informatique doit être au service de chaque citoyen.</p>',
        etat: 'VIGUEUR',
        intOrdre: 1,
      },
    ],
    sections: [
      {
        id: 'LEGISCTA1',
        title: 'Titre Ier : Dispositions communes',
        articles: [
          {
            id: 'LEGIARTI2',
            num: '2',
            content: '<p>La présente loi s&#39;applique aux traitements automatisés.</p>',
            etat: 'VIGUEUR',
            intOrdre: 2,
          },
          { id: 'LEGIARTI3', num: '3', content: '<p>Abrogé.</p>', etat: 'ABROGE', intOrdre: 3 },
        ],
        sections: [
          {
            id: 'LEGISCTA2',
            title: 'Chapitre Ier',
            articles: [
              {
                id: 'LEGIARTI4',
                num: '4',
                content: '<p>Les données sont collectées loyalement.</p>',
                etat: 'VIGUEUR',
                intOrdre: 4,
              },
            ],
          },
        ],
      },
    ],
  };

  it('aplatit sections et articles, exclut les articles abrogés, convertit natures et dates', () => {
    const articles = flattenLegifrance(texte);
    expect(articles.map((a) => a.numero)).toEqual(['1', '2', '4']);
    expect(articles[1]).toMatchObject({
      titre: 'Titre Ier : Dispositions communes',
      url: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI2',
    });
    expect(articles[1]?.contenu).toBe("La présente loi s'applique aux traitements automatisés.");
    expect(articles[2]?.titre).toBe('Chapitre Ier');
    expect(natureToType('LOI')).toBe('Loi');
    expect(natureToType('DECRET')).toBe('Décret');
    expect(toIsoDate('1978-01-07')).toBe('1978-01-07');
    expect(toIsoDate(1561132975000)).toBe('2019-06-21');
    expect(legifranceUrl('LEGITEXT000006068624')).toBe(
      'https://www.legifrance.gouv.fr/loda/id/LEGITEXT000006068624',
    );
  });

  it('consulte un texte par LEGITEXT avec le jeton PISTE et recherche par mots-clés', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [PISTE_URLS.sandbox.oauth]: () => ({ access_token: 'tok', expires_in: 3600 }),
      [`${PISTE_URLS.sandbox.legifrance}/consult/legiPart`]: () => texte,
      [`${PISTE_URLS.sandbox.legifrance}/search`]: () => ({
        totalResultNumber: 1,
        results: [
          {
            titles: [
              {
                id: 'LEGITEXT000000000042',
                title: 'Loi sur la résilience',
                legalStatus: 'VIGUEUR',
              },
            ],
            nature: 'LOI',
            datePublication: '2026-03-01',
          },
        ],
      }),
    });
    const http = new HttpClient({ fetchImpl, minIntervalMs: 0 });
    const auth = new PisteAuth({ clientId: 'id', clientSecret: 's', env: 'sandbox' }, http);
    const connector = new LegifranceConnector(auth, http, {
      env: 'sandbox',
      references: [
        { reference: 'LEGITEXT000006068624', titre: 'Loi Informatique et Libertés', suivi: true },
      ],
      motsCles: ['résilience'],
    });
    const refs = await connector.listRecent('2026-01-01T00:00:00.000Z');
    expect(refs.map((r) => r.reference)).toEqual(['LEGITEXT000006068624', 'LEGITEXT000000000042']);
    expect(refs[1]).toMatchObject({ date: '2026-03-01', type: 'Loi' });
    const search = calls.find((c) => c.url.endsWith('/search'))!;
    expect(search.headers.authorization).toBe('Bearer tok');
    expect(JSON.parse(search.body!)).toMatchObject({
      fond: 'LODA_DATE',
      recherche: { sort: 'PUBLICATION_DATE_DESC', pageSize: 20 },
    });

    const raw = await connector.fetchDocument({
      reference: 'LEGITEXT000006068624',
      url_officielle: '',
    });
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/consult/legiPart'))!.body!)).toMatchObject(
      { textId: 'LEGITEXT000006068624' },
    );
    const parsed = await connector.parse(raw);
    expect(parsed).toMatchObject({
      source: 'legifrance',
      type: 'Loi',
      url_officielle: 'https://www.legifrance.gouv.fr/loda/id/LEGITEXT000006068624',
    });
    expect(parsed.dates.publication).toBe('1978-01-07');
    expect(parsed.articles).toHaveLength(3);
    expect(parsed.hash_sha256).toHaveLength(64);
    expect(parsed.metadonnees.parser).toBe('legifrance-legiPart');
    expect(calls.filter((c) => c.url === PISTE_URLS.sandbox.oauth)).toHaveLength(1);
  });
});

describe('Judilibre', () => {
  const hit = {
    id: '5fca7d162a251e6bf9c78514',
    score: 0.68,
    jurisdiction: 'cc',
    chamber: 'civ3',
    number: '17-18.194',
    ecli: 'ECLI:FR:CCASS:2018:C301117',
    publication: ['c', 'b'],
    decision_date: '2018-12-20',
    type: 'arret',
    solution: 'rejet',
    summary: 'Résumé officiel',
    themes: ["Expropriation pour cause d'utilité publique"],
    highlights: { motivations: ['… <em>expropriation</em>'] },
  };
  const decision = {
    ...hit,
    text: 'INTRO. MOYENS DU POURVOI. MOTIFS DE LA COUR. PAR CES MOTIFS rejette.',
    zones: {
      introduction: [{ start: 0, end: 6 }],
      moyens: [{ start: 7, end: 25 }],
      motivations: [{ start: 26, end: 44 }],
      dispositif: [{ start: 45, end: 68 }],
    },
  };

  it('recherche avec l’en-tête KeyId et lit une décision par zones', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [`${PISTE_URLS.sandbox.judilibre}/search`]: () => ({
        page: 0,
        page_size: 20,
        total: 1,
        results: [hit],
      }),
      [`${PISTE_URLS.sandbox.judilibre}/decision`]: () => decision,
    });
    const http = new HttpClient({ fetchImpl, minIntervalMs: 0 });
    const client = new JudilibreClient('cle-api', http, 'sandbox');
    const result = await client.search({
      query: 'risque informatique',
      dateStart: '2024-01-01',
      jurisdictions: ['cc'],
      pageSize: 20,
    });
    expect(result.results?.[0]?.id).toBe(hit.id);
    const search = new URL(calls[0]!.url);
    expect(calls[0]!.headers.keyid).toBe('cle-api');
    expect(search.searchParams.get('query')).toBe('risque informatique');
    expect(search.searchParams.get('date_start')).toBe('2024-01-01');
    expect(search.searchParams.getAll('jurisdiction[]')).toEqual(['cc']);
    expect(search.searchParams.get('page_size')).toBe('20');

    const connector = new JudilibreConnector('cle-api', http, {
      env: 'sandbox',
      requete: 'risque informatique',
      juridictions: ['cc'],
    });
    const refs = await connector.listRecent('2024-01-01T00:00:00.000Z');
    expect(refs[0]).toMatchObject({
      reference: hit.id,
      url_officielle: judilibreDecisionUrl(hit.id),
      date: '2018-12-20',
      type: 'Décision',
    });
    expect(refs[0]?.titre).toBe('Cour de cassation 17-18.194 du 2018-12-20');

    const raw = await connector.fetchDocument({ reference: hit.id, url_officielle: '' });
    const parsed = await connector.parse(raw);
    expect(parsed.articles.map((a) => a.numero)).toEqual([
      'introduction',
      'moyens',
      'motivations',
      'dispositif',
    ]);
    expect(parsed.articles[3]?.contenu).toBe('PAR CES MOTIFS rejette.');
    expect(parsed.metadonnees).toMatchObject({ ecli: hit.ecli, solution: 'rejet' });
    expect(decisionToArticles({ id: 'x', text: 'Texte sans zones' })[0]).toMatchObject({
      numero: 'texte',
      contenu: 'Texte sans zones',
    });
  });
});
