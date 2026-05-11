import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Proxy /api/* to backend in production via BACKEND_URL (server-side only).
  // Used when frontend and backend share the same domain (e.g. domain.com/api).
  // If using a separate subdomain (api.domain.com), leave BACKEND_URL unset.
  ...(process.env.BACKEND_URL && {
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: `${process.env.BACKEND_URL}/api/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
