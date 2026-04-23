import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      {
        source: '/chaine',
        destination: '/chains',
        permanent: true,
      },
      {
        source: '/chaine/:path*',
        destination: '/chains/:path*',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
