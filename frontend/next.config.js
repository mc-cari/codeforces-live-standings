/** @type {import('next').NextConfig} */
const path = require('path');

const turbopackRoot = process.env.VERCEL && path.basename(__dirname) === 'frontend'
  ? path.dirname(__dirname)
  : __dirname;

const nextConfig = {
  reactStrictMode: false,
  turbopack: {
    root: turbopackRoot,
  },
  async headers() {
    return [{
      source: '/demo/:path*',
      headers: [{
        key: 'Cache-Control',
        value: 'public, max-age=31536000, immutable',
      }],
    }];
  },
};

module.exports = nextConfig;
