import { getVercelOidcToken } from "@vercel/oidc";
import { clientTools } from "@tacit-ats/core";

/**
 * Tacit's Google service account for companies' Workspaces (domain-wide
 * delegation), as this deployment signs with it: keyless in production, the
 * deployment's own Vercel OIDC token exchanged through a Workload Identity
 * pool (GCP_* settings), or a JSON key (CLIENT_GOOGLE_SERVICE_ACCOUNT) where
 * one is allowed. Null when neither is set. A signer, never a credential.
 */
export function tacitDelegation(env: Record<string, string | undefined> = process.env): clientTools.DelegationSigner | null {
  return clientTools.delegationFrom(env, () => getVercelOidcToken());
}
