'use client';

import type { WorkspaceList } from '@frontdesk/shared';
import { Check, ChevronsUpDown, Home, LogOut, Menu, Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogoMark } from '@/components/logo';
import { canManage, useMe, useWorkspace } from '@/components/session';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  manageOnly?: boolean;
}

const nav = (id: string): NavItem[] => [
  { href: `/w/${id}`, label: 'Overview', icon: Home },
  { href: `/w/${id}/team`, label: 'Team', icon: Users, manageOnly: true },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const items = nav(workspace.id).filter((i) => !i.manageOnly || canManage(workspace));
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {items.map(({ href, label, icon: Icon }, i) => {
        // The overview link is only active on the overview itself.
        const active = i === 0 ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              active && 'bg-accent font-medium text-accent-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className={cn('size-4', active && 'text-primary')} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function WorkspaceSwitcher() {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const { data } = useApi<WorkspaceList>('/workspaces');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
          aria-label={`Workspace: ${workspace.name}. Switch workspace`}
        >
          <LogoMark />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-tight font-semibold tracking-[-0.02em]">Frontdesk</span>
            <span className="block truncate text-[12px] leading-tight text-muted-foreground">{workspace.name}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {(data?.items ?? []).map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => router.push(`/w/${w.id}`)}>
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {w.id === workspace.id && <Check className="size-4" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/w?new=1')}>
          <Plus className="size-4" /> New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserBox() {
  const { me } = useMe();
  const logout = async () => {
    await api('/auth/logout', { method: 'POST', noRefresh: true }).catch(() => undefined);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load drops the old session's state
    window.location.assign('/login');
  };
  return (
    <div className="flex items-center gap-2.5 border-t px-2.5 pt-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{me.name}</p>
        <p className="truncate text-[13px] text-muted-foreground">{me.email}</p>
      </div>
      <Button variant="ghost" size="icon" aria-label="Log out" title="Log out" onClick={logout}>
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { workspace } = useWorkspace();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between border-r bg-sidebar p-3 md:flex">
        <div className="grid gap-5">
          <WorkspaceSwitcher />
          <Nav />
        </div>
        <UserBox />
      </aside>
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b bg-sidebar/90 px-3 backdrop-blur md:hidden">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher />
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex flex-col justify-between p-4">
            <div className="grid gap-6">
              <SheetTitle>Menu</SheetTitle>
              <Nav onNavigate={() => setOpen(false)} />
            </div>
            <UserBox />
          </SheetContent>
        </Sheet>
      </header>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-[1100px]">
          {workspace.isDemo && (
            <p className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-medium">Demo workspace.</span> It resets every night and no emails are sent.
            </p>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[1.6rem] leading-tight font-semibold tracking-[-0.025em]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
