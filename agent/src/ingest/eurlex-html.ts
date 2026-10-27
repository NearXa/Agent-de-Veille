import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { TypeTexte } from '../schemas/common.js';
import type { ArticleNormalise } from '../sources/types.js';
import { collapseWhitespace } from '../utils/text.js';
import { detectApplicationDate, parseDateFr } from './dates.js';

export interface EurlexParseResult {
  titre: string;
  type: TypeTexte;
  articles: ArticleNormalise[];
  adoption: string | null;
  entree_en_application: string | null;
  nombre_considerants: number;
  chapitres: string[];
}

/** Déduit le type de texte du titre officiel (« Règlement (UE) … », « Directive (UE) … »). */
export function detectTypeTexte(titre: string, fallback: TypeTexte = 'Règlement UE'): TypeTexte {
  const t = titre.toLowerCase();
  if (t.startsWith('règlement') || t.startsWith('reglement')) return 'Règlement UE';
  if (t.startsWith('directive')) return 'Directive UE';
  if (t.startsWith('décision') || t.startsWith('decision')) return 'Décision';
  if (t.startsWith('recommandation')) return 'Recommandation';
  return fallback;
}

const ACRONYMS = new Set([
  'UE',
  'CE',
  'CEE',
  'EEE',
  'BCE',
  'TIC',
  'ABE',
  'AEMF',
  'AEAPP',
  'ESMA',
  'EIOPA',
]);
const PROPER_NOUNS = new Map([
  ['parlement', 'Parlement'],
  ['conseil', 'Conseil'],
  ['commission', 'Commission'],
  ['euratom', 'Euratom'],
  ['union', 'Union'],
]);

/** « RÈGLEMENT (UE) 2022/2554 DU PARLEMENT EUROPÉEN ET DU CONSEIL » → casse de phrase française. */
export function sentenceCaseOjTitle(upper: string): string {
  if (upper !== upper.toUpperCase()) return upper;
  const words = upper
    .toLowerCase()
    .split(' ')
    .map((word) => {
      const core = word.replace(/[()]/g, '');
      if (ACRONYMS.has(core.toUpperCase())) return word.replace(core, core.toUpperCase());
      const proper = PROPER_NOUNS.get(core);
      return proper ? word.replace(core, proper) : word;
    });
  const joined = words.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function lineText($: cheerio.CheerioAPI, node: AnyNode): string {
  return collapseWhitespace($(node).text()).replace(/ {2,}/g, ' ');
}

/**
 * Contenu d'un article EUR-Lex : paragraphes numérotés (`<p class="oj-normal">`), points a), b)
 * rendus en tableaux à deux cellules (marqueur + texte), tableaux de définitions.
 * Les lignes sont conservées dans l'ordre du document.
 */
function articleContent($: cheerio.CheerioAPI, article: cheerio.Cheerio<AnyNode>): string {
  const lines: string[] = [];
  article.find('p, tr').each((_, node) => {
    const el = $(node);
    if (node.type !== 'tag') return;
    if (node.name === 'p') {
      if (el.hasClass('oj-ti-art') || el.hasClass('oj-sti-art')) return;
      if (el.closest('tr').length > 0) return; // traité au niveau de la ligne de tableau
      const text = lineText($, node);
      if (text) lines.push(text);
      return;
    }
    const cells = el
      .children('td, th')
      .map((_, cell) => lineText($, cell))
      .get()
      .filter((t) => t.length > 0);
    if (cells.length > 0) lines.push(cells.join(' '));
  });
  return lines.join('\n');
}

/** Parse une page HTML EUR-Lex (format Journal officiel, classes `oj-*` et `eli-subdivision`). */
export function parseEurlexHtml(html: string): EurlexParseResult {
  const $ = cheerio.load(html, { xml: false });

  const titleParts = $('p.oj-doc-ti')
    .map((_, p) => lineText($, p))
    .get()
    .filter((t) => t.length > 0);
  const docTitle = collapseWhitespace(titleParts.join(' '));
  const titre =
    titleParts.length > 0
      ? collapseWhitespace([sentenceCaseOjTitle(titleParts[0]!), ...titleParts.slice(1)].join(' '))
      : collapseWhitespace($('title').text());
  const type = detectTypeTexte(titre);
  const adoption = parseDateFr(docTitle);

  const articles: ArticleNormalise[] = [];
  let position = 0;
  $('div.eli-subdivision[id^="art_"]').each((_, node) => {
    const el = $(node);
    const id = el.attr('id') ?? '';
    const numero = id.replace(/^art_/, '');
    if (!/^\d+[a-z]*$/.test(numero)) return;
    const titreArticle = collapseWhitespace(el.find('p.oj-sti-art').first().text()) || null;
    articles.push({
      numero,
      titre: titreArticle,
      contenu: articleContent($, el),
      ancre: `#art_${numero}`,
      type: 'article',
      position: position++,
    });
  });

  $('div.eli-subdivision[id^="anx_"]').each((_, node) => {
    const el = $(node);
    const id = el.attr('id') ?? '';
    const numero = id.replace(/^anx_/, '');
    const heading = collapseWhitespace(
      el.find('p.oj-doc-ti, p.oj-ti-annotation, p.oj-ti-grseq-1').first().text(),
    );
    articles.push({
      numero: `Annexe ${numero}`,
      titre: heading || null,
      contenu: articleContent($, el),
      ancre: `#anx_${numero}`,
      type: 'annexe',
      position: position++,
    });
  });

  const chapitres = $('div[id^="cpt_"] > p.oj-ti-section-1')
    .map((_, p) => lineText($, p))
    .get();
  const lastArticles = articles
    .filter((a) => a.type === 'article')
    .slice(-3)
    .map((a) => a.contenu)
    .join('\n');

  return {
    titre,
    type,
    articles,
    adoption,
    entree_en_application: detectApplicationDate(lastArticles),
    nombre_considerants: $('div.eli-subdivision[id^="rct_"]').length,
    chapitres,
  };
}
