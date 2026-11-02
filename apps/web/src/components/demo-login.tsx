'use client';

import type { WorkspaceList } from '@frontdesk/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';

/**
 * "Open the demo dashboard": signs in as the public demo clinic's shared admin. Shown only when the server runs in
 * demo mode (GET /api/demo answers); the API refuses the sign-in otherwise.
 */
export function DemoLoginButton({ className, checkDemo = false }: { className?: string; checkDemo?: boolean }) {
  const router = useRouter();
  const [available, setAvailable] = useState(!checkDemo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!checkDemo) return;
    fetch('/api/demo', { credentials: 'omit' })
      .then((r) => setAvailable(r.ok))
      .catch(() => setAvailable(false));
  }, [checkDemo]);

  if (!available) return null;
  const open = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('/auth/demo', { method: 'POST', noRefresh: true });
      const list = await api<WorkspaceList>('/workspaces');
      router.push(list.items[0] ? `/w/${list.items[0].id}` : '/w');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <div className={className}>
      <Button type="button" variant="outline" className="w-full" onClick={open} disabled={busy}>
        {busy ? 'Opening…' : 'Open the demo dashboard'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
