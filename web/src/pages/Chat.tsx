import ChatPanel from '../ChatPanel';
import { useChat } from '../useChat';

export default function Chat() {
  const chat = useChat();

  if (chat.status.data && !chat.status.data.enabled) {
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
        <button className="chat-new" onClick={chat.newChat}>
          + New chat
        </button>
        {(chat.conversations.data ?? []).map((c) => (
          <div
            key={c.id}
            className={`chat-conv ${c.id === chat.conversationId ? 'active' : ''}`}
            onClick={() => chat.loadConversation(c.id)}
          >
            <span className="chat-conv-title">{c.title}</span>
            <button
              className="chat-conv-del"
              title="Delete conversation"
              onClick={(e) => {
                e.stopPropagation();
                chat.removeConversation(c.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        {chat.conversations.data && chat.conversations.data.length === 0 && (
          <p className="status">No saved chats yet.</p>
        )}
      </aside>

      <div className="chat">
        <ChatPanel chat={chat} />
        {chat.status.data && <p className="status">model: {chat.status.data.model}</p>}
      </div>
    </div>
  );
}
