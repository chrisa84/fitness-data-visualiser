import { useEffect, useRef } from 'react';
import type { ChatApi } from './useChat';

const SUGGESTIONS = [
  'How has my resting HR changed over the last year?',
  'What was my training load the week before each of my running PRs?',
  'Compare my sleep score before and after a life event I logged.',
  'Which month in 2025 did I run the most kilometres?',
];

/** The conversation log + input. State lives in the passed `chat` (useChat). */
export default function ChatPanel({ chat, suggestions = true }: { chat: ChatApi; suggestions?: boolean }) {
  const { turns, ask, input, setInput, submit } = chat;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [turns, ask.isPending]);

  return (
    <>
      <div className="chat-log" ref={scrollRef}>
        {turns.length === 0 && suggestions && (
          <div className="chat-suggestions">
            <p className="status">Ask a question about your training and health data:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`chat-turn chat-${t.role}`}>
            {t.context && <div className="chat-context-hint">from: {t.context}</div>}
            <div className="chat-bubble">{t.content || '…'}</div>
            {t.toolCalls && t.toolCalls.length > 0 && (
              <div className="chat-tools">used: {t.toolCalls.map((c) => c.name).join(', ')}</div>
            )}
          </div>
        ))}
        {ask.isPending && (
          <div className="chat-turn chat-assistant">
            <div className="chat-bubble">Thinking…</div>
          </div>
        )}
        {ask.error && <p className="status">Error: {(ask.error as Error).message}</p>}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your data…"
        />
        <button type="submit" disabled={ask.isPending || !input.trim()}>
          Send
        </button>
      </form>
    </>
  );
}
