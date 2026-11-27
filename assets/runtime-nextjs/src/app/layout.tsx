import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { clerkAuthConfigured } from "@/platform/auth/config";
import { runtimeSpec } from "@/lib/spec";
import { variablesDeTema } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: runtimeSpec.app.name,
  description: runtimeSpec.app.description,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // El color principal sale del AppSpec en cada pedido, no al generar la aplicación: así
  // sobrevive a las actualizaciones de plataforma y cambia con el AppSpec. `variablesDeTema`
  // sólo deja pasar colores #abc o #aabbcc, así que nada más llega a la hoja de estilos.
  const tema = variablesDeTema(runtimeSpec.app.theme);
  // `html:root` pesa más que el `:root` de globals.css: gana aunque la hoja se cargue después.
  const css = `html:root{${Object.entries(tema).map(([clave, valor]) => `${clave}:${valor}`).join(";")}}`;
  const application = (
    <html lang={runtimeSpec.app.locale?.split("-")[0] ?? "es"}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
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
