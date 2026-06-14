import { describe, expect, it } from 'vitest';
import { openEventsDb } from '../src/db.js';
import {
  addMessage,
  createConversation,
  deleteConversation,
  getConversationDetail,
  listConversations,
  titleFrom,
} from '../src/repositories/chats.js';

describe('chat persistence', () => {
  it('truncates long titles and falls back for blanks', () => {
    expect(titleFrom('  hello   world ')).toBe('hello world');
    expect(titleFrom('')).toBe('New chat');
    expect(titleFrom('x'.repeat(80))).toHaveLength(58); // 57 chars + ellipsis
  });

  it('creates a conversation, stores messages, and reads them back in order', () => {
    const db = openEventsDb(':memory:');
    const conv = createConversation(db, 'Sleep question');
    addMessage(db, conv.id, 'user', 'how is my sleep?');
    addMessage(db, conv.id, 'assistant', 'trending up', [{ name: 'get_metric_series', arguments: {} }]);

    const detail = getConversationDetail(db, conv.id);
    expect(detail?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(detail?.messages[1]?.toolCalls).toEqual([{ name: 'get_metric_series', arguments: {} }]);
    expect(detail?.messages[0]?.toolCalls).toBeNull();
  });

  it('lists conversations most-recently-updated first', () => {
    const db = openEventsDb(':memory:');
    const a = createConversation(db, 'first');
    const b = createConversation(db, 'second');
    addMessage(db, a.id, 'user', 'bump a'); // updates a's updated_at last

    const list = listConversations(db);
    expect(list[0]?.id).toBe(a.id);
    expect(list[1]?.id).toBe(b.id);
  });

  it('deletes a conversation and its messages', () => {
    const db = openEventsDb(':memory:');
    const conv = createConversation(db, 'temp');
    addMessage(db, conv.id, 'user', 'hi');
    expect(deleteConversation(db, conv.id)).toBe(true);
    expect(getConversationDetail(db, conv.id)).toBeNull();
    expect(deleteConversation(db, conv.id)).toBe(false);
  });
});
