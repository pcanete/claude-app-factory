export function localPreviewAuthEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_UNSAFE_LOCAL_PREVIEW === "true";
}

export function assertLocalPreviewAuthEnabled() {
  if (!localPreviewAuthEnabled()) {
    throw new Error(
      "Acceso local deshabilitado: ALLOW_UNSAFE_LOCAL_PREVIEW=true sólo se acepta fuera de producción.",
    );
  }
}
