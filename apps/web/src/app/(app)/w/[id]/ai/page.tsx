'use client';

import { AI_PROVIDER_LABELS, AI_PROVIDERS, type AiProvider, type AiStatus, type AiTestResult } from '@frontdesk/shared';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { ManageOnly } from '@/components/manage-only';
import { useWorkspace } from '@/components/session';
import { ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, errorMessage } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';

const KEY_HELP: Record<AiProvider, string> = {
  anthropic: 'Create a key in the Anthropic Console (console.anthropic.com).',
  openai: 'Create a key at platform.openai.com.',
  gemini: 'Create a key in Google AI Studio (aistudio.google.com).',
  'openai-compatible': 'Only if your endpoint needs one. Ollama doesn’t.',
};

const BASE_URL_HELP =
  'The address that ends in /v1, e.g. https://ollama.example.co.uk/v1. It must be reachable from the internet (private addresses are refused for safety).';

function ActiveCard({ status }: { status: AiStatus }) {
  const w = status.workspace;
  const i = status.instance;
  let text: React.ReactNode;
  if (status.active === 'demo') text = 'This is the public demo. Visitors see sample answers, or use their own key in the chat.';
  else if (status.active === 'workspace' && w)
    text = (
      <>
        Your own key: {AI_PROVIDER_LABELS[w.provider]}, model <code className="text-[13px]">{w.model}</code>
        {w.keyLast4 ? <> , key ending {w.keyLast4}</> : null}.
      </>
    );
  else if (status.active === 'instance' && i)
    text = (
      <>
        This server’s key: {AI_PROVIDER_LABELS[i.provider]}, model <code className="text-[13px]">{i.model}</code>. Add your own key below to
        use (and pay for) your own provider instead.
      </>
    );
  else text = 'None yet. Until you add a key, the chat tells visitors no AI provider is configured and offers to take a message.';
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <h2>Who answers your visitors</h2>
          {status.active === 'none' ? <Badge variant="destructive">Not set up</Badge> : <Badge>Active</Badge>}
        </CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
    </Card>
  );
}

function KeyForm({ status, onSaved }: { status: AiStatus; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const saved = status.workspace;
  const [provider, setProvider] = useState<AiProvider>(saved?.provider ?? 'anthropic');
  const [model, setModel] = useState(saved?.model ?? '');
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AiTestResult>();
  const { pending, formError, fields, run, setFormError } = useSubmit();
  const path = `/workspaces/${workspace.id}/ai`;
  const compat = provider === 'openai-compatible';
  const keySaved = Boolean(saved?.keyLast4) && saved?.provider === provider;
  const demo = status.active === 'demo';

  const body = () => ({ provider, model, ...(apiKey ? { apiKey } : {}), ...(compat ? { baseUrl } : {}) });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(undefined);
    const ok = await run(() => api(path, { method: 'PUT', body: body() }));
    if (ok) {
      setApiKey('');
      toast.success('AI provider saved');
      onSaved();
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(undefined);
    setFormError(undefined);
    try {
      setResult(await api<AiTestResult>(`${path}/test`, { method: 'POST', body: body() }));
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    try {
      await api(path, { method: 'DELETE' });
      setApiKey('');
      setResult(undefined);
      toast.success('Your key was removed');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Your own AI key</h2>
        </CardTitle>
        <CardDescription>
          Frontdesk doesn’t include or pay for an AI model: you bring your own key, and your provider bills you directly. The key
          is stored encrypted, is never shown again (only its last 4 characters) and is never written to logs. The monthly AI limit
          on the overview still applies.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form onSubmit={save} className="grid gap-4">
          <FormError message={formError} />
          <fieldset disabled={demo} className="contents">
            <div className="grid gap-1.5">
              <Label htmlFor="provider">Provider</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v as AiProvider);
                  setResult(undefined);
                }}
              >
                <SelectTrigger id="provider" className="w-full sm:w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {AI_PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {compat && (
              <Field label="Endpoint address" type="url" required placeholder="https://…/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} error={fields.baseUrl} hint={BASE_URL_HELP} />
            )}
            <Field
              label="Model"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="The model id, exactly as your provider writes it"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              error={fields.model}
              hint="Find it in your provider’s model list. Smaller, cheaper models are usually fine for a receptionist."
            />
            <Field
              label={compat ? 'API key (optional)' : 'API key'}
              type="password"
              autoComplete="off"
              required={!compat && !keySaved}
              placeholder={keySaved ? `Saved, ends ${saved?.keyLast4}. Paste a new key to replace it.` : 'Paste your key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              error={fields.apiKey}
              hint={KEY_HELP[provider]}
            />
            {result && (
              <p
                role="status"
                className={
                  result.ok
                    ? 'flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
                    : 'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive'
                }
              >
                {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
                {result.message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="outline" onClick={test} disabled={testing || !model}>
                {testing ? 'Testing…' : 'Test key'}
              </Button>
              {saved && (
                <Button type="button" variant="ghost" onClick={remove}>
                  Remove my key
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Test key sends one tiny request (a few tokens) to check the key and model.</p>
          </fieldset>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function AiProviderPage() {
  const { workspace } = useWorkspace();
  const { data, error, loading, reload } = useApi<AiStatus>(`/workspaces/${workspace.id}/ai`);
  return (
    <ManageOnly title="AI provider">
      <PageHeader title="AI provider" description="Bring your own key: Anthropic, OpenAI, Google Gemini or any OpenAI-compatible endpoint, including Ollama." />
      {loading && !data ? (
        <LoadingState />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="grid gap-6">
          <ActiveCard status={data} />
          <KeyForm key={data.workspace?.updatedAt ?? 'none'} status={data} onSaved={reload} />
        </div>
      )}
    </ManageOnly>
  );
}
