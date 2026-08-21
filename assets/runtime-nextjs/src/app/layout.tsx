import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { clerkAuthConfigured } from "@/features/auth/config";
import { runtimeSpec } from "@/lib/spec";
import "./globals.css";

export const metadata: Metadata = {
  title: runtimeSpec.app.name,
  description: runtimeSpec.app.description,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const application = (
    <html lang={runtimeSpec.app.locale?.split("-")[0] ?? "es"}>
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
  return clerkAuthConfigured() ? <ClerkProvider dynamic>{application}</ClerkProvider> : application;
}
