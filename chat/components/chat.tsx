'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const STORAGE_KEY = 'veille-grc-chat';

const TOOL_LABELS: Record<string, string> = {
  rechercher_exigences: 'Recherche dans les exigences',
  detail_exigence: "Lecture d'une exigence",
  echeances: 'Lecture des échéances',
  lister_risques: 'Lecture des risques',
  lister_lots: "Lecture des lots d'action",
  lister_controles: 'Lecture des contrôles',
  fil_de_veille: 'Lecture du fil de veille',
  indicateurs: 'Calcul des indicateurs',
  rechercher_notion: 'Recherche dans Notion',
};

function loadSaved(): UIMessage[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UIMessage[]) : [];
  } catch {
    return [];
  }
}

function save(messages: UIMessage[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  } catch {
    // stockage indisponible (navigation privée) : l'historique reste en mémoire
  }
}

type ToolPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function ToolBadge({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, '');
  const label = TOOL_LABELS[name] ?? name;
  const state = part.state ?? '';
  const done = state === 'output-available';
  const failed = state === 'output-error';
  const input =
    part.input && typeof part.input === 'object'
      ? Object.entries(part.input as Record<string, unknown>)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' · ')
      : '';
  return (
    <div
      className={`tool ${failed ? 'tool-error' : done ? 'tool-done' : 'tool-running'}`}
      title={name}
    >
      <span className="tool-icon">{failed ? '⚠' : done ? '✓' : '…'}</span>
      <span className="tool-label">{label}</span>
      {input ? <span className="tool-input">{input}</span> : null}
      {failed && part.errorText ? <span className="tool-input">{part.errorText}</span> : null}
    </div>
  );
}

function MessageView({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  return (
    <article className={`message ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className="message-role">{isUser ? 'Vous' : 'Assistant'}</div>
      <div className="message-body">
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <div key={index} className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
              </div>
            );
          }
          if (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
            return <ToolBadge key={index} part={part as unknown as ToolPart} />;
          return null;
        })}
      </div>
    </article>
  );
}

export function Chat({ suggestions }: { suggestions: string[] }) {
  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);
  const { messages, sendMessage, status, stop, setMessages, error, clearError } = useChat({
    transport,
  });
  const [input, setInput] = useState('');
  const [restored, setRestored] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (restored) return;
    const saved = loadSaved();
    if (saved.length > 0) setMessages(saved);
    setRestored(true);
  }, [restored, setMessages]);

  useEffect(() => {
    if (restored && status === 'ready') save(messages);
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status, restored]);

  const submit = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    clearError();
    void sendMessage({ text: trimmed });
    setInput('');
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    submit(input);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit(input);
    }
  };

  const reset = (): void => {
    stop();
    setMessages([]);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignoré
    }
  };

  return (
    <main className="layout">
      <header className="header">
        <div>
          <h1>Assistant de veille GRC</h1>
          <p>
            Répond à partir du store de l’agent et des bases Notion. Lecture seule : les validations
            et la décision de gouvernance se prennent dans le cockpit.
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={reset}
          disabled={messages.length === 0}
        >
          Nouvelle conversation
        </button>
      </header>

      <section className="conversation" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty">
            <p>Exemples de questions :</p>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageView key={m.id} message={m} />)
        )}
        {busy ? <div className="status">L’assistant consulte les données…</div> : null}
        {error ? (
          <div className="error" role="alert">
            {error.message}
            <button type="button" className="link" onClick={clearError}>
              Fermer
            </button>
          </div>
        ) : null}
        <div ref={bottom} />
      </section>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Posez une question sur les exigences, les risques, les échéances, les lots…"
          rows={2}
          disabled={busy}
        />
        {busy ? (
          <button type="button" className="secondary" onClick={() => stop()}>
            Arrêter
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Envoyer
          </button>
        )}
      </form>
    </main>
  );
}
