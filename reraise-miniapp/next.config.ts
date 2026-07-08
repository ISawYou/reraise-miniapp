import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Without this, Next.js walks up and finds the stray package-lock.json in
  // the parent folder and infers that as the workspace root, which nests the
  // standalone output an extra level deep (.next/standalone/reraise-miniapp/
  // reraise-miniapp/server.js instead of .next/standalone/server.js).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
