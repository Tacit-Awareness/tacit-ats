import { bridgeResponse, isEndpoint, parseBridgeRequest, refusalStatus } from "@/lib/bridge/requests";
import { bridgeSecrets, verifyBridgeRequest } from "@/lib/bridge/signature";
import { callBridge } from "@/lib/bridge/store";

// The staff bridge (docs/client-project-split.md): tacit-internal's one way
// into client orgs once they live on this project. Four signed POSTs, each one
// bridge_* function on the service role (lib/bridge/store.ts):
//
//   /api/bridge/jobs, /api/bridge/job-for-role,
//   /api/bridge/submit-candidate, /api/bridge/report
//
// No session: proxy.ts covers /client only. The signature
// (lib/bridge/signature.ts, TACIT_BRIDGE_SECRET) is checked on the raw body
// before it is parsed, and before anything reaches the database; unset, the
// bridge is off and every path is a 404, like a mistyped one. A refusal
// answers the function's own sentence (they name nothing the caller did not
// send), anything else a bare 500 with the detail in the log.

const MAX_BYTES = 256 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ endpoint: string }> }): Promise<Response> {
  const secrets = bridgeSecrets(process.env.TACIT_BRIDGE_SECRET);
  const { endpoint } = await params;
  if (secrets.length === 0 || !isEndpoint(endpoint)) return new Response(null, { status: 404 });

  const body = await request.text();
  if (body.length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  if (!verifyBridgeRequest(secrets, request.headers, body)) return new Response(null, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ error: "the body is JSON" }, { status: 400 });
  }
  const parsed = parseBridgeRequest(endpoint, json);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const answer = await callBridge(parsed.call);
  if (!answer.ok) {
    const status = refusalStatus(answer.code);
    if (status === 500) {
      console.error(`[bridge] ${endpoint} failed:`, answer.code, answer.message);
      return new Response(null, { status: 500 });
    }
    return Response.json({ error: answer.message }, { status });
  }
  return Response.json(bridgeResponse(endpoint, answer));
}
