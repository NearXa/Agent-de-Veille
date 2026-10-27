import * as cheerio from 'cheerio';
import { collapseWhitespace } from '../utils/text.js';

/** HTML quelconque → texte brut avec sauts de ligne entre blocs (repli pour les sources inconnues). */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  $('p, div, li, tr, h1, h2, h3, h4, h5, h6, br, table').each((_, el) => {
    $(el).append('\n');
  });
  return collapseWhitespace($('body').text() || $.root().text());
}

/** Vrai si la page suit le format EUR-Lex Journal officiel (subdivisions ELI, classes oj-*). */
export function looksLikeEurlex(html: string): boolean {
  return html.includes('eli-subdivision') && html.includes('oj-ti-art');
}
