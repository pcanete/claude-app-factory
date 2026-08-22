import { authServerMetadataHandlerClerk, metadataCorsOptionsRequestHandler } from "@clerk/mcp-tools/next";

/**
 * Dónde autenticarse.
 *
 * Un cliente remoto —Claude en el navegador, por ejemplo— no puede recibir un token
 * pegado a mano: llega sin credencial, recibe un 401 y necesita que el servidor le
 * diga dónde conseguir una. Estos metadatos son esa respuesta, y apuntan a Clerk,
 * que ya es el proveedor de identidad de la aplicación.
 *
 * El token propio de agente (`factory_mcp_…`) sigue funcionando en paralelo: es para
 * procesos sin humano detrás, que no pueden pasar por una pantalla de consentimiento.
 */
const metadata = authServerMetadataHandlerClerk();
const cors = metadataCorsOptionsRequestHandler();

export async function GET() {
  return metadata();
}

export function OPTIONS() {
  return cors();
}
