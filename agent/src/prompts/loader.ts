import { readFileSync } from 'node:fs';
import { AppError } from '../utils/errors.js';
import { paths } from '../utils/paths.js';

export interface PromptFile {
  name: string;
  version: string;
  schema: string;
  instructions: string;
  template: string;
}

const cache = new Map<string, PromptFile>();

/**
 * Charge `agent/src/prompts/<name>.md` : en-tête YAML minimal (version, schema), section
 * `## Instructions` (consignes système) et section `## Prompt` (gabarit avec `{{variables}}`).
 */
export function loadPrompt(name: string): PromptFile {
  const cached = cache.get(name);
  if (cached) return cached;
  const file = paths.prompts(`${name}.md`);
  const raw = readFileSync(file, 'utf8');
  const header = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!header) throw new AppError(`Prompt ${file} : en-tête --- manquant`);
  const meta: Record<string, string> = {};
  for (const line of header[1]!.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const body = raw.slice(header[0].length);
  const instructions = /## Instructions\n([\s\S]*?)(?=\n## |$)/.exec(body)?.[1]?.trim();
  const template = /## Prompt\n([\s\S]*)$/.exec(body)?.[1]?.trim();
  if (!meta.version || !instructions || !template) {
    throw new AppError(
      `Prompt ${file} : version, section Instructions ou section Prompt manquante`,
    );
  }
  const prompt: PromptFile = {
    name,
    version: meta.version,
    schema: meta.schema ?? '',
    instructions,
    template,
  };
  cache.set(name, prompt);
  return prompt;
}

/** Remplace les `{{variables}}` du gabarit ; une variable manquante est une erreur. */
export function renderPrompt(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = variables[key];
    if (value === undefined) throw new AppError(`Variable de prompt manquante : ${key}`);
    return value;
  });
}
