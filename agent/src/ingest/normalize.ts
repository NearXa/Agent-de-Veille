import type { TypeTexte } from '../schemas/common.js';
import type { ArticleNormalise, DocumentBrut, TexteNormalise } from '../sources/types.js';
import { sha256 } from '../utils/hash.js';
import { collapseWhitespace } from '../utils/text.js';
import { detectTypeTexte, parseEurlexHtml } from './eurlex-html.js';
import { htmlToText, looksLikeEurlex } from './html-text.js';
import { segmentPlainText } from './segment.js';
import { detectApplicationDate } from './dates.js';

/** Texte intégral reconstruit à partir des articles (base du hash de contenu). */
export function buildContenuTexte(articles: ArticleNormalise[]): string {
  return articles
    .map((a) => {
      const heading = a.type === 'annexe' ? a.numero : `Article ${a.numero}`;
      return `${heading}${a.titre ? ` – ${a.titre}` : ''}\n${a.contenu}`;
    })
    .join('\n\n');
}

/** Normalise un document brut (HTML EUR-Lex, HTML quelconque ou texte) en `TexteNormalise`. */
export function normalizeDocument(raw: DocumentBrut): TexteNormalise {
  const text = raw.contenu.toString('utf8');
  let articles: ArticleNormalise[];
  let titre = raw.titre_hint ?? '';
  let type: TypeTexte | undefined = raw.type_hint;
  let entreeEnApplication: string | null;
  const metadonnees: Record<string, unknown> = {
    format: raw.format,
    fichier: raw.fichier,
    hash_brut_sha256: sha256(raw.contenu),
  };

  if (raw.format === 'html' && looksLikeEurlex(text)) {
    const parsed = parseEurlexHtml(text);
    articles = parsed.articles;
    titre = titre || parsed.titre;
    type = type ?? parsed.type;
    entreeEnApplication = parsed.entree_en_application;
    metadonnees.parser = 'eurlex-html';
    metadonnees.adoption = parsed.adoption;
    metadonnees.nombre_considerants = parsed.nombre_considerants;
    metadonnees.chapitres = parsed.chapitres;
  } else {
    const plain = raw.format === 'html' ? htmlToText(text) : text;
    articles = segmentPlainText(plain);
    const firstLine = collapseWhitespace(plain).split('\n')[0] ?? '';
    titre = titre || firstLine.slice(0, 200) || raw.reference;
    type = type ?? detectTypeTexte(titre, 'Référentiel');
    entreeEnApplication = detectApplicationDate(
      articles
        .slice(-3)
        .map((a) => a.contenu)
        .join('\n'),
    );
    metadonnees.parser = raw.format === 'html' ? 'html-text+regex' : 'regex';
  }

  const contenuTexte = buildContenuTexte(articles);
  return {
    source: raw.source,
    reference: raw.reference,
    titre,
    type,
    url_officielle: raw.url_officielle,
    dates: {
      publication: null,
      entree_en_vigueur: null,
      entree_en_application: entreeEnApplication,
    },
    contenu_texte: contenuTexte,
    articles,
    hash_sha256: sha256(contenuTexte),
    collecte_le: raw.recupere_le,
    metadonnees,
  };
}
