'use client';

import { type AssistantSettings, MAX_AVATAR_BYTES, type Preset } from '@frontdesk/shared';
import { Check, Copy } from 'lucide-react';
import { useRef } from 'react';
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

function WidgetCard({ initial, onSaved }: { initial: AssistantSettings; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const w = initial.widget;
  const [greeting, setGreeting] = useState(w.greeting);
  const [brandColour, setBrandColour] = useState(w.brandColour);
  const [position, setPosition] = useState<'left' | 'right'>(w.position);
  const [origins, setOrigins] = useState(w.allowedOrigins.join('\n'));
  const [copied, setCopied] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const { pending, formError, fields, run } = useSubmit();
  const base = `/workspaces/${workspace.id}/widget`;

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const snippet = `<frontdesk-chat key="${w.publicKey}"></frontdesk-chat>\n<script src="${origin}/widget.js" defer></script>`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const allowedOrigins = origins
      .split(/\s+/)
      .map((o) => o.trim())
      .filter(Boolean);
    const ok = await run(() => api(base, { method: 'PUT', body: { greeting, brandColour, position, allowedOrigins } }));
    if (ok) {
      toast.success('Widget saved');
      onSaved();
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Images can be up to 256 KB.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    try {
      await api(`${base}/avatar`, { method: 'POST', body: form });
      toast.success('Avatar updated');
      setAvatarVersion((n) => n + 1);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeAvatar = async () => {
    try {
      await api(`${base}/avatar`, { method: 'DELETE' });
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Website widget</h2>
        </CardTitle>
        <CardDescription>How the chat looks on your website, and where it may appear.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-2">
          <Label htmlFor="snippet">Add this to your website, just before &lt;/body&gt;</Label>
          <div className="relative">
            <pre id="snippet" className="overflow-x-auto rounded-md border bg-muted p-3 pr-12 text-xs">
              <code>{snippet}</code>
            </pre>
            <Button type="button" variant="ghost" size="icon" className="absolute top-1.5 right-1.5" onClick={copy} aria-label="Copy the code">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Works on WordPress (in a Custom HTML block or your theme footer), Laravel and plain HTML.</p>
        </div>
        <Form onSubmit={save} className="grid gap-4">
          <FormError message={formError} />
          <Field label="Greeting" required maxLength={300} value={greeting} onChange={(e) => setGreeting(e.target.value)} error={fields.greeting} />
          <div className="flex flex-wrap gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="colour">Brand colour</Label>
              <div className="flex items-center gap-2">
                <input
                  id="colour"
                  type="color"
                  value={brandColour}
                  onChange={(e) => setBrandColour(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
                />
                <span className="font-mono text-sm">{brandColour}</span>
              </div>
              {fields.brandColour && <p className="text-sm text-destructive">{fields.brandColour}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="position">Position</Label>
              <Select value={position} onValueChange={(v) => setPosition(v as 'left' | 'right')}>
                <SelectTrigger id="position" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="right">Bottom right</SelectItem>
                  <SelectItem value="left">Bottom left</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="origins">Websites allowed to show the chat</Label>
            <Textarea
              id="origins"
              rows={3}
              placeholder={'https://www.example.co.uk\nhttps://example.co.uk'}
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
              aria-invalid={Object.keys(fields).some((k) => k.startsWith('allowedOrigins')) ? true : undefined}
            />
            <p className="text-sm text-muted-foreground">
              One per line. Leave empty to allow any website (fine while testing). This stops other websites showing your chat;
              it can’t stop scripts, so rate limits also apply.
            </p>
            {Object.entries(fields)
              .filter(([k]) => k.startsWith('allowedOrigins'))
              .map(([k, v]) => (
                <p key={k} className="text-sm text-destructive">
                  {v}
                </p>
              ))}
          </div>
          <Button type="submit" className="w-fit" disabled={pending}>
            {pending ? 'Saving…' : 'Save widget'}
          </Button>
        </Form>
        <div className="grid gap-2">
          <Label>Avatar</Label>
          <div className="flex flex-wrap items-center gap-3">
            {w.hasAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- served by the API, not a static asset
              <img src={`/api/widget/${w.publicKey}/avatar?v=${avatarVersion}`} alt="Current avatar" className="size-10 rounded-full object-cover" />
            ) : (
              <span className="grid size-10 place-items-center rounded-full bg-muted text-sm text-muted-foreground">None</span>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Upload an avatar image"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
              {w.hasAvatar ? 'Change' : 'Upload'}
            </Button>
            {w.hasAvatar && (
              <Button type="button" variant="ghost" onClick={removeAvatar}>
                Remove
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">PNG, JPEG or WebP, up to 256 KB. Square works best.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Assistant() {
  const { workspace } = useWorkspace();
  const { data, error, loading, reload } = useApi<AssistantSettings>(`/workspaces/${workspace.id}/assistant`);
  return (
    <>
      <PageHeader title="Assistant" description="Rules, the website widget and booking." />
      {loading && !data ? (
        <LoadingState />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <div className="grid gap-6">
          <RulesCard initial={data} onSaved={reload} />
          <WidgetCard initial={data} onSaved={reload} />
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
