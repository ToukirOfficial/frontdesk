'use client';

import type { Unanswered, UnansweredList } from '@frontdesk/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { FormError } from '@/components/field';
import { Form } from '@/components/form';
import { canManage, useWorkspace } from '@/components/session';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';

const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

function AnswerDialog({ q, onClose, onDone }: { q: Unanswered | null; onClose: () => void; onDone: () => void }) {
  const { workspace } = useWorkspace();
  const [answer, setAnswer] = useState('');
  const { pending, formError, run } = useSubmit();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q) return;
    const ok = await run(() => api(`/workspaces/${workspace.id}/unanswered/${q.id}/answer`, { method: 'POST', body: { answer } }));
    if (ok) {
      toast.success('Added to your knowledge');
      onDone();
      onClose();
    }
  };
  return (
    <Dialog open={q !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an answer</DialogTitle>
          <DialogDescription>It becomes an FAQ in your knowledge, so the assistant can answer next time.</DialogDescription>
        </DialogHeader>
        <Form onSubmit={save} className="grid gap-4">
          <FormError message={formError} />
          <p className="rounded-md bg-muted px-3 py-2 text-sm">{q?.question}</p>
          <div className="grid gap-1.5">
            <Label htmlFor="answer">Answer</Label>
            <Textarea id="answer" rows={5} required maxLength={5000} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save answer'}
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function UnansweredPage() {
  const { workspace } = useWorkspace();
  const manage = canManage(workspace);
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const { data, error, loading, reload } = useApi<UnansweredList>(`/workspaces/${workspace.id}/unanswered?status=${status}`);
  const [answering, setAnswering] = useState<Unanswered | null>(null);

  const setResolved = async (q: Unanswered, resolved: boolean) => {
    try {
      await api(`/workspaces/${workspace.id}/unanswered/${q.id}`, { method: 'PATCH', body: { resolved } });
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Unanswered questions"
        description="Questions the assistant couldn’t answer from your knowledge. Add the answers so it can next time."
        actions={
          <Tabs value={status} onValueChange={(v) => setStatus(v as 'open' | 'resolved')}>
            <TabsList>
              <TabsTrigger value="open">To do</TabsTrigger>
              <TabsTrigger value="resolved">Done</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <Card className="py-0">
        <CardContent className="px-0">
          {loading && !data ? (
            <LoadingState />
          ) : error || !data ? (
            <ErrorState error={error} onRetry={reload} />
          ) : data.items.length === 0 ? (
            <EmptyState title={status === 'open' ? 'Nothing to do' : 'Nothing here yet'}>
              {status === 'open' ? 'When the assistant can’t answer something, the question appears here.' : undefined}
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {data.items.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{q.question}</p>
                    <p className="text-xs text-muted-foreground">{fmt.format(new Date(q.createdAt))}</p>
                  </div>
                  {manage && status === 'open' && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setAnswering(q)}>
                        Add answer
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setResolved(q, true)}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                  {manage && status === 'resolved' && (
                    <Button size="sm" variant="ghost" onClick={() => setResolved(q, false)}>
                      Move back to to do
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {answering && <AnswerDialog key={answering.id} q={answering} onClose={() => setAnswering(null)} onDone={reload} />}
    </>
  );
}
