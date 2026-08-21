import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFactoryMcpServer } from "@/platform/mcp/server";
import { authenticateAgentToken, type AgentPrincipal } from "@/platform/mcp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FactoryAuthInfo = AuthInfo & { factoryAgent: AgentPrincipal };

const handler = createMcpHandler(({ authInfo }) => {
  const agent = (authInfo as FactoryAuthInfo | undefined)?.factoryAgent;
  if (!agent) throw new Error("Identidad de agente ausente.");
  return createFactoryMcpServer(agent);
}, { responseMode: "json" });

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match?.[1] ?? null;
}

function configuredHosts() {
  const values = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : undefined,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    ...(process.env.MCP_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  ].filter((value): value is string => Boolean(value));
  return new Set(values.map((value) => {
    try {
      return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
    } catch {
      return "";
    }
  }).filter(Boolean));
}

function requestHostAllowed(request: Request) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  if (process.env.NODE_ENV !== "production" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true;
  const allowed = configuredHosts();
  if (!allowed.size || !allowed.has(host)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return allowed.has(new URL(origin).host.toLowerCase());
  } catch {
    return false;
  }
}

function unauthorized(message = "Credencial MCP inválida.") {
  return Response.json(
    { error: message },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="factory-mcp"' } },
  );
}

async function serve(request: Request) {
  if (!requestHostAllowed(request)) return Response.json({ error: "Host u origen no autorizado." }, { status: 403 });
  const token = bearerToken(request);
  if (!token) return unauthorized();
  const agent = await authenticateAgentToken(token);
  if (!agent) return unauthorized();
  const authInfo: FactoryAuthInfo = {
    token,
    clientId: agent.id,
    scopes: agent.scopes,
    factoryAgent: agent,
  };
  return handler.fetch(request, { authInfo });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
