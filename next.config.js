/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  env: {
    CF_API: 'https://codeforces.com/api/',
  },
};

module.exports = nextConfig;
