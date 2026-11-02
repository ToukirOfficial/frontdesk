import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The dashboard calls the API on its own origin: /api/* is proxied to NestJS, so auth cookies stay first-party.
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8125';
const dev = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy: only this site's own scripts, styles, fonts and connections (the API and its WebSockets
 * are on the same origin); no plugins, no framing, forms post only here. Next.js needs inline scripts to hydrate,
 * and eval only in development (fast refresh).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  transpilePackages: ['@frontdesk/shared'],
  poweredByHeader: false,
  devIndicators: false,
  output: 'standalone',
  // The monorepo root, so the standalone build includes the workspace packages.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          // Browsers only honour this over HTTPS, so it's harmless on http://localhost.
          ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
        ],
      },
      // The widget is loaded by customers' sites; cache it for an hour.
      { source: '/widget.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
      // Keep invite and reset tokens out of Referer headers sent to other sites.
      { source: '/invite/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/reset-password', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ];
  },
};

export default nextConfig;
