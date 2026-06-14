import type { Database } from 'better-sqlite3';
import type {
  ChatConversation,
  ChatConversationDetail,
  ChatMessageRecord,
} from '@fitness/shared';

type ToolCalls = { name: string; arguments: unknown }[];

function mapConversation(r: Record<string, unknown>): ChatConversation {
  return {
    id: r.id as number,
    title: r.title as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function mapMessage(r: Record<string, unknown>): ChatMessageRecord {
  const raw = r.tool_calls as string | null;
  return {
    id: r.id as number,
    conversationId: r.conversation_id as number,
    role: r.role as 'user' | 'assistant',
    content: r.content as string,
    toolCalls: raw ? (JSON.parse(raw) as ToolCalls) : null,
    createdAt: r.created_at as string,
  };
}

/** Truncates the first user message into a readable conversation title. */
export function titleFrom(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed || 'New chat';
}

export function createConversation(db: Database, title: string): ChatConversation {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO chat_conversation (title, created_at, updated_at)
       VALUES (@title, @now, @now)`,
    )
    .run({ title, now });
  return getConversation(db, Number(info.lastInsertRowid))!;
}

export function getConversation(db: Database, id: number): ChatConversation | null {
  const row = db.prepare('SELECT * FROM chat_conversation WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapConversation(row) : null;
}

export function listConversations(db: Database): ChatConversation[] {
  return (
    db
      .prepare('SELECT * FROM chat_conversation ORDER BY updated_at DESC')
      .all() as Record<string, unknown>[]
  ).map(mapConversation);
}

export function addMessage(
  db: Database,
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  toolCalls?: ToolCalls,
): void {
  db.prepare(
    `INSERT INTO chat_message (conversation_id, role, content, tool_calls, created_at)
     VALUES (@conversationId, @role, @content, @toolCalls, @createdAt)`,
  ).run({
    conversationId,
    role,
    content,
    toolCalls: toolCalls && toolCalls.length ? JSON.stringify(toolCalls) : null,
    createdAt: new Date().toISOString(),
  });
  db.prepare('UPDATE chat_conversation SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    conversationId,
  );
}

export function getConversationDetail(db: Database, id: number): ChatConversationDetail | null {
  const conversation = getConversation(db, id);
  if (!conversation) return null;
  const messages = (
    db
      .prepare('SELECT * FROM chat_message WHERE conversation_id = ? ORDER BY id')
      .all(id) as Record<string, unknown>[]
  ).map(mapMessage);
  return { conversation, messages };
}

export function deleteConversation(db: Database, id: number): boolean {
  db.prepare('DELETE FROM chat_message WHERE conversation_id = ?').run(id);
  return db.prepare('DELETE FROM chat_conversation WHERE id = ?').run(id).changes > 0;
}
