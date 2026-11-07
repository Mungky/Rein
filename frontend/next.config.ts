import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "development" && process.env.WORKSPACE_LOCAL_PREVIEW === "1" ? ".next-preview" : ".next",
  experimental: { cpus: 2, webpackMemoryOptimizations: true },
  turbopack: { root: path.resolve(__dirname) },
  // Security headers (audit Fase 2). SAMEORIGIN still allows our own orbit
  // iframes; it only blocks OTHER sites from embedding REIN (clickjacking).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
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
