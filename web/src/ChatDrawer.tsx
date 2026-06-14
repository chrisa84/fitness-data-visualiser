import { useLocation } from 'react-router-dom';
import ChatPanel from './ChatPanel';
import { describeLocation } from './pageContext';
import { useChat } from './useChat';

/** Floating assistant: slides in over any page, with the current view as context. */
export default function ChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const location = useLocation();
  const context = describeLocation(location.pathname, location.search);
  const chat = useChat(context);

  if (!open) return null;
  const enabled = chat.status.data?.enabled ?? true;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="chat-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <strong>Assistant</strong>
          <span className="drawer-head-actions">
            <button onClick={chat.newChat} title="New chat">
              + New
            </button>
            <button onClick={onClose} title="Close">
              ×
            </button>
          </span>
        </div>
        {context && <p className="status drawer-context">Context: {context}</p>}
        {enabled ? (
          <ChatPanel chat={chat} />
        ) : (
          <p className="status">
            AI not configured. Set <code>OPENROUTER_API_KEY</code> for the server.
          </p>
        )}
      </div>
    </div>
  );
}
