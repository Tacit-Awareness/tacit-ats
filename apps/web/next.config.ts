import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo has its own CLAUDE.md convention; don't let `next dev` inject
  // its own agent-rules block into it.
  agentRules: false,
};

export default nextConfig;
