import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep ws optional native-addon detection in Node. Bundling its missing
  // bufferutil dependency can produce an empty module and break masked sends.
  serverExternalPackages: ["ws"],
};

export default nextConfig;
