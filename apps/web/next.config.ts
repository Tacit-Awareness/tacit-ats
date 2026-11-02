import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // This repo has its own CLAUDE.md convention; don't let `next dev` inject
  // its own agent-rules block into it.
  agentRules: false,
  // A referral's resume comes through a server action, 1 MB by default: core's
  // 3 MB file with the form around it, under Vercel's 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

// The Workflow SDK: a client interview's exact reminder timer
// (src/workflows/) sleeps until five minutes before it starts. Its routes are
// under /.well-known/workflow/, outside proxy.ts's /client matcher.
export default withWorkflow(nextConfig);
