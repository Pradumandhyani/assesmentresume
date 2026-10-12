import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: 'standalone',
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
