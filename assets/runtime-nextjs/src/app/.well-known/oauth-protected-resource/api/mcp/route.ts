import { metadataCorsOptionsRequestHandler, protectedResourceHandlerClerk } from "@clerk/mcp-tools/next";

/**
 * Qué protege este recurso y con qué alcances.
 *
 * La ruta refleja la del endpoint que describe (`/api/mcp`), como pide RFC 9728: el
 * cliente la deriva de la URL del servidor, no la adivina.
 *
 * Los alcances pedidos son mínimos a propósito. Lo que un usuario puede hacer no sale
 * de acá sino de su rol en `app_user`: Clerk sólo prueba quién es.
 */
const metadata = protectedResourceHandlerClerk({ scopes_supported: ["profile", "email"] });
const cors = metadataCorsOptionsRequestHandler();

export function GET(request: Request) {
  return metadata(request);
}

export function OPTIONS() {
  return cors();
}
