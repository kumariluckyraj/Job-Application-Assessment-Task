import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: { "/api/**/*": ["./data/jobs.json"] },
  serverExternalPackages: ["@libsql/client", "libsql"],
};
export default nextConfig;