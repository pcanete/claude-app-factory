import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkAuthConfigured } from "@/features/auth/config";

const withClerk = clerkMiddleware();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!clerkAuthConfigured()) return NextResponse.next();
  return withClerk(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
