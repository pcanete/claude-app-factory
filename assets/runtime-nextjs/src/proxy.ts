import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkAuthConfigured } from "@/platform/auth/config";

const withClerk = clerkMiddleware();

/**
 * Rutas que se autentican solas y no pasan por Clerk (2.6.1): el MCP (credencial de agente
 * u OAuth, verificado en la ruta con `platform/mcp/oauth.ts`), el ticket de subida y la
 * salud. En /api/mcp el middleware dejaba la invocación abierta hasta el tope de 300 s
 * aunque la respuesta ya hubiera salido: un tercio de las llamadas, y casi todo el consumo
 * de funciones del plan.
 *
 * Quedan afuera dos veces: en el `matcher`, para que el middleware ni corra, y acá, por si
 * el patrón no las excluyera. `scripts/test-mcp-sin-middleware.mjs` exige las dos.
 */
const RUTAS_SIN_MIDDLEWARE = ["/api/mcp", "/api/producido/subidas", "/api/health"];

function seAutenticaSola(pathname: string) {
  return RUTAS_SIN_MIDDLEWARE.some((ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`));
}

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Los metadatos de OAuth se consultan justamente para averiguar cómo autenticarse,
  // así que se sirven sin credencial: si el middleware los interceptara, un cliente
  // remoto nunca podría empezar el flujo.
  if (request.nextUrl.pathname.startsWith("/.well-known/")) return NextResponse.next();
  if (seAutenticaSola(request.nextUrl.pathname)) return NextResponse.next();
  if (!clerkAuthConfigured()) return NextResponse.next();
  return withClerk(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|api/mcp|api/producido/subidas|api/health|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api/(?!mcp|producido/subidas|health)|trpc)(.*)",
  ],
};
