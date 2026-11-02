'use client';

import { type BusinessProfile, DAYS, type Day, type DayHours } from '@frontdesk/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { ManageOnly } from '@/components/manage-only';
import { useWorkspace } from '@/components/session';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';

const DAY_LABEL: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function HoursRow({ day, value, onChange, error }: { day: Day; value: DayHours; onChange: (v: DayHours) => void; error?: string }) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-sm font-medium">{DAY_LABEL[day]}</span>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={!value.closed} onCheckedChange={(open) => onChange({ ...value, closed: !open })} aria-label={`Open on ${DAY_LABEL[day]}`} />
          {value.closed ? 'Closed' : 'Open'}
        </label>
        {!value.closed && (
          <span className="flex items-center gap-2">
            <Input type="time" className="w-32" value={value.open} onChange={(e) => onChange({ ...value, open: e.target.value })} aria-label={`${DAY_LABEL[day]} opening time`} />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="time" className="w-32" value={value.close} onChange={(e) => onChange({ ...value, close: e.target.value })} aria-label={`${DAY_LABEL[day]} closing time`} />
          </span>
        )}
      </div>
      {error && <p className="text-sm text-destructive sm:pl-27">{error}</p>}
    </div>
  );
}

function BusinessForm({ initial }: { initial: BusinessProfile }) {
  const { workspace } = useWorkspace();
  const [form, setForm] = useState(initial);
  const { pending, formError, fields, run } = useSubmit();
  const set = <K extends keyof BusinessProfile>(k: K, v: BusinessProfile[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api(`/workspaces/${workspace.id}/business`, { method: 'PUT', body: form }));
    if (ok) toast.success('Business details saved');
  };

  return (
    <Form onSubmit={save} className="grid gap-6">
      <FormError message={formError} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Contact details</h2>
          </CardTitle>
          <CardDescription>The assistant always knows these, so visitors get them right.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" value={form.name} onChange={(e) => set('name', e.target.value)} error={fields.name} />
          <Field label="Phone" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} error={fields.phone} />
          <Field label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={fields.email} />
          <Field
            label="Booking link"
            type="url"
            placeholder="https://"
            value={form.bookingUrl}
            onChange={(e) => set('bookingUrl', e.target.value)}
            error={fields.bookingUrl}
            hint="Shown when someone wants to book."
          />
          <div className="sm:col-span-2">
            <Field label="Address" value={form.address} onChange={(e) => set('address', e.target.value)} error={fields.address} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Opening hours</h2>
          </CardTitle>
          <CardDescription>UK time.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {DAYS.map((d) => (
            <HoursRow
              key={d}
              day={d}
              value={form.openingHours[d]}
              onChange={(v) => set('openingHours', { ...form.openingHours, [d]: v })}
              error={fields[`openingHours.${d}.close`] ?? fields[`openingHours.${d}.open`]}
            />
          ))}
          <Field
            label="Notes"
            placeholder="e.g. Closed on bank holidays"
            value={form.openingHours.notes}
            onChange={(e) => set('openingHours', { ...form.openingHours, notes: e.target.value })}
            error={fields['openingHours.notes']}
          />
        </CardContent>
      </Card>
      <Button type="submit" className="w-fit" disabled={pending}>
        {pending ? 'Saving…' : 'Save business details'}
      </Button>
    </Form>
  );
}

function Business() {
  const { workspace } = useWorkspace();
  const { data, error, loading, reload } = useApi<BusinessProfile>(`/workspaces/${workspace.id}/business`);
  return (
    <>
      <PageHeader title="Business details" description="Name, contact details and opening hours." />
      {loading && !data ? <LoadingState /> : error || !data ? <ErrorState error={error} onRetry={reload} /> : <BusinessForm initial={data} />}
    </>
  );
}

export default function BusinessPage() {
  return (
    <ManageOnly title="Business details">
      <Business />
    </ManageOnly>
  );
}
