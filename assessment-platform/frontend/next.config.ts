import type { NextConfig } from 'next';
// A Vercel deployment cannot reach this computer's loopback API. Fail at build
// time instead of publishing a page with an unusable or insecure proxy target.
if (process.env.VERCEL === '1') {
  const backend = new URL(process.env.BACKEND_API_URL ?? '');
  if (backend.protocol !== 'https:' || backend.origin !== process.env.BACKEND_API_URL)
    throw new Error('Vercel requires BACKEND_API_URL to be the exact HTTPS Railway API origin.');
}
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]
            : []),
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.BACKEND_API_URL ?? 'http://127.0.0.1:4000'}/api/v1/:path*`,
      },
    ];
  },
};
export default config;
