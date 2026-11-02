'use client';

import type { AssignableRole, InviteList, MemberList, Role } from '@frontdesk/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { canManage, useMe, useWorkspace } from '@/components/session';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, errorMessage } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', staff: 'Staff' };
const ROLE_HELP = 'Admins manage knowledge, settings and the team. Staff answer conversations and enquiries.';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });

function RoleSelect({ value, onChange, id, disabled }: { value: AssignableRole; onChange: (r: AssignableRole) => void; id?: string; disabled?: boolean }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AssignableRole)} disabled={disabled}>
      <SelectTrigger id={id} className="w-32" aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="staff">Staff</SelectItem>
      </SelectContent>
    </Select>
  );
}

function Members() {
  const { me } = useMe();
  const { workspace } = useWorkspace();
  const { data, error, loading, reload } = useApi<MemberList>(`/workspaces/${workspace.id}/members`);
  const isOwner = workspace.role === 'owner';

  const changeRole = async (userId: string, role: AssignableRole) => {
    try {
      await api(`/workspaces/${workspace.id}/members/${userId}`, { method: 'PATCH', body: { role } });
      toast.success('Role updated');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async (userId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from ${workspace.name}?`)) return;
    try {
      await api(`/workspaces/${workspace.id}/members/${userId}`, { method: 'DELETE' });
      toast.success(`${name} removed`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead className="hidden sm:table-cell">Joined</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.items.map((m) => {
          const self = m.userId === me.id;
          const canRemove = m.role !== 'owner' && !self && (isOwner || (workspace.role === 'admin' && m.role === 'staff'));
          return (
            <TableRow key={m.userId}>
              <TableCell>
                <p className="font-medium">
                  {m.name}
                  {self && <span className="font-normal text-muted-foreground"> (you)</span>}
                </p>
                <p className="text-sm text-muted-foreground">{m.email}</p>
              </TableCell>
              <TableCell>
                {isOwner && m.role !== 'owner' ? (
                  <RoleSelect value={m.role} onChange={(r) => changeRole(m.userId, r)} />
                ) : (
                  <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>{ROLE_LABEL[m.role]}</Badge>
                )}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                {dateFmt.format(new Date(m.joinedAt))}
              </TableCell>
              <TableCell className="text-right">
                {canRemove && (
                  <Button variant="ghost" size="sm" onClick={() => remove(m.userId, m.name)}>
                    Remove
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Invites() {
  const { workspace } = useWorkspace();
  const { data, error, loading, reload } = useApi<InviteList>(`/workspaces/${workspace.id}/invites`);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableRole>('staff');
  const { pending, formError, fields, run } = useSubmit();

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api(`/workspaces/${workspace.id}/invites`, { method: 'POST', body: { email, role } }));
    if (ok) {
      toast.success(`Invite sent to ${email}`);
      setEmail('');
      reload();
    }
  };
  const revoke = async (id: string) => {
    try {
      await api(`/workspaces/${workspace.id}/invites/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="grid gap-6">
      <Form onSubmit={send} className="grid gap-4">
        <FormError message={formError} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <RoleSelect id="invite-role" value={role} onChange={setRole} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? 'Sending…' : 'Send invite'}
          </Button>
        </div>
      </Form>
      {loading && !data ? (
        <LoadingState />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No pending invites" />
      ) : (
        <ul className="divide-y rounded-md border">
          {data.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-medium">{i.email}</span>
                <span className="text-sm text-muted-foreground">
                  {ROLE_LABEL[i.role]} · expires {dateFmt.format(new Date(i.expiresAt))}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => revoke(i.id)}>
                Cancel invite
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TeamPage() {
  const { workspace } = useWorkspace();
  if (!canManage(workspace)) {
    return (
      <>
        <PageHeader title="Team" />
        <EmptyState title="Only owners and admins manage the team" />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Team" description={ROLE_HELP} />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Members</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Members />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Invite someone</h2>
            </CardTitle>
            <CardDescription>They’ll get an email with a link that works for 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <Invites />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
