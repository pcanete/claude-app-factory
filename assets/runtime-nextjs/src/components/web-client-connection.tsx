"use client";

import { useState } from "react";

/**
 * Los datos para conectar un cliente web (ChatGPT, claude.ai) por OAuth.
 *
 * Existe porque el asistente de credenciales resuelve el otro camino —el token que se
 * pega en una terminal— y dejaba afuera justo el que usa la mayoría de la gente. Un
 * cliente web pide un identificador de cliente OAuth y, si ese dato no está en ninguna
 * pantalla, la única forma de conseguirlo es pedírselo a quien administra el sistema.
 * Eso convierte cada alta en un trámite.
 *
 * Por OAuth no se entra como agente sino como persona: la identidad la pone el ingreso
 * de cada empleado y los permisos salen de su rol. Por eso este bloque no depende de
 * ninguna credencial y se ve sin crear nada.
 *
 * El identificador de cliente **no es un secreto**: viaja en la barra de direcciones de
 * cada autorización. Lo que protege la conexión es que el cliente sea público con PKCE
 * y que la URL de devolución esté registrada; publicarlo acá no baja ninguna defensa.
 */
export function WebClientConnection({ endpoint, clientId }: { endpoint: string; clientId: string | null }) {
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(valor: string, clave: string) {
    await navigator.clipboard.writeText(valor);
    setCopiado(clave);
    window.setTimeout(() => setCopiado(null), 1800);
  }

  const filas = [
    { clave: "url", etiqueta: "URL del servidor", valor: endpoint },
    { clave: "cliente", etiqueta: "ID de cliente de OAuth", valor: clientId ?? "" },
    { clave: "auth", etiqueta: "Autenticación del token", valor: "none" },
  ];

  return (
    <div className="form-card">
      {clientId ? (
        <>
          <p className="subtitle">
            Para ChatGPT, claude.ai o cualquier cliente que pida iniciar sesión en vez de una
            credencial. Cada persona entra con su propia cuenta: estos tres datos son los mismos
            para todo el equipo y se pueden compartir.
          </p>
          <dl className="connection-facts">
            {filas.map((fila) => (
              <div key={fila.clave}>
                <dt>{fila.etiqueta}</dt>
                <dd>
                  <code>{fila.valor}</code>
                  <button className="button ghost" onClick={() => copiar(fila.valor, fila.clave)} type="button">
                    {copiado === fila.clave ? "Copiado" : "Copiar"}
                  </button>
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-help">
            El secreto de cliente se deja vacío: es un cliente público con PKCE. Si el cliente
            pregunta por &quot;registro dinámico&quot;, elegí usar tu propio identificador.
          </p>
        </>
      ) : (
        // Sin la variable configurada, decir qué falta y a quién le toca es más útil que
        // mostrar un campo vacío que parece un error de la aplicación.
        <>
          <p className="subtitle">
            Todavía no se puede conectar un cliente web. Falta registrar la aplicación OAuth y
            cargar su identificador en la variable de entorno <code>MCP_OAUTH_CLIENT_ID</code> del
            despliegue.
          </p>
          <p className="field-help">
            En el proveedor de identidad hay que crear una aplicación OAuth <strong>pública</strong>
            {" "}(sin secreto, con PKCE) y registrar como URL de devolución la que indique cada
            cliente. Después de cargar la variable hay que volver a desplegar: se lee al arrancar.
          </p>
        </>
      )}
    </div>
  );
}
