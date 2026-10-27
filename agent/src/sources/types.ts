import type { SourceId, TypeTexte } from '../schemas/common.js';

/** Document tel que récupéré (fichier local ou réseau), avant normalisation. */
export interface DocumentBrut {
  /** Source d'origine du document (eurlex, legifrance...), pas le connecteur utilisé. */
  source: SourceId;
  reference: string;
  url_officielle: string;
  format: 'html' | 'pdf' | 'txt' | 'json';
  contenu: Buffer;
  fichier: string | null;
  recupere_le: string;
  titre_hint?: string;
  type_hint?: TypeTexte;
}

export interface ArticleNormalise {
  numero: string;
  titre: string | null;
  contenu: string;
  ancre: string | null;
  /** URL absolue de l'article quand la source en fournit une (Légifrance), sinon null. */
  url?: string | null;
  type: 'article' | 'annexe' | 'considerant' | 'section';
  position: number;
}

export interface DatesTexte {
  publication: string | null;
  entree_en_vigueur: string | null;
  entree_en_application: string | null;
}

/** Texte normalisé : sortie commune de tous les connecteurs. */
export interface TexteNormalise {
  source: SourceId;
  reference: string;
  titre: string;
  type: TypeTexte;
  url_officielle: string;
  dates: DatesTexte;
  /** Texte intégral normalisé (articles concaténés), base du hash de contenu. */
  contenu_texte: string;
  articles: ArticleNormalise[];
  /** SHA-256 du contenu normalisé (robuste aux horodatages de génération des pages). */
  hash_sha256: string;
  collecte_le: string;
  metadonnees: Record<string, unknown>;
}

export interface ReferenceRecente {
  reference: string;
  titre: string | null;
  url_officielle: string;
  date: string | null;
  /** Source d'origine quand le connecteur relaie un autre éditeur (fichier local). */
  source?: SourceId;
  type?: TypeTexte;
  /** Chemin local pour le connecteur fichier local. */
  fichier?: string;
}

export interface FetchRequest {
  reference: string;
  url_officielle: string;
  /** Pour le connecteur fichier local : chemin du document déjà téléchargé. */
  fichier?: string;
  source?: SourceId;
  titre?: string;
  type?: TypeTexte;
}

/** Interface commune des connecteurs de sources (SPEC.md, section 9). */
export interface SourceConnector {
  readonly id: SourceId;
  /** Références nouvelles ou modifiées depuis `since` (ISO 8601). */
  listRecent(since?: string): Promise<ReferenceRecente[]>;
  fetchDocument(request: FetchRequest): Promise<DocumentBrut>;
  parse(raw: DocumentBrut): Promise<TexteNormalise>;
}
