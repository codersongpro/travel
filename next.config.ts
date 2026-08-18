import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "places.googleapis.com" }],
  },
};

export default nextConfig;
