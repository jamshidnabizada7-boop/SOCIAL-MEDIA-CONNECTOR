import path from "node:path";
import type { NextConfig } from "next";

/**
 * Security headers (plan §60). CSP allows the API origin for authenticated
 * media/img requests; frame ancestors deny clickjacking.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Self-contained server for the production image (deploy/web.Dockerfile).
  output: "standalone",
  // Monorepo: trace dependencies from the repo root (builds run in apps/web).
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
