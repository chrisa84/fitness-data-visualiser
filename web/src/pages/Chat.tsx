import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ChatReply, ChatTurn } from '../api';
import {
  deleteConversation,
  fetchChatStatus,
  fetchConversation,
  fetchConversations,
  sendChat,
} from '../api';

interface DisplayTurn extends ChatTurn {
  toolCalls?: { name: string; arguments: unknown }[] | null;
}

const SUGGESTIONS = [
  'How has my resting HR changed over the last year?',
  'What was my training load the week before each of my running PRs?',
  'Compare my sleep score before and after a life event I logged.',
  'Which month in 2025 did I run the most kilometres?',
];

export default function Chat() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['chat-status'], queryFn: fetchChatStatus });
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: fetchConversations });
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = () =>
    queueMicrotask(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight));

  const ask = useMutation({
    mutationFn: (history: ChatTurn[]) => sendChat(history, conversationId),
    onSuccess: (reply: ChatReply) => {
      setTurns((prev) => [...prev, { role: 'assistant', content: reply.reply, toolCalls: reply.toolCalls }]);
      setConversationId(reply.conversationId);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      scrollToEnd();
    },
  });

  const submit = (text: string) => {
    const question = text.trim();
    if (!question || ask.isPending) return;
    const history: ChatTurn[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content: question },
    ];
    setTurns((prev) => [...prev, { role: 'user', content: question }]);
    setInput('');
    ask.mutate(history);
  };

  const newChat = () => {
    setTurns([]);
    setConversationId(undefined);
    setInput('');
  };

  const loadConversation = async (id: number) => {
    const detail = await fetchConversation(id);
    setTurns(detail.messages.map((m) => ({ role: m.role, content: m.content, toolCalls: m.toolCalls })));
    setConversationId(id);
    scrollToEnd();
  };

  const removeConversation = async (id: number) => {
    await deleteConversation(id);
    if (id === conversationId) newChat();
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  if (status.data && !status.data.enabled) {
    return (
      <p className="status">
        The AI query layer is not configured. Set the <code>OPENROUTER_API_KEY</code> environment
        variable for the server (and optionally <code>OPENROUTER_MODEL</code>) and restart it.
      </p>
    );
  }

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <button className="chat-new" onClick={newChat}>
          + New chat
        </button>
        {(conversations.data ?? []).map((c) => (
          <div
            key={c.id}
            className={`chat-conv ${c.id === conversationId ? 'active' : ''}`}
            onClick={() => loadConversation(c.id)}
          >
            <span className="chat-conv-title">{c.title}</span>
            <button
              className="chat-conv-del"
              title="Delete conversation"
              onClick={(e) => {
                e.stopPropagation();
                removeConversation(c.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        {conversations.data && conversations.data.length === 0 && (
          <p className="status">No saved chats yet.</p>
        )}
      </aside>

      <div className="chat">
        <div className="chat-log" ref={scrollRef}>
          {turns.length === 0 && (
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
            autoFocus
          />
          <button type="submit" disabled={ask.isPending || !input.trim()}>
            Send
          </button>
        </form>
        {status.data && <p className="status">model: {status.data.model}</p>}
      </div>
    </div>
  );
}
