import { BlockList, isIP } from 'node:net';

const privateNets = new BlockList();
privateNets.addSubnet('10.0.0.0', 8, 'ipv4');
privateNets.addSubnet('172.16.0.0', 12, 'ipv4');
privateNets.addSubnet('192.168.0.0', 16, 'ipv4');
privateNets.addSubnet('fc00::', 7, 'ipv6');

const trusted = (ip: string, trustPrivate: boolean): boolean => {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  const family = isIP(ip);
  return trustPrivate && family !== 0 && privateNets.check(ip, family === 4 ? 'ipv4' : 'ipv6');
};

/**
 * The client IP, as Express works it out for HTTP: walk X-Forwarded-For from the right, skipping trusted proxies
 * (this machine; with TRUST_PROXY=private also private networks such as the docker network).
 */
export const clientIp = (remote: string | undefined, forwarded: string | string[] | undefined, trustPrivate = false): string => {
  const peer = (remote ?? '').replace(/^::ffff:/, '');
  if (!trusted(peer, trustPrivate)) return peer || 'unknown';
  const header = Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '');
  const hops = header
    .split(',')
    .map((h) => h.trim().replace(/^::ffff:/, ''))
    .filter((h) => isIP(h));
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!trusted(hops[i]!, trustPrivate)) return hops[i]!;
  }
  return hops[0] ?? peer ?? 'unknown';
};
