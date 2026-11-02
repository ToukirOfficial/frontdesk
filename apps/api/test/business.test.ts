import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decrypt } from '../src/common/crypto.js';
import { addMember, as, registerOwner, reset, startApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());
beforeEach(() => reset(t));

const hours = {
  mon: { closed: false, open: '09:00', close: '17:30' },
  tue: { closed: false, open: '09:00', close: '17:30' },
  wed: { closed: false, open: '09:00', close: '17:30' },
  thu: { closed: false, open: '09:00', close: '20:00' },
  fri: { closed: false, open: '09:00', close: '17:00' },
  sat: { closed: false, open: '10:00', close: '13:00' },
  sun: { closed: true, open: '09:00', close: '17:00' },
  notes: 'Closed on bank holidays.',
};
const profile = {
  name: 'Riverside Physio',
  address: '1 Example Street, Exampletown',
  openingHours: hours,
  email: 'hello@riverside.example',
  phone: '01234 567890',
  bookingUrl: 'https://booking.example/riverside',
};
const KEY = 'sw_live_abc123_secretpartthatmustneverleak';

describe('business details and assistant settings', () => {
  it('saves and returns business details; staff and other workspaces can’t', async () => {
    const owner = await registerOwner(t, 'Workspace A');
    const staff = await addMember(t, owner, 'staff');
    const other = await registerOwner(t, 'Workspace B');
    const B = `/api/workspaces/${owner.workspaceId}/business`;

    const initial = await as(t, owner).get(B).expect(200);
    expect(initial.body.name).toBe('Workspace A');
    await as(t, owner).put(B, profile).expect(200);
    expect((await as(t, owner).get(B).expect(200)).body).toEqual(profile);

    await as(t, staff).get(B).expect(403);
    await as(t, staff).put(B, profile).expect(403);
    await as(t, other).get(B).expect(404);
    await as(t, other).put(B, profile).expect(404);
  });

  it('validates opening hours and URLs', async () => {
    const owner = await registerOwner(t);
    const B = `/api/workspaces/${owner.workspaceId}/business`;
    const bad = await as(t, owner)
      .put(B, { ...profile, bookingUrl: 'javascript:alert(1)', openingHours: { ...hours, mon: { closed: false, open: '18:00', close: '09:00' } } })
      .expect(400);
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['bookingUrl', 'openingHours.mon.close']));
  });

  it('saves the preset and rules', async () => {
    const owner = await registerOwner(t);
    const A = `/api/workspaces/${owner.workspaceId}/assistant`;
    const res = await as(t, owner)
      .put(A, { preset: 'law', rules: 'Never give legal advice; offer a consultation instead.' })
      .expect(200);
    expect(res.body).toMatchObject({
      preset: 'law',
      rules: 'Never give legal advice; offer a consultation instead.',
      slotwise: { connected: false, baseUrl: null },
      widget: { publicKey: expect.stringMatching(/^fd_pk_[0-9a-f]{32}$/), hasAvatar: false, allowedOrigins: [] },
    });
  });
});

describe('Slotwise API key', () => {
  it('is stored encrypted and never returned', async () => {
    const owner = await registerOwner(t);
    const S = `/api/workspaces/${owner.workspaceId}/slotwise`;
    const res = await as(t, owner).put(S, { baseUrl: 'https://slotwise.example/', apiKey: KEY }).expect(200);
    expect(res.body.slotwise).toEqual({ connected: true, baseUrl: 'https://slotwise.example' });
    expect(JSON.stringify(res.body)).not.toContain('secretpart');

    const read = await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/assistant`).expect(200);
    expect(JSON.stringify(read.body)).not.toContain('secretpart');

    const row = await t.prisma.assistantSettings.findUniqueOrThrow({ where: { workspaceId: owner.workspaceId } });
    expect(row.slotwiseKeyCipher).not.toContain('secretpart');
    expect(decrypt(row.slotwiseKeyCipher!, t.config.ENCRYPTION_KEY)).toBe(KEY);

    // A second encryption of the same key differs (random IV).
    await as(t, owner).put(S, { baseUrl: 'https://slotwise.example', apiKey: KEY }).expect(200);
    const row2 = await t.prisma.assistantSettings.findUniqueOrThrow({ where: { workspaceId: owner.workspaceId } });
    expect(row2.slotwiseKeyCipher).not.toBe(row.slotwiseKeyCipher);

    const off = await as(t, owner).delete(S).expect(200);
    expect(off.body.slotwise).toEqual({ connected: false, baseUrl: null });
  });

  it('only owners and admins can connect it, and only to their own workspace', async () => {
    const owner = await registerOwner(t, 'Workspace A');
    const staff = await addMember(t, owner, 'staff');
    const other = await registerOwner(t, 'Workspace B');
    const body = { baseUrl: 'https://slotwise.example', apiKey: KEY };
    await as(t, staff).put(`/api/workspaces/${owner.workspaceId}/slotwise`, body).expect(403);
    await as(t, other).put(`/api/workspaces/${owner.workspaceId}/slotwise`, body).expect(404);
  });

  it('rejects keys that don’t look like Slotwise keys', async () => {
    const owner = await registerOwner(t);
    await as(t, owner).put(`/api/workspaces/${owner.workspaceId}/slotwise`, { baseUrl: 'https://slotwise.example', apiKey: 'nope' }).expect(400);
  });
});
