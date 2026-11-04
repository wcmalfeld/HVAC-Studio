import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@hvac/shared-types", "@hvac/building-geometry"],
  async rewrites() {
    // Same-origin API so the httpOnly session cookie is first-party.
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
