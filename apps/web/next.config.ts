import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The dashboard calls the API on its own origin: /api/* is proxied to NestJS, so auth cookies stay first-party.
const apiUrl = process.env.API_URL ?? 'http://127.0.0.1:8125';

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
