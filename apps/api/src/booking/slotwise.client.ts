import { ErrorCode } from '@frontdesk/shared';
import { z } from 'zod';
import { AppError } from '../common/errors.js';
import { safeFetch } from '../net/safe-fetch.js';

/**
 * Slotwise's public API (base URL + /api/v1, Bearer sw_live_… key). Every call goes through safeFetch, so a base URL
 * pointing at a private network is refused like any other admin-supplied address.
 */

const serviceSchema = z.object({ id: z.uuid(), name: z.string(), durationMin: z.number().int(), pricePence: z.number().int(), active: z.boolean().optional() });
const servicesSchema = z.union([z.array(serviceSchema), z.object({ items: z.array(serviceSchema) })]);
const availabilitySchema = z.object({
  days: z.array(z.object({ date: z.string(), slots: z.array(z.object({ startsAt: z.string(), localTime: z.string() })) })),
});
const bookingSchema = z.object({ startsAt: z.string() }).loose();
const errorSchema = z.object({ errorCode: z.string().optional(), message: z.string().optional() }).loose();

export interface SlotwiseConnection {
  baseUrl: string;
  apiKey: string;
  allowHttp: boolean;
  allowPrivate: boolean;
}

const unavailable = (msg = 'Booking isn’t available right now. Please try again later or leave a message.') =>
  new AppError(502, ErrorCode.BOOKING_UNAVAILABLE, msg);

const call = async (c: SlotwiseConnection, method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<unknown> => {
  let res;
  try {
    res = await safeFetch(`${c.baseUrl}/api/v1${path}`, {
      method,
      allowHttp: c.allowHttp,
      allowPrivate: c.allowPrivate,
      timeoutMs: 10_000,
      maxBytes: 1024 * 1024,
      headers: {
        authorization: `Bearer ${c.apiKey}`,
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw unavailable();
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body.toString('utf8'));
  } catch {
    json = null;
  }
  if (res.status >= 200 && res.status < 300) return json;
  const err = errorSchema.safeParse(json);
  if (res.status === 409 && err.success && err.data.errorCode === 'SLOT_TAKEN') {
    throw new AppError(409, ErrorCode.SLOT_TAKEN, 'Sorry, that time has just been taken. Please pick another.');
  }
  if (res.status === 429) throw unavailable('Booking is busy right now. Please try again in a minute.');
  throw unavailable();
};

export const slotwise = {
  async services(c: SlotwiseConnection) {
    const parsed = servicesSchema.safeParse(await call(c, 'GET', '/services'));
    if (!parsed.success) throw unavailable();
    const list = Array.isArray(parsed.data) ? parsed.data : parsed.data.items;
    return list.filter((s) => s.active !== false).map(({ id, name, durationMin, pricePence }) => ({ id, name, durationMin, pricePence }));
  },

  async availability(c: SlotwiseConnection, serviceId: string, from: string, to: string) {
    const q = new URLSearchParams({ serviceId, from, to });
    const parsed = availabilitySchema.safeParse(await call(c, 'GET', `/availability?${q.toString()}`));
    if (!parsed.success) throw unavailable();
    return { days: parsed.data.days.map((d) => ({ date: d.date, slots: d.slots.map((s) => ({ startsAt: s.startsAt, localTime: s.localTime })) })) };
  },

  async book(
    c: SlotwiseConnection,
    body: { serviceId: string; startsAt: string; customer: { name: string; email: string; phone: string } },
    idempotencyKey: string,
  ) {
    const parsed = bookingSchema.safeParse(await call(c, 'POST', '/bookings', { ...body, staffId: 'any' }, idempotencyKey));
    if (!parsed.success) throw unavailable();
    return parsed.data;
  },
};
