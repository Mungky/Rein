import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL;

const nextConfig: NextConfig = {
  // Proxy /api/* to the VPS backend in production.
  // In development, BACKEND_URL is unset and the frontend calls localhost:8000 directly.
  ...(backendUrl && {
    async rewrites() {
      return [
        {
          source: "/api/:path*",
          destination: `${backendUrl}/api/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
