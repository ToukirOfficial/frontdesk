'use client';

import type { Usage } from '@frontdesk/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { canManage, useMe, useWorkspace } from '@/components/session';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';
import { ErrorState, LoadingState } from '@/components/states';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', staff: 'Staff' } as const;

const num = new Intl.NumberFormat('en-GB');

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

/** Shown until someone adds an AI key (or the server has one): the app works, but the assistant can't answer. */
function SetupCard() {
  const { workspace } = useWorkspace();
  return (
    <Card className="border-amber-200 bg-amber-50/60">
      <CardHeader>
        <CardTitle>
          <h2>Add an AI provider to switch the assistant on</h2>
        </CardTitle>
        <CardDescription className="text-amber-950/80">
          Frontdesk works with your own AI key: Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint, including a
          model you host yourself with Ollama. Your provider bills you directly. Until a key is added, the chat on your website says
          no AI provider is configured and offers to take a message instead. Everything else (knowledge, enquiries, live chat with
          your team) already works.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canManage(workspace) ? (
          <Button asChild>
            <Link href={`/w/${workspace.id}/ai`}>Add your AI key</Link>
          </Button>
        ) : (
          <p className="text-sm">Ask an owner or admin to add one under AI provider.</p>
        )}
      </CardContent>
    </Card>
  );
}

function UsageCards() {
  const { workspace } = useWorkspace();
  const { data, error, loading, reload } = useApi<Usage>(`/workspaces/${workspace.id}/usage`);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const used = data.inputTokens + data.outputTokens;
  const pct = data.monthlyTokenCap ? Math.min(100, Math.round((used / data.monthlyTokenCap) * 100)) : 100;
  return (
    <div className="grid gap-4">
      {data.ai === 'none' && <SetupCard />}
      {data.mode === 'message' && (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This month’s AI limit is reached, so the chat is taking messages only. Raise the limit below or wait for next month.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Conversations this month" value={num.format(data.conversations)} />
        <Stat label="Enquiries this month" value={num.format(data.enquiries)} />
        <Stat label="Unanswered to review" value={num.format(data.openUnanswered)} />
      </div>
      <div className="grid gap-2 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <span>AI usage this month</span>
          <span className="text-muted-foreground">
            {num.format(used)} of {num.format(data.monthlyTokenCap)} tokens
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="AI usage this month">
          <div className={pct >= 90 ? 'h-full bg-destructive' : 'h-full bg-primary'} style={{ width: `${pct}%` }} />
        </div>
      </div>
      {canManage(workspace) && <LimitsCard usage={data} onSaved={reload} />}
    </div>
  );
}

function LimitsCard({ usage, onSaved }: { usage: Usage; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const [cap, setCap] = useState(String(usage.monthlyTokenCap));
  const [days, setDays] = useState(String(usage.retentionDays));
  const { pending, formError, fields, run } = useSubmit();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() =>
      api(`/workspaces/${workspace.id}/limits`, { method: 'PUT', body: { monthlyTokenCap: Number(cap), retentionDays: Number(days) } }),
    );
    if (ok) {
      toast.success('Limits saved');
      onSaved();
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Limits and data</h2>
        </CardTitle>
        <CardDescription>
          The monthly AI limit keeps costs predictable: once it’s reached, the chat takes messages only. Old chats, enquiries and
          unanswered questions are deleted automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form onSubmit={save} className="grid max-w-md gap-4">
          <FormError message={formError} />
          <Field label="Monthly AI limit (tokens)" type="number" min={0} required value={cap} onChange={(e) => setCap(e.target.value)} error={fields.monthlyTokenCap} hint="Roughly 2,000 tokens per answer." />
          <Field label="Keep chats for (days)" type="number" min={1} max={3650} required value={days} onChange={(e) => setDays(e.target.value)} error={fields.retentionDays} />
          <Button type="submit" className="w-fit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

function RenameCard() {
  const { workspace, reload } = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const { pending, formError, fields, run } = useSubmit();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api(`/workspaces/${workspace.id}`, { method: 'PATCH', body: { name } }));
    if (ok) {
      toast.success('Workspace renamed');
      reload();
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Workspace name</h2>
        </CardTitle>
        <CardDescription>Shown to your team. Visitors see the name in Business details.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form onSubmit={save} className="grid max-w-md gap-4">
          <FormError message={formError} />
          <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
          <Button type="submit" className="w-fit" disabled={pending || name.trim() === workspace.name}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

function DangerCard() {
  const router = useRouter();
  const { me } = useMe();
  const { workspace } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const isOwner = workspace.role === 'owner';

  const act = async () => {
    setBusy(true);
    try {
      await api(isOwner ? `/workspaces/${workspace.id}` : `/workspaces/${workspace.id}/members/${me.id}`, {
        method: 'DELETE',
      });
      router.replace('/w?new=1');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>
          <h2>{isOwner ? 'Delete workspace' : 'Leave workspace'}</h2>
        </CardTitle>
        <CardDescription>
          {isOwner
            ? 'Deletes the workspace and everything in it for everyone. This can’t be undone.'
            : 'You’ll lose access until someone invites you again.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={busy}>
              {isOwner ? 'Delete workspace' : 'Leave workspace'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{isOwner ? `Delete ${workspace.name}?` : `Leave ${workspace.name}?`}</AlertDialogTitle>
              <AlertDialogDescription>
                {isOwner ? 'Everything in this workspace will be deleted. This can’t be undone.' : 'You can rejoin only with a new invite.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={act}>{isOwner ? 'Delete' : 'Leave'}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const { workspace } = useWorkspace();
  return (
    <>
      <PageHeader
        title={workspace.name}
        description="How your assistant is doing this month."
        actions={<Badge variant="secondary">{ROLE_LABEL[workspace.role]}</Badge>}
      />
      <div className="grid gap-6">
        <UsageCards />
        {canManage(workspace) && <RenameCard />}
        <DangerCard />
      </div>
    </>
  );
}
