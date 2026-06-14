import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ChatReply, ChatTurn } from './api';
import {
  deleteConversation,
  fetchChatStatus,
  fetchConversation,
  fetchConversations,
  sendChat,
} from './api';

export interface DisplayTurn extends ChatTurn {
  toolCalls?: { name: string; arguments: unknown }[] | null;
}

/**
 * Shared chat state + actions, used by both the Chat page and the floating
 * drawer. `context` (when given) is sent with each message as a hint about the
 * screen the user is viewing.
 */
export function useChat(context?: string) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['chat-status'], queryFn: fetchChatStatus });
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: fetchConversations });
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [conversationId, setConversationId] = useState<number | undefined>();
  const [input, setInput] = useState('');

  const ask = useMutation({
    mutationFn: (history: ChatTurn[]) => sendChat(history, conversationId, context),
    onSuccess: (reply: ChatReply) => {
      setTurns((prev) => [...prev, { role: 'assistant', content: reply.reply, toolCalls: reply.toolCalls }]);
      setConversationId(reply.conversationId);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
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
  };

  const removeConversation = async (id: number) => {
    await deleteConversation(id);
    if (id === conversationId) newChat();
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  return {
    status,
    conversations,
    turns,
    conversationId,
    input,
    setInput,
    submit,
    ask,
    newChat,
    loadConversation,
    removeConversation,
  };
}

export type ChatApi = ReturnType<typeof useChat>;
