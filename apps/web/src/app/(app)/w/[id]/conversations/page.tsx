'use client';

import type { ChatMessage, ConversationDetail, ConversationList, ConversationSummary } from '@frontdesk/shared';
import { ArrowLeft, Bot, Hand, Search, Send, User } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { canManage, useMe, useWorkspace } from '@/components/session';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { useStaffSocket } from '@/lib/staff-socket';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const dayTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time.format(d) : dayTime.format(d);
};

function ModeBadge({ c }: { c: ConversationSummary }) {
  if (c.handoverRequested && c.mode === 'ai') return <Badge variant="destructive">Wants a person</Badge>;
  if (c.mode === 'human') return <Badge>{c.assignedName ?? 'Staff'}</Badge>;
  if (c.mode === 'closed') return <Badge variant="outline">Closed</Badge>;
  return <Badge variant="secondary">Assistant</Badge>;
}

function List({ items, selected, onSelect }: { items: ConversationSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  if (!items.length) {
    return (
      <EmptyState title="No conversations yet">Once your widget is on your website, visitors’ chats appear here as they happen.</EmptyState>
    );
  }
  return (
    <ul className="divide-y" aria-label="Conversations">
      {items.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            aria-current={c.id === selected ? 'true' : undefined}
            className={cn('flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted', c.id === selected && 'bg-accent hover:bg-accent')}
          >
            <span className="flex items-center justify-between gap-2">
              <ModeBadge c={c} />
              <span className="text-xs text-muted-foreground">{when(c.lastMessageAt)}</span>
            </span>
            <span className="line-clamp-2 text-sm">{c.lastMessage ?? '…'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === 'system') return <p className="self-center text-center text-xs text-muted-foreground">{m.content}</p>;
  const visitor = m.role === 'visitor';
  return (
    <div className={cn('flex max-w-[85%] flex-col gap-1', visitor ? 'self-start' : 'self-end items-end')}>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {visitor ? <User className="size-3" aria-hidden /> : m.role === 'assistant' ? <Bot className="size-3" aria-hidden /> : <Hand className="size-3" aria-hidden />}
        {visitor ? 'Visitor' : m.role === 'assistant' ? 'Assistant' : (m.authorName ?? 'Staff')} · {when(m.createdAt)}
      </span>
      <div className={cn('rounded-lg px-3 py-2 text-sm whitespace-pre-wrap', visitor ? 'bg-muted' : m.role === 'staff' ? 'bg-primary text-primary-foreground' : 'border bg-card')}>
        {m.content}
      </div>
      {m.sources.length > 0 && <span className="text-xs text-muted-foreground">Sources: {m.sources.map((s) => s.title).join(', ')}</span>}
    </div>
  );
}

function Detail({ id, live, onBack }: { id: string; live: ChatMessage[]; onBack: () => void }) {
  const { me } = useMe();
  const { workspace } = useWorkspace();
  const base = `/workspaces/${workspace.id}/conversations/${id}`;
  const { data, error, loading, reload } = useApi<ConversationDetail>(base);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  // Messages that arrived live after the detail loaded.
  const messages = [...(data?.messages ?? []), ...live.filter((m) => !data?.messages.some((x) => x.id === m.id))];
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const act = async (path: string, done: string) => {
    setBusy(true);
    try {
      await api(`${base}/${path}`, { method: 'POST' });
      toast.success(done);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
      reload();
    } finally {
      setBusy(false);
    }
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`${base}/messages`, { method: 'POST', body: { text } });
      setText('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const mine = data.mode === 'human' && data.assignedUserId === me.id;
  const canHandBack = data.mode === 'human' && (mine || canManage(workspace));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft className="size-4" />
        </Button>
        <ModeBadge c={data} />
        <span className="flex-1" />
        {data.mode === 'ai' && (
          <Button size="sm" onClick={() => act('takeover', 'You’ve taken over this chat')} disabled={busy}>
            Take over
          </Button>
        )}
        {canHandBack && (
          <Button size="sm" variant="outline" onClick={() => act('handback', 'Handed back to the assistant')} disabled={busy}>
            Hand back to assistant
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" role="log" aria-live="polite" aria-label="Messages">
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        <div ref={end} />
      </div>
      {mine ? (
        <form onSubmit={send} className="flex gap-2 border-t p-3">
          <label htmlFor="staff-reply" className="sr-only">
            Your reply
          </label>
          <Textarea
            id="staff-reply"
            rows={2}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(e);
              }
            }}
            placeholder="Write a reply…"
          />
          <Button type="submit" disabled={busy || !text.trim()} aria-label="Send reply">
            <Send className="size-4" />
          </Button>
        </form>
      ) : (
        <p className="border-t p-3 text-sm text-muted-foreground">
          {data.mode === 'human' ? `${data.assignedName ?? 'Someone'} is handling this chat.` : 'The assistant is answering. Take over to reply yourself.'}
        </p>
      )}
    </div>
  );
}

function Conversations() {
  const { workspace } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get('c');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const listPath = `/workspaces/${workspace.id}/conversations${search ? `?q=${encodeURIComponent(search)}` : ''}`;
  const { data, error, loading, reload } = useApi<ConversationList>(listPath);
  const [older, setOlder] = useState<{ key: string; list: ConversationList } | null>(null);
  const [updates, setUpdates] = useState<Record<string, ConversationSummary>>({});
  const [live, setLive] = useState<Record<string, ChatMessage[]>>({});

  // The loaded list, with anything that changed live laid over it, newest activity first.
  const items = useMemo(() => {
    const loaded = [...(data?.items ?? []), ...(older?.key === listPath ? older.list.items : [])];
    const byId = new Map(loaded.map((c) => [c.id, c]));
    // Live changes: while searching, only update conversations already in the results.
    for (const c of Object.values(updates)) if (!search || byId.has(c.id)) byId.set(c.id, c);
    return [...byId.values()].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [data, older, updates, listPath, search]);
  const cursor = older?.key === listPath ? older.list.nextCursor : data?.nextCursor;
  const loadMore = async () => {
    if (!cursor) return;
    try {
      const sep = listPath.includes('?') ? '&' : '?';
      const next = await api<ConversationList>(`${listPath}${sep}cursor=${cursor}`);
      setOlder((prev) => ({
        key: listPath,
        list: { items: [...(prev?.key === listPath ? prev.list.items : []), ...next.items], nextCursor: next.nextCursor },
      }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const upsert = useCallback((c: ConversationSummary) => setUpdates((prev) => ({ ...prev, [c.id]: c })), []);

  useStaffSocket(workspace.id, {
    onConversation: upsert,
    onHandoverRequested: (c) => {
      upsert(c);
      toast.warning('A visitor wants to talk to a person', {
        action: { label: 'Open', onClick: () => router.push(`/w/${workspace.id}/conversations?c=${c.id}`) },
      });
    },
    onMessage: ({ conversationId, message }) =>
      setLive((prev) => ({ ...prev, [conversationId]: [...(prev[conversationId] ?? []), message] })),
  });

  const select = (id: string | null) => router.replace(id ? `/w/${workspace.id}/conversations?c=${id}` : `/w/${workspace.id}/conversations`);

  return (
    <>
      <PageHeader title="Conversations" description="Live chats from your website. Take over any chat to reply yourself." />
      <Card className="h-[calc(100dvh-14rem)] min-h-[420px] overflow-hidden py-0">
        {loading && !data ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (
          <div className="grid h-full md:grid-cols-[320px_1fr]">
            <div className={cn('flex min-h-0 flex-col border-r', selected && 'hidden md:flex')}>
              <form
                role="search"
                className="flex gap-2 border-b p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearch(query.trim());
                }}
              >
                <label htmlFor="conv-search" className="sr-only">
                  Search conversations
                </label>
                <Input id="conv-search" type="search" placeholder="Search messages…" value={query} onChange={(e) => setQuery(e.target.value)} />
                <Button type="submit" variant="outline" size="icon" aria-label="Search">
                  <Search className="size-4" />
                </Button>
              </form>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {search && items.length === 0 ? (
                  <EmptyState title="No matches">Nothing in your conversations contains “{search}”.</EmptyState>
                ) : (
                  <List items={items} selected={selected} onSelect={select} />
                )}
                {cursor && (
                  <div className="p-3 text-center">
                    <Button variant="outline" size="sm" onClick={loadMore}>
                      Load older
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className={cn('min-h-0', !selected && 'hidden md:block')}>
              {selected ? (
                <Detail key={selected} id={selected} live={live[selected] ?? []} onBack={() => select(null)} />
              ) : (
                <EmptyState title="Choose a conversation" />
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense>
      <Conversations />
    </Suspense>
  );
}
