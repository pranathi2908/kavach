import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  allowedDevOrigins: ["192.168.1.4", "searching-climate-dad-percentage.trycloudflare.com", "assure-leadership-comparing-skin.trycloudflare.com"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
