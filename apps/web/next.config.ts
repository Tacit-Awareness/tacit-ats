import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo has its own CLAUDE.md convention; don't let `next dev` inject
  // its own agent-rules block into apps/internal/CLAUDE.md on every run.
  agentRules: false,
  experimental: {
    serverActions: {
      // /connections uploads a whole LinkedIn Connections.csv through a
      // server action; a well-networked export runs past the 1MB default.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
