// Server components only (it reads API_URL).

const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8125';

/** The demo clinic's widget key, or null when the server isn't in demo mode. Display only: the API decides. */
export async function demoKey(): Promise<string | null> {
  try {
    const res = await fetch(`${apiUrl}/api/demo`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { publicKey?: unknown };
    return typeof body.publicKey === 'string' ? body.publicKey : null;
  } catch {
    return null;
  }
}
