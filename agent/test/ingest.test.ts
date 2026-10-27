import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectApplicationDate, parseDateFr } from '../src/ingest/dates.js';
import { parseEurlexHtml } from '../src/ingest/eurlex-html.js';
import { normalizeDocument } from '../src/ingest/normalize.js';
import { segmentPlainText } from '../src/ingest/segment.js';
import { containsNormalized } from '../src/utils/text.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(path.join(here, 'fixtures', 'dora-art5-7.html'), 'utf8');
const officiel = readFileSync(
  path.resolve(here, '..', '..', 'data', 'sources', 'dora-32022R2554-fr.html'),
  'utf8',
);

describe('parseEurlexHtml (fixture articles 5 à 7)', () => {
  const parsed = parseEurlexHtml(fixture);

  it('segmente trois articles avec numéro, titre et ancre', () => {
    expect(parsed.articles.map((a) => a.numero)).toEqual(['5', '6', '7']);
    expect(parsed.articles[0]?.titre).toBe('Gouvernance et organisation');
    expect(parsed.articles[1]?.titre).toBe('Cadre de gestion du risque lié aux TIC');
    expect(parsed.articles[1]?.ancre).toBe('#art_6');
    expect(parsed.articles.map((a) => a.position)).toEqual([0, 1, 2]);
  });

  it('conserve les paragraphes numérotés et les points a), b) des tableaux', () => {
    const art6 = parsed.articles[1]!.contenu;
    expect(
      art6.startsWith(
        '1. Les entités financières disposent d’un cadre de gestion du risque lié aux TIC solide',
      ),
    ).toBe(true);
    expect(art6).toContain('\n8. ');
    expect(art6).toMatch(
      /\na\) expliquant la manière dont le cadre de gestion du risque lié aux TIC/,
    );
    expect(art6).not.toContain('Article 6');
  });

  it('déduit le titre officiel, le type et la date d’adoption', () => {
    expect(
      parsed.titre.startsWith(
        'Règlement (UE) 2022/2554 du Parlement européen et du Conseil du 14 décembre 2022',
      ),
    ).toBe(true);
    expect(parsed.type).toBe('Règlement UE');
    expect(parsed.adoption).toBe('2022-12-14');
  });
});

describe('parseEurlexHtml (texte officiel complet)', () => {
  const parsed = parseEurlexHtml(officiel);

  it('trouve les 64 articles de DORA et 106 considérants', () => {
    expect(parsed.articles).toHaveLength(64);
    expect(parsed.articles[0]?.numero).toBe('1');
    expect(parsed.articles[63]?.numero).toBe('64');
    expect(parsed.nombre_considerants).toBe(106);
    expect(parsed.chapitres.length).toBeGreaterThanOrEqual(8);
  });

  it('détecte la date d’entrée en application dans l’article final', () => {
    expect(parsed.entree_en_application).toBe('2025-01-17');
  });

  it('retrouve un extrait verbatim de l’article 6 après normalisation', () => {
    const art6 = parsed.articles.find((a) => a.numero === '6')!;
    expect(
      containsNormalized(
        art6.contenu,
        "Les entités financières disposent d'un cadre de gestion du risque lié aux TIC solide, complet et bien documenté",
      ),
    ).toBe(true);
  });
});

describe('normalizeDocument', () => {
  it('produit un texte normalisé avec hash de contenu stable', () => {
    const raw = {
      source: 'eurlex' as const,
      reference: 'CELEX:32022R2554',
      url_officielle: 'https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32022R2554',
      format: 'html' as const,
      contenu: Buffer.from(fixture, 'utf8'),
      fichier: 'agent/test/fixtures/dora-art5-7.html',
      recupere_le: '2026-10-27T16:01:00.000Z',
    };
    const a = normalizeDocument(raw);
    const b = normalizeDocument({
      ...raw,
      contenu: Buffer.from(fixture.replace('generated_on', 'generated_at'), 'utf8'),
    });
    expect(a.articles).toHaveLength(3);
    expect(a.hash_sha256).toHaveLength(64);
    expect(a.hash_sha256).toBe(b.hash_sha256);
    expect(a.metadonnees.parser).toBe('eurlex-html');
    expect(a.contenu_texte).toContain('Article 6 – Cadre de gestion du risque lié aux TIC');
  });
});

describe('segmentPlainText et dates', () => {
  it('segmente un texte brut sur les titres « Article N »', () => {
    const texte = `Loi fictive\n\nArticle 1\nObjet\nLa présente loi fixe des règles.\n\nArticle 2 - Champ d'application\n1. Elle s'applique aux entités.\n2. Elle entre en vigueur le 1er mars 2027.\n\nANNEXE I\nListe\n- point`;
    const articles = segmentPlainText(texte);
    expect(articles.map((a) => a.numero)).toEqual(['1', '2', 'Annexe I']);
    expect(articles[0]).toMatchObject({
      titre: 'Objet',
      contenu: 'La présente loi fixe des règles.',
    });
    expect(articles[1]?.titre).toBe("Champ d'application");
    expect(articles[1]?.contenu).toContain('2. Elle entre en vigueur');
    expect(articles[2]?.type).toBe('annexe');
  });

  it('convertit les dates françaises', () => {
    expect(parseDateFr('du 14 décembre 2022 sur')).toBe('2022-12-14');
    expect(parseDateFr('le 1er mars 2027')).toBe('2027-03-01');
    expect(parseDateFr('aucune date')).toBeNull();
    expect(detectApplicationDate('Il s’applique à partir du 17 janvier 2025.')).toBe('2025-01-17');
    expect(
      detectApplicationDate("Les articles s'appliquent à compter du 2 août 2026 au plus tard"),
    ).toBe('2026-08-02');
  });
});
