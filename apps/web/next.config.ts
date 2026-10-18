import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  async redirects() {
    return [{
      source: '/:path*',
      has: [{ type: 'host', value: 'www\\.healbelly\\.in' }],
      destination: 'https://healbelly.in/:path*',
      permanent: true,
    }];
  },
  async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.API_URL || 'http://127.0.0.1:4319'}/api/:path*` }]; },
};
export default config;
