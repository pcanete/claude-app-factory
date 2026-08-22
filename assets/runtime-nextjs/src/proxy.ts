import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkAuthConfigured } from "@/platform/auth/config";

const withClerk = clerkMiddleware();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  // Los metadatos de OAuth se consultan justamente para averiguar cómo autenticarse,
  // así que se sirven sin credencial: si el middleware los interceptara, un cliente
  // remoto nunca podría empezar el flujo.
  if (request.nextUrl.pathname.startsWith("/.well-known/")) return NextResponse.next();
  if (!clerkAuthConfigured()) return NextResponse.next();
  return withClerk(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
