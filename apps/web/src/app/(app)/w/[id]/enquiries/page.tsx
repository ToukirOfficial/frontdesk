'use client';

import type { EnquiryList } from '@frontdesk/shared';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { useWorkspace } from '@/components/session';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const fmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

export default function EnquiriesPage() {
  const { workspace } = useWorkspace();
  const path = `/workspaces/${workspace.id}/enquiries`;
  const { data, error, loading, reload } = useApi<EnquiryList>(path);
  const [more, setMore] = useState<EnquiryList | null>(null);
  const [moreError, setMoreError] = useState<string>();

  const items = [...(data?.items ?? []), ...(more?.items ?? [])];
  const cursor = more ? more.nextCursor : data?.nextCursor;
  const loadMore = async () => {
    if (!cursor) return;
    try {
      const next = await api<EnquiryList>(`${path}?cursor=${cursor}`);
      setMore((prev) => ({ items: [...(prev?.items ?? []), ...next.items], nextCursor: next.nextCursor }));
    } catch (err) {
      setMoreError(errorMessage(err));
    }
  };

  return (
    <>
      <PageHeader title="Enquiries" description="Messages visitors left in the chat. Each one was also emailed to you." />
      <Card className="py-0">
        <CardContent className="px-0">
          {loading && !data ? (
            <LoadingState />
          ) : error || !data ? (
            <ErrorState error={error} onRetry={reload} />
          ) : items.length === 0 ? (
            <EmptyState title="No enquiries yet">When a visitor leaves a message in the chat, it appears here.</EmptyState>
          ) : (
            <ul className="divide-y">
              {items.map((e) => (
                <li key={e.id} className="grid gap-1 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-xs text-muted-foreground">{fmt.format(new Date(e.createdAt))}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{e.need}</p>
                  <p className="flex flex-wrap gap-x-4 text-sm">
                    {e.email && (
                      <a className="underline underline-offset-4" href={`mailto:${e.email}`}>
                        {e.email}
                      </a>
                    )}
                    {e.phone && (
                      <a className="underline underline-offset-4" href={`tel:${e.phone.replace(/\s/g, '')}`}>
                        {e.phone}
                      </a>
                    )}
                    {e.conversationId && (
                      <Link className="text-muted-foreground underline underline-offset-4" href={`/w/${workspace.id}/conversations?c=${e.conversationId}`}>
                        See the chat
                      </Link>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {cursor && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <Button variant="outline" onClick={loadMore}>
            Load more
          </Button>
          {moreError && <p className="text-sm text-destructive">{moreError}</p>}
        </div>
      )}
    </>
  );
}
