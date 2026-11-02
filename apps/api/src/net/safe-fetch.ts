import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

/**
 * Server-side fetching of URLs that a workspace admin typed in (website import, Slotwise). Guards against SSRF:
 * - http(s) only, no credentials in the URL; plain http only when allowed (development);
 * - the host is resolved here and EVERY address must be public: loopback, private, link-local (incl. cloud
 *   metadata 169.254.169.254), CGNAT, multicast, reserved, unique-local IPv6 and IPv4-mapped forms are refused;
 * - the connection goes to the vetted address (a pinned DNS lookup), so a second DNS answer can't swap it
 *   (DNS rebinding); TLS still checks the certificate against the real host name;
 * - redirects are never followed (the caller decides, and a new URL goes through all of this again);
 * - a total timeout and a body size limit.
 */

export class UrlRejectedError extends Error {}

const v4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT (also Alibaba Cloud metadata 100.100.100.200)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
] as const) {
  v4.addSubnet(net, prefix, 'ipv4');
}

const v6 = new BlockList();
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback and IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped (checked as IPv4 below as well)
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (incl. Teredo)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds an IPv4 address)
  ['fc00::', 7], // unique local (incl. AWS metadata fd00:ec2::254)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  v6.addSubnet(net, prefix, 'ipv6');
}

/** IPv4 inside an IPv4-mapped IPv6 address (::ffff:7f00:1 or ::ffff:127.0.0.1), if any. */
const mappedV4 = (ip: string): string | null => {
  const lower = ip.toLowerCase();
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted?.[1]) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex?.[1] && hex[2]) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
};

/** True for any address a server-side fetch must never reach. Unparseable input counts as blocked. */
export const isBlockedAddress = (ip: string): boolean => {
  const family = isIP(ip);
  if (family === 4) return v4.check(ip, 'ipv4');
  if (family === 6) {
    const inner = mappedV4(ip);
    if (inner) return true; // IPv4-mapped: never needed for a public website, and a classic bypass
    return v6.check(ip, 'ipv6');
  }
  return true;
};

export interface SafeFetchOptions {
  /** Allow plain http (development only). */
  allowHttp?: boolean;
  /** Allow private and loopback addresses (tests and local development only). */
  allowPrivate?: boolean;
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: URL;
}

/** Checks a URL's form (scheme, credentials) before any network access. */
export const checkUrlShape = (raw: string, allowHttp: boolean): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlRejectedError('That isn’t a valid web address.');
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new UrlRejectedError(allowHttp ? 'Use an http or https address.' : 'Use an https:// address.');
  }
  if (url.username || url.password) throw new UrlRejectedError('Addresses with a username or password aren’t allowed.');
  return url;
};

/** Resolves the host and returns one vetted address. Every resolved address must be public. */
export const resolvePublic = async (host: string, allowPrivate: boolean): Promise<{ address: string; family: 4 | 6 }> => {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const literal = isIP(bare);
  const addresses = literal
    ? [{ address: bare, family: literal }]
    : await dnsLookup(bare, { all: true, verbatim: true }).catch(() => {
        throw new UrlRejectedError('That website’s address couldn’t be found.');
      });
  if (!addresses.length) throw new UrlRejectedError('That website’s address couldn’t be found.');
  if (!allowPrivate && addresses.some((a) => isBlockedAddress(a.address))) {
    throw new UrlRejectedError('That address points to a private or internal network, which isn’t allowed.');
  }
  const first = addresses[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
};

/** Every connection uses the vetted address, whatever DNS says now. */
const pinnedLookup =
  (pinned: { address: string; family: 4 | 6 }): LookupFunction =>
  (_host, options, cb) => {
    if ((options as { all?: boolean }).all) {
      (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
        { address: pinned.address, family: pinned.family },
      ]);
    } else {
      cb(null, pinned.address, pinned.family);
    }
  };

export const safeFetch = async (raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> => {
  const url = checkUrlShape(raw, opts.allowHttp ?? false);
  const pinned = await resolvePublic(url.hostname, opts.allowPrivate ?? false);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const lookup = pinnedLookup(pinned);

  const client = url.protocol === 'https:' ? https : http;
  return new Promise<SafeResponse>((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: opts.method ?? 'GET',
        headers: { 'user-agent': 'FrontdeskBot/1.0 (+self-hosted AI receptionist)', ...opts.headers },
        lookup,
        agent: false,
      },
      (res) => {
        const declared = Number(res.headers['content-length'] ?? 0);
        if (declared > maxBytes) {
          req.destroy(new UrlRejectedError('The page is too large.'));
          return;
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new UrlRejectedError('The page is too large.'));
            return;
          }
          parts.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts), url }));
        res.on('error', reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new UrlRejectedError('The website took too long to answer.')), timeoutMs);
    req.on('error', (err) => reject(err instanceof UrlRejectedError ? err : new UrlRejectedError('The website couldn’t be reached.')));
    req.on('close', () => clearTimeout(timer));
    if (opts.body) req.write(opts.body);
    req.end();
  });
};

const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * A `fetch` with the same SSRF guard, for an AI endpoint an admin typed in (OpenAI-compatible base URL). Unlike
 * safeFetch it streams the response (chat replies arrive word by word), so the limit is a total time, not a size.
 * Redirects are not followed.
 */
export const guardedFetch =
  (opts: { allowHttp: boolean; allowPrivate: boolean; timeoutMs?: number }): typeof fetch =>
  async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = checkUrlShape(raw, opts.allowHttp);
    const pinned = await resolvePublic(url.hostname, opts.allowPrivate);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    headers['accept-encoding'] = 'identity'; // we pass the raw stream on, so ask for it uncompressed
    const body =
      init.body == null ? undefined : typeof init.body === 'string' ? init.body : Buffer.from(await new Response(init.body).arrayBuffer());
    const client = url.protocol === 'https:' ? https : http;

    return new Promise<Response>((resolve, reject) => {
      const req = client.request(url, { method: init.method ?? 'GET', headers, lookup: pinnedLookup(pinned), agent: false }, (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
          else if (v !== undefined) h.set(k, String(v));
        }
        const status = res.statusCode ?? 502;
        res.on('close', () => clearTimeout(timer));
        resolve(new Response(NULL_BODY.has(status) ? null : (Readable.toWeb(res) as ReadableStream), { status, headers: h }));
      });
      const fail = (err: Error) => req.destroy(err);
      const timer = setTimeout(() => fail(new UrlRejectedError('The AI endpoint took too long to answer.')), opts.timeoutMs ?? 120_000);
      init.signal?.addEventListener('abort', () => fail(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err instanceof UrlRejectedError || err.name === 'AbortError' ? err : new UrlRejectedError('The AI endpoint couldn’t be reached.'));
      });
      if (body !== undefined) req.write(body);
      req.end();
    });
  };
