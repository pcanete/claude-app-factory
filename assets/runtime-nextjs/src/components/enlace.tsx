import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * Un enlace interno sin precarga.
 *
 * Next precarga cada enlace que aparece en pantalla, y en esta aplicación casi todas las
 * páginas son dinámicas: precargar es renderizarlas en el servidor, con sus consultas,
 * aunque nadie haga clic. Con el menú lateral eran una docena de páginas por visita; una
 * tabla de 50 registros sumaba 50 más. En un plan con límite de duración de funciones eso
 * agotó la cuota y la aplicación quedó fuera de servicio.
 *
 * Se usa siempre este componente en lugar de `next/link`: `scripts/test-sin-precarga.mjs`
 * falla si algún archivo vuelve a importar `next/link` directamente. Quien de verdad
 * necesite precargar un destino puede pasar `prefetch` explícito.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
