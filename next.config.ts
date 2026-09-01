import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-XSS-Protection",
    value: "1; mode=block",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: http: https://media.licdn.com",
      "font-src 'self' data:",
      "connect-src 'self' https://apilist.tronscanapi.com https://www.linkedin.com https://api.linkedin.com https://www.googletagmanager.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Note: Next.js 16 defaults to Turbopack for `next build`, but as of
  // 16.3.x Turbopack's standalone output mode is incomplete — it never
  // emits `.next/standalone/server.js`, breaking the Docker image.
  // We force webpack via the `--webpack` CLI flag in package.json's
  // `build` script. There is no next.config option to disable Turbopack
  // globally; the CLI flag is the only supported opt-in.
  async headers() {
    const headers = [...securityHeaders];

    // HSTS only in production
    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      });
    }

    return [
      {
        source: "/(.*)",
        headers,
      },
    ];
  },
};

export default nextConfig;
