import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo has its own CLAUDE.md convention; don't let `next dev` inject
  // its own agent-rules block into apps/internal/CLAUDE.md on every run.
  agentRules: false,
  // Override for local smoke runs (build+start against the local Supabase
  // stack while a `next dev` holds .next's dev lock) — a second build into
  // its own dist dir never contends with the running dev server's cache.
  distDir: process.env.TACIT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      // /connections uploads a whole LinkedIn Connections.csv through a
      // server action; a well-networked export runs past the 1MB default.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
