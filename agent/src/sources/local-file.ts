import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DocumentLocal } from '../config/schemas.js';
import { normalizeDocument } from '../ingest/normalize.js';
import { SourceId, TypeTexte } from '../schemas/common.js';
import { AppError } from '../utils/errors.js';
import { fileExists } from '../utils/fs.js';
import { paths } from '../utils/paths.js';
import type {
  DocumentBrut,
  FetchRequest,
  ReferenceRecente,
  SourceConnector,
  TexteNormalise,
} from './types.js';

function detectFormat(file: string, head: Buffer): DocumentBrut['format'] {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf' || head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return 'html';
  const start = head.toString('utf8', 0, 512).trimStart().toLowerCase();
  if (
    start.startsWith('<?xml') ||
    start.startsWith('<!doctype html') ||
    start.startsWith('<html')
  ) {
    return 'html';
  }
  return 'txt';
}

/** Texte d'un PDF (toutes pages fusionnées) via unpdf. */
export async function extractPdfText(contenu: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(contenu));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/**
 * Connecteur « fichier local » : documents officiels déjà téléchargés dans `data/sources/`
 * (HTML, PDF ou TXT). La source d'origine (eurlex, legifrance...) est fournie pour la traçabilité.
 */
export class LocalFileConnector implements SourceConnector {
  readonly id = 'local-file' as const;

  constructor(private readonly documents: DocumentLocal[] = []) {}

  /** Les documents déclarés dans config/sources.yaml : relus à chaque passage de `watch`. */
  async listRecent(): Promise<ReferenceRecente[]> {
    return this.documents.map((doc) => ({
      reference: doc.reference,
      titre: doc.titre ?? null,
      url_officielle: doc.url_officielle,
      date: null,
      fichier: doc.fichier,
      source: SourceId.safeParse(doc.source_origine).success
        ? (doc.source_origine as SourceId)
        : 'local-file',
      type:
        doc.titre && TypeTexte.safeParse(doc.titre).success ? (doc.titre as TypeTexte) : undefined,
    }));
  }

  async fetchDocument(request: FetchRequest): Promise<DocumentBrut> {
    if (!request.fichier)
      throw new AppError('Le connecteur fichier local exige un chemin de fichier (--file).');
    const file = paths.resolve(request.fichier);
    if (!fileExists(file)) throw new AppError(`Fichier introuvable : ${file}`);
    const contenu = readFileSync(file);
    return {
      source: request.source ?? 'local-file',
      reference: request.reference,
      url_officielle: request.url_officielle,
      format: detectFormat(file, contenu.subarray(0, 1024)),
      contenu,
      fichier: path.relative(paths.root(), file),
      recupere_le: new Date().toISOString(),
      titre_hint: request.titre,
      type_hint: request.type,
    };
  }

  async parse(raw: DocumentBrut): Promise<TexteNormalise> {
    if (raw.format !== 'pdf') return normalizeDocument(raw);
    const text = await extractPdfText(raw.contenu);
    const texte = normalizeDocument({ ...raw, format: 'txt', contenu: Buffer.from(text, 'utf8') });
    texte.metadonnees.format = 'pdf';
    texte.metadonnees.parser = 'unpdf+regex';
    return texte;
  }
}
