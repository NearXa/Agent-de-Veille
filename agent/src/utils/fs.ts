import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

/** Lit un fichier JSON ; renvoie `fallback` s'il est absent ou vide et qu'un fallback est fourni. */
export function readJson<T>(filePath: string, fallback?: T): T {
  if (!existsSync(filePath)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Fichier introuvable : ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf8');
  if (raw.trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Fichier vide : ${filePath}`);
  }
  return JSON.parse(raw) as T;
}

/** Écriture atomique : fichier temporaire puis renommage, pour ne jamais laisser un JSON tronqué. */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, filePath);
}
