import { generateText, stepCountIs, type ToolSet } from 'ai';
import { loadEnv } from '../config/env.js';
import { resolveModel } from '../llm/provider.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface AskCommandOptions {
  question: string;
  maxSteps?: string;
}

/**
 * `pnpm agent ask "question"` : interroge les bases Notion en langage naturel via le serveur MCP
 * Notion officiel (transport stdio, lancé avec npx) exposé au modèle par le client MCP de l'AI SDK.
 * Lecture seule par construction du prompt ; les outils de modification ne sont pas proposés.
 */
export default async function askCommand(options: AskCommandOptions): Promise<void> {
  const env = loadEnv();
  if (!env.NOTION_TOKEN)
    throw new AppError(
      'NOTION_TOKEN manquant : le serveur MCP Notion a besoin du token d’intégration.',
    );
  const { createMCPClient } = await import('@ai-sdk/mcp');
  const { Experimental_StdioMCPTransport } = await import('@ai-sdk/mcp/mcp-stdio');
  const transport = new Experimental_StdioMCPTransport({
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    env: {
      ...process.env,
      NOTION_TOKEN: env.NOTION_TOKEN,
      OPENAPI_MCP_HEADERS: JSON.stringify({
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': env.NOTION_API_VERSION,
      }),
    } as Record<string, string>,
  });
  const client = await createMCPClient({ transport });
  try {
    const allTools = await client.tools();
    const readOnly = Object.fromEntries(
      Object.entries(allTools).filter(
        ([name]) =>
          /^(API-)?(get|retrieve|query|search|post-search|list)/i.test(name) ||
          /search|retrieve|query|list|get/i.test(name),
      ),
    );
    const tools = (Object.keys(readOnly).length > 0 ? readOnly : allTools) as unknown as ToolSet;
    logger.info({ outils: Object.keys(tools).length }, 'Outils MCP Notion disponibles');
    const resolved = resolveModel(env);
    const result = await generateText({
      model: resolved.model,
      tools,
      stopWhen: stepCountIs(Number(options.maxSteps ?? '8')),
      instructions:
        "Tu es l'assistant de veille GRC. Tu réponds en français à partir des bases Notion de l'organisation (Textes, Exigences, Contrôles, Risques, Jurisprudence, Lots d'action) en utilisant les outils de recherche et de lecture. Ne modifie jamais rien. Cite les identifiants métier (TX-, EX-, RK-, LA-) et les dates ISO que tu lis. Si une information est absente, dis-le.",
      prompt: options.question,
      providerOptions: resolved.providerOptions,
    });
    console.log(result.text);
    logger.info({ etapes: result.steps.length, tokens: result.usage }, 'Réponse produite');
  } finally {
    await client.close();
  }
}
