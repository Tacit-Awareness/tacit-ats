// The client ATS's domain logic. Everything here runs on a client member's own
// token (or, for first sign-in, the service role) so RLS decides what a member
// sees. The pipeline, connector and org-onboarding pieces it builds on are
// tacit-internal's @tacit/core, vendored (vendor/, scripts/sync-tacit.mjs).

// First sign-in for a member of a client org (apps/web's /client, apps/mcp's /api/client).
export { bindSupabaseUser } from "./client-auth/bind.js";
export type { BindSupabaseResult, SupabaseIdentity } from "./client-auth/bind.js";
// A client admin inviting their own team, on their own token.
export { ClientInviteError, inviteClientMember, listPendingInvites, withdrawClientInvite } from "./client-auth/invite.js";
export type { ClientInviteResult, InvitationRevoker, PendingInvite } from "./client-auth/invite.js";

// The client connector's tools (apps/mcp /api/client). Namespaced like
// @tacit/core's staff `connector`.
export * as clientTools from "./client-tools/index.js";
