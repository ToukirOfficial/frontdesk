'use client';

import { type AssistantSettings, type Preset } from '@frontdesk/shared';
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
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';

const PRESETS: Record<Preset, { label: string; description: string }> = {
  general: { label: 'General business', description: 'Friendly and to the point. Never guesses prices, times or policies.' },
  law: {
    label: 'Law firm',
    description: 'Never gives legal advice or predicts outcomes; offers a consultation instead. Careful with confidential details.',
  },
  clinic: {
    label: 'Clinic',
    description: 'Never diagnoses or gives medical advice; offers an appointment instead, and points to 999 or NHS 111 in an emergency.',
  },
};

function RulesCard({ initial, onSaved }: { initial: AssistantSettings; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const [preset, setPreset] = useState<Preset>(initial.preset);
  const [rules, setRules] = useState(initial.rules);
  const { pending, formError, fields, run } = useSubmit();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api(`/workspaces/${workspace.id}/assistant`, { method: 'PUT', body: { preset, rules } }));
    if (ok) {
      toast.success('Assistant rules saved');
      onSaved();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Rules</h2>
        </CardTitle>
        <CardDescription>How the assistant behaves, on top of answering only from your knowledge.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form onSubmit={save} className="grid gap-4">
          <FormError message={formError} />
          <div className="grid gap-1.5">
            <Label htmlFor="preset">Type of business</Label>
            <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger id="preset" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRESETS) as Preset[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRESETS[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{PRESETS[preset].description}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rules">Your own rules</Label>
            <Textarea
              id="rules"
              rows={6}
              maxLength={4000}
              placeholder={'One per line, in plain English. For example:\nNever give legal advice; offer a consultation instead.\nAlways mention that parking is free.'}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              aria-invalid={fields.rules ? true : undefined}
            />
            {fields.rules && <p className="text-sm text-destructive">{fields.rules}</p>}
          </div>
          <Button type="submit" className="w-fit" disabled={pending}>
            {pending ? 'Saving…' : 'Save rules'}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

function SlotwiseCard({ initial, onSaved }: { initial: AssistantSettings; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const [baseUrl, setBaseUrl] = useState(initial.slotwise.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const { pending, formError, fields, run } = useSubmit();
  const path = `/workspaces/${workspace.id}/slotwise`;

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api(path, { method: 'PUT', body: { baseUrl, apiKey } }));
    if (ok) {
      setApiKey('');
      toast.success('Slotwise connected');
      onSaved();
    }
  };
  const disconnect = async () => {
    try {
      await api(path, { method: 'DELETE' });
      toast.success('Slotwise disconnected');
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <h2>Booking with Slotwise</h2>
          {initial.slotwise.connected && <Badge>Connected</Badge>}
        </CardTitle>
        <CardDescription>
          Optional. With a Slotwise booking system connected, the assistant can offer real free times and book them. Without it,
          visitors get your booking link.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form onSubmit={connect} className="grid gap-4">
          <FormError message={formError} />
          <Field label="Slotwise address" type="url" required placeholder="https://booking.example.co.uk" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} error={fields.baseUrl} />
          <Field
            label="API key"
            type="password"
            autoComplete="off"
            required
            placeholder={initial.slotwise.connected ? 'Saved. Paste a new key to replace it.' : 'sw_live_…'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            error={fields.apiKey}
            hint="Stored encrypted. It’s never shown again."
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : initial.slotwise.connected ? 'Replace key' : 'Connect'}
            </Button>
            {initial.slotwise.connected && (
              <Button type="button" variant="outline" onClick={disconnect}>
                Disconnect
              </Button>
            )}
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}

function Assistant() {
  const { workspace } = useWorkspace();
  const { data, error, loading, reload } = useApi<AssistantSettings>(`/workspaces/${workspace.id}/assistant`);
  return (
    <>
      <PageHeader title="Assistant" description="Rules and booking." />
      {loading && !data ? (
        <LoadingState />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="grid gap-6">
          <RulesCard initial={data} onSaved={reload} />
          <SlotwiseCard key={String(data.slotwise.connected)} initial={data} onSaved={reload} />
        </div>
      )}
    </>
  );
}

export default function AssistantPage() {
  return (
    <ManageOnly title="Assistant">
      <Assistant />
    </ManageOnly>
  );
}
