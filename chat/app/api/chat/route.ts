import { createAnthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { loadEnv, requireAnthropicKey } from '@/lib/env';
import { instructions } from '@/lib/prompt';
import { outils } from '@/lib/tools';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Route de chat : reçoit l'historique UI (useChat), appelle le modèle Anthropic avec les outils de lecture
 * du store et de Notion, renvoie un flux de message UI (texte et appels d'outils en streaming).
 */
export async function POST(request: Request): Promise<Response> {
  let messages: UIMessage[];
  try {
    const body = (await request.json()) as { messages?: UIMessage[] };
    messages = body.messages ?? [];
  } catch {
    return Response.json(
      { erreur: 'Corps de requête invalide : { messages: UIMessage[] } attendu.' },
      { status: 400 },
    );
  }
  const env = loadEnv();
  let apiKey: string;
  try {
    apiKey = requireAnthropicKey();
  } catch (error) {
    return Response.json({ erreur: (error as Error).message }, { status: 500 });
  }
  const anthropic = createAnthropic({ apiKey });
  const modelId = env.LLM_CHAT_MODEL ?? env.LLM_MODEL ?? 'claude-opus-5-5';
  const effort = env.LLM_EFFORT ?? 'medium';

  const result = streamText({
    model: anthropic(modelId),
    instructions: instructions(),
    messages: await convertToModelMessages(messages),
    tools: outils,
    stopWhen: stepCountIs(10),
    maxOutputTokens: 8000,
    providerOptions: { anthropic: { effort } },
    onError: ({ error }) => console.error('[chat] erreur du modèle', error),
  });
  return result.toUIMessageStreamResponse({
    onError: (error) => (error instanceof Error ? error.message : 'Erreur du modèle'),
  });
}
