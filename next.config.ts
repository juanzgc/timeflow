import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for optimized Docker builds (~150MB vs 1GB+)
  output: 'standalone',
};

export default nextConfig;
