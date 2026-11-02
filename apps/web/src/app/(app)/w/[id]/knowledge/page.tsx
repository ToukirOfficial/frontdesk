'use client';

import { type KnowledgeList, type KnowledgeSource, MAX_IMPORT_PAGES, MAX_UPLOAD_BYTES, type SourceType } from '@frontdesk/shared';
import { Download, FileText, Globe, MessageSquareText, MoreHorizontal, Plus, RefreshCw, StickyNote, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { ManageOnly } from '@/components/manage-only';
import { useWorkspace } from '@/components/session';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';

const ICONS: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  faq: MessageSquareText,
  text: StickyNote,
  file: FileText,
  url: Globe,
};
const TYPE_LABEL: Record<SourceType, string> = { faq: 'FAQ', text: 'Page', file: 'File', url: 'Website' };

function StatusBadge({ s }: { s: KnowledgeSource }) {
  if (s.status === 'ready') return <Badge variant="secondary">Ready · {s.chunkCount} {s.chunkCount === 1 ? 'piece' : 'pieces'}</Badge>;
  if (s.status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      <RefreshCw className="size-3 animate-spin" aria-hidden /> Processing
    </Badge>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  error,
  rows = 5,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  rows?: number;
  hint?: string;
}) {
  const id = label.toLowerCase().replace(/\W+/g, '-');
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} required />
      {error ? <p className="text-sm text-destructive">{error}</p> : hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

type Editor = { kind: 'faq' | 'text' | 'url'; source?: KnowledgeSource } | null;

function EditorDialog({ editor, onClose, onSaved }: { editor: Editor; onClose: () => void; onSaved: () => void }) {
  const { workspace } = useWorkspace();
  const s = editor?.source;
  const [a, setA] = useState(s?.type === 'faq' ? (s.question ?? '') : (s?.title ?? ''));
  const [b, setB] = useState(s?.content ?? '');
  const [pages, setPages] = useState('10');
  const { pending, formError, fields, run } = useSubmit();
  const base = `/workspaces/${workspace.id}/knowledge`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    const ok = await run(() => {
      if (editor.kind === 'url') return api(`${base}/import-url`, { method: 'POST', body: { url: a, maxPages: Number(pages) } });
      if (s) {
        return api(`${base}/${s.id}`, {
          method: 'PATCH',
          body: editor.kind === 'faq' ? { question: a, answer: b } : { title: a, content: b },
        });
      }
      return api(base, {
        method: 'POST',
        body: editor.kind === 'faq' ? { type: 'faq', question: a, answer: b } : { type: 'text', title: a, content: b },
      });
    });
    if (ok) {
      toast.success(editor.kind === 'url' ? 'Import started' : 'Saved. It’ll be ready in a moment.');
      onSaved();
      onClose();
    }
  };

  const titles = { faq: s ? 'Edit FAQ' : 'Add an FAQ', text: s ? 'Edit page' : 'Add a page', url: 'Import a website' };
  return (
    <Dialog open={editor !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editor ? titles[editor.kind] : ''}</DialogTitle>
          <DialogDescription>
            {editor?.kind === 'url'
              ? `Reads up to ${MAX_IMPORT_PAGES} pages from the same website. Menus, scripts and footers are skipped.`
              : editor?.kind === 'text'
                ? 'Prices, services, policies, areas you cover: anything visitors ask about.'
                : 'A question visitors ask and the answer you want them to get.'}
          </DialogDescription>
        </DialogHeader>
        <Form onSubmit={save} className="grid gap-4">
          <FormError message={formError} />
          {editor?.kind === 'faq' && (
            <>
              <Field label="Question" required value={a} onChange={(e) => setA(e.target.value)} error={fields.question} />
              <TextAreaField label="Answer" value={b} onChange={setB} error={fields.answer} />
            </>
          )}
          {editor?.kind === 'text' && (
            <>
              <Field label="Title" required value={a} onChange={(e) => setA(e.target.value)} error={fields.title} />
              <TextAreaField label="Content" rows={10} value={b} onChange={setB} error={fields.content} />
            </>
          )}
          {editor?.kind === 'url' && (
            <>
              <Field
                label="Website address"
                type="url"
                required
                placeholder="https://www.example.co.uk"
                value={a}
                onChange={(e) => setA(e.target.value)}
                error={fields.url}
              />
              <Field
                label="Pages to read"
                type="number"
                min={1}
                max={MAX_IMPORT_PAGES}
                required
                value={pages}
                onChange={(e) => setPages(e.target.value)}
                error={fields.maxPages}
              />
            </>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : editor?.kind === 'url' ? 'Start import' : 'Save'}
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function SourceRow({ s, onChanged, onEdit }: { s: KnowledgeSource; onChanged: () => void; onEdit: () => void }) {
  const { workspace } = useWorkspace();
  const Icon = ICONS[s.type];
  const base = `/workspaces/${workspace.id}/knowledge/${s.id}`;
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{s.title}</p>
        <p className="truncate text-sm text-muted-foreground">
          {TYPE_LABEL[s.type]}
          {s.type === 'url' && s.url ? ` · ${s.url}` : ''}
          {s.type === 'faq' && s.content ? ` · ${s.content}` : ''}
        </p>
        {s.status === 'failed' && s.error && <p className="mt-1 text-sm text-destructive">{s.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <StatusBadge s={s} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${s.title}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(s.type === 'faq' || s.type === 'text') && <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>}
            {s.type === 'file' && (
              <DropdownMenuItem asChild>
                <a href={`/api${base}/file`} download>
                  <Download className="size-4" /> Download
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => act(() => api(`${base}/reprocess`, { method: 'POST' }), 'Processing again')}>
              <RefreshCw className="size-4" /> {s.type === 'url' ? 'Import again' : 'Process again'}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                if (window.confirm(`Delete “${s.title}”? The assistant will stop using it.`)) {
                  void act(() => api(base, { method: 'DELETE' }), 'Deleted');
                }
              }}
            >
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function Knowledge() {
  const { workspace } = useWorkspace();
  const { data, error, loading, reload } = useApi<KnowledgeList>(`/workspaces/${workspace.id}/knowledge`);
  const [editor, setEditor] = useState<Editor>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // While anything is processing, check again every few seconds.
  const busy = data?.items.some((s) => s.status === 'processing');
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [busy, reload]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('Files can be up to 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/workspaces/${workspace.id}/knowledge/upload`, { method: 'POST', body: form });
      toast.success(`${file.name} uploaded. Reading it now.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <>
      <PageHeader
        title="Knowledge"
        description="The assistant answers only from what’s here and your business details. If it isn’t here, it says it doesn’t know."
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="sr-only"
              aria-label="Upload a PDF or Word file"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading}>
              <Upload className="size-4" /> {uploading ? 'Uploading…' : 'Upload file'}
            </Button>
            <Button variant="outline" onClick={() => setEditor({ kind: 'url' })}>
              <Globe className="size-4" /> Import website
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus className="size-4" /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditor({ kind: 'faq' })}>FAQ (question and answer)</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditor({ kind: 'text' })}>Page of text</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <Card className="py-0">
        <CardContent className="px-0">
          {loading && !data ? (
            <LoadingState />
          ) : error || !data ? (
            <ErrorState error={error} onRetry={reload} />
          ) : data.items.length === 0 ? (
            <EmptyState title="No knowledge yet">
              Add your prices, services, opening hours and policies, upload a PDF, or import your website.
            </EmptyState>
          ) : (
            <ul className="divide-y">
              {data.items.map((s) => (
                <SourceRow key={s.id} s={s} onChanged={reload} onEdit={() => setEditor({ kind: s.type === 'faq' ? 'faq' : 'text', source: s })} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {editor && <EditorDialog key={editor.source?.id ?? editor.kind} editor={editor} onClose={() => setEditor(null)} onSaved={reload} />}
    </>
  );
}

export default function KnowledgePage() {
  return (
    <ManageOnly title="Knowledge">
      <Knowledge />
    </ManageOnly>
  );
}
