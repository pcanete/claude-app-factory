/**
 * El tablero del trabajo: qué dice la bitácora de cómo rinde cada proceso.
 *
 * Sin dependencias a propósito, como `definition.ts`: `scripts/test-process-metrics.mjs`
 * prueba este mismo archivo. Lo que lee la base vive en `dashboard.ts`.
 *
 * Todo sale de los eventos que deja el motor, en este orden dentro de un caso:
 *
 *   creada → tomada → (esperando → tomada)* → (liberada → tomada)* → cerrada
 *          → [revisada | devuelta → tomada → … → cerrada] → la etapa siguiente
 *
 * De ahí se reconstruyen cuatro tiempos por etapa —en cola, trabajando, esperando y en
 * revisión—, la tasa de devolución, qué modelo de IA declaró cada cierre y cómo le fue, y
 * los motivos por los que una etapa se frena. No mira conversaciones: sólo lo que quedó.
 */

export type EventoMedido = {
  instancia: string;
  tipo: string;
  etapa: number;
  autor: string | null;
  fecha: string | Date;
  resumen?: string | null;
  receta?: unknown;
  salidas?: unknown;
};

export type CasoMedido = { id: string; titulo: string; etapa: number; estado: string; actualizado: string | Date };

export type EtapaDefinida = { orden: number; nombre: string };

export type Tiempos = { casos: number; mediana_horas: number | null; p90_horas: number | null };

export type MedidaEtapa = {
  orden: number;
  nombre: string;
  ahora: Record<string, number>;
  cola: Tiempos;
  trabajo: Tiempos;
  espera: Tiempos;
  revision: Tiempos;
  cierres: number;
  revisiones: number;
  devueltas: number;
  tasa_devolucion: number | null;
  esperas: number;
  liberaciones: number;
  modelos: Array<{ modelo: string; cierres: number; aprobadas: number; devueltas: number; sin_revision: number; pendientes: number }>;
  motivos: Array<{ tipo: "esperando" | "devuelta" | "liberada"; fecha: string; texto: string }>;
};

export type MedidaPersona = { persona: string; cierres: number; devueltas: number; tasa_devolucion: number | null };

export type Detenido = { caso: string; titulo: string; etapa: number; estado: string; dias: number };

export type Tablero = {
  casos: number;
  entregados: number;
  ciclo: Tiempos;
  etapas: MedidaEtapa[];
  personas: MedidaPersona[];
  detenidos: Detenido[];
  traba: { orden: number; nombre: string; motivo: string } | null;
};

const ACTIVOS = ["en_cola", "tomada", "esperando", "en_revision", "devuelta"];
const HORA = 3_600_000;
const SIN_MODELO = "sin declarar";
const ORDEN: Record<string, number> = {
  creada: 0, tomada: 1, esperando: 2, liberada: 2, cerrada: 3, revisada: 4, devuelta: 4, entregada: 5,
};

function ms(fecha: string | Date) {
  return (fecha instanceof Date ? fecha : new Date(fecha)).getTime();
}

function percentil(valores: number[], p: number) {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const posicion = (orden.length - 1) * p;
  const abajo = Math.floor(posicion);
  const arriba = Math.ceil(posicion);
  return orden[abajo] + (orden[arriba] - orden[abajo]) * (posicion - abajo);
}

function redondear(valor: number | null) {
  return valor === null ? null : Math.round(valor * 10) / 10;
}

function tiempos(porCaso: Map<string, number>): Tiempos {
  const horas = [...porCaso.values()].map((valor) => valor / HORA);
  return { casos: horas.length, mediana_horas: redondear(percentil(horas, 0.5)), p90_horas: redondear(percentil(horas, 0.9)) };
}

function sumar(mapa: Map<string, number>, clave: string, valor: number) {
  if (valor >= 0) mapa.set(clave, (mapa.get(clave) ?? 0) + valor);
}

function texto(valor: unknown) {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return Boolean(valor) && typeof valor === "object" && !Array.isArray(valor);
}

/** El modelo que declaró la receta, agrupado sin distinguir mayúsculas ni espacios de más. */
export function modeloDe(receta: unknown) {
  const modelo = esObjeto(receta) ? texto(receta.modelo) : null;
  return modelo ? modelo.replace(/\s+/g, " ").toLowerCase() : SIN_MODELO;
}

function motivoDe(evento: EventoMedido) {
  if (evento.tipo === "devuelta" && esObjeto(evento.salidas)) {
    const motivo = texto(evento.salidas.motivo);
    if (motivo) return motivo;
  }
  const resumen = texto(evento.resumen) ?? "";
  return resumen.replace(/^Devuelta:\s*/, "");
}

type Acumulador = {
  cola: Map<string, number>;
  trabajo: Map<string, number>;
  espera: Map<string, number>;
  revision: Map<string, number>;
  cierres: number;
  revisiones: number;
  devueltas: number;
  esperas: number;
  liberaciones: number;
  modelos: Map<string, { cierres: number; aprobadas: number; devueltas: number; sin_revision: number; pendientes: number }>;
  motivos: Array<{ tipo: "esperando" | "devuelta" | "liberada"; fecha: string; texto: string }>;
};

function nuevoAcumulador(): Acumulador {
  return {
    cola: new Map(), trabajo: new Map(), espera: new Map(), revision: new Map(),
    cierres: 0, revisiones: 0, devueltas: 0, esperas: 0, liberaciones: 0,
    modelos: new Map(), motivos: [],
  };
}

/**
 * Mide un proceso. `ahora` se recibe para que el resultado no dependa del reloj de quien
 * prueba. La tabla por persona sale siempre: quién puede verla lo decide `dashboard.ts`.
 */
export function medirProceso(entrada: {
  etapas: EtapaDefinida[];
  casos: CasoMedido[];
  eventos: EventoMedido[];
  ahora: string | Date;
  detenidoDias?: number;
  motivosPorEtapa?: number;
}): Tablero {
  const { etapas, casos, ahora } = entrada;
  const detenidoDias = entrada.detenidoDias ?? 3;
  const motivosPorEtapa = entrada.motivosPorEtapa ?? 5;
  const acumuladores = new Map<number, Acumulador>(etapas.map((etapa) => [etapa.orden, nuevoAcumulador()]));
  const acumulador = (orden: number) => {
    if (!acumuladores.has(orden)) acumuladores.set(orden, nuevoAcumulador());
    return acumuladores.get(orden)!;
  };
  const personas = new Map<string, { cierres: number; devueltas: number }>();
  const ciclo = new Map<string, number>();

  const porCaso = new Map<string, EventoMedido[]>();
  for (const evento of entrada.eventos) {
    const lista = porCaso.get(evento.instancia) ?? [];
    lista.push(evento);
    porCaso.set(evento.instancia, lista);
  }

  for (const [caso, lista] of porCaso) {
    // El cierre y la entrega se escriben en la misma transacción, y PostgreSQL les da la
    // misma hora: a igual hora manda el orden en que el motor los escribe.
    lista.sort((a, b) => ms(a.fecha) - ms(b.fecha) || (ORDEN[a.tipo] ?? 9) - (ORDEN[b.tipo] ?? 9));
    let colaDesde: number | null = null;
    let trabajoDesde: number | null = null;
    let esperaDesde: number | null = null;
    let revisionDesde: number | null = null;
    let creadoEn: number | null = null;
    // El último cierre de cada etapa: a quién y a qué modelo se le atribuye su revisión.
    const cierreAbierto = new Map<number, { autor: string | null; modelo: string }>();

    for (const evento of lista) {
      const t = ms(evento.fecha);
      const etapa = Number(evento.etapa);
      const clave = `${caso}:${etapa}`;
      const a = acumulador(etapa);
      switch (evento.tipo) {
        case "creada":
          creadoEn = t;
          colaDesde = t;
          break;
        case "tomada":
          if (esperaDesde !== null) sumar(a.espera, clave, t - esperaDesde);
          else if (colaDesde !== null) sumar(a.cola, clave, t - colaDesde);
          colaDesde = null;
          esperaDesde = null;
          trabajoDesde = t;
          break;
        case "esperando":
          if (trabajoDesde !== null) sumar(a.trabajo, clave, t - trabajoDesde);
          trabajoDesde = null;
          esperaDesde = t;
          a.esperas += 1;
          a.motivos.push({ tipo: "esperando", fecha: new Date(t).toISOString(), texto: motivoDe(evento) });
          break;
        case "liberada":
          if (trabajoDesde !== null) sumar(a.trabajo, clave, t - trabajoDesde);
          trabajoDesde = null;
          colaDesde = t;
          a.liberaciones += 1;
          a.motivos.push({ tipo: "liberada", fecha: new Date(t).toISOString(), texto: motivoDe(evento) });
          break;
        case "cerrada": {
          if (trabajoDesde !== null) sumar(a.trabajo, clave, t - trabajoDesde);
          trabajoDesde = null;
          a.cierres += 1;
          const modelo = modeloDe(evento.receta);
          const fila = a.modelos.get(modelo) ?? { cierres: 0, aprobadas: 0, devueltas: 0, sin_revision: 0, pendientes: 0 };
          fila.cierres += 1;
          a.modelos.set(modelo, fila);
          // Si un cierre anterior de la etapa quedó sin revisar, la etapa no tenía revisión.
          const previo = cierreAbierto.get(etapa);
          if (previo) a.modelos.get(previo.modelo)!.sin_revision += 1;
          cierreAbierto.set(etapa, { autor: evento.autor, modelo });
          if (evento.autor) {
            const persona = personas.get(evento.autor) ?? { cierres: 0, devueltas: 0 };
            persona.cierres += 1;
            personas.set(evento.autor, persona);
          }
          revisionDesde = t;
          colaDesde = t; // si la etapa no lleva revisión, desde acá espera la siguiente
          break;
        }
        case "revisada":
        case "devuelta": {
          if (revisionDesde !== null) sumar(a.revision, clave, t - revisionDesde);
          revisionDesde = null;
          a.revisiones += 1;
          const cierre = cierreAbierto.get(etapa);
          cierreAbierto.delete(etapa);
          const fila = cierre ? a.modelos.get(cierre.modelo) : undefined;
          if (evento.tipo === "revisada") {
            if (fila) fila.aprobadas += 1;
            colaDesde = t;
          } else {
            a.devueltas += 1;
            if (fila) fila.devueltas += 1;
            if (cierre?.autor) personas.get(cierre.autor)!.devueltas += 1;
            a.motivos.push({ tipo: "devuelta", fecha: new Date(t).toISOString(), texto: motivoDe(evento) });
            // Vuelve a quien la cerró: lo que tarde en retomarla es espera, no cola.
            colaDesde = null;
            esperaDesde = t;
          }
          break;
        }
        case "entregada":
          if (creadoEn !== null) sumar(ciclo, caso, t - creadoEn);
          // Entregar sin pasar por revisión: el último cierre no la llevaba.
          for (const [orden, cierre] of cierreAbierto) acumulador(orden).modelos.get(cierre.modelo)!.sin_revision += 1;
          cierreAbierto.clear();
          colaDesde = null;
          revisionDesde = null;
          break;
        default:
          break;
      }
      // Un cierre seguido de un evento de otra etapa es un cierre que no llevaba revisión.
      if (evento.tipo !== "cerrada") {
        for (const [orden, cierre] of cierreAbierto) {
          if (orden !== etapa) {
            acumulador(orden).modelos.get(cierre.modelo)!.sin_revision += 1;
            cierreAbierto.delete(orden);
          }
        }
      }
    }
    // Lo que quedó abierto al final: con revisión pendiente o todavía sin saberse.
    for (const [orden, cierre] of cierreAbierto) acumulador(orden).modelos.get(cierre.modelo)!.pendientes += 1;
  }

  const ahoraMs = ms(ahora);
  const detenidos: Detenido[] = casos
    .filter((caso) => ["esperando", "devuelta", "en_cola", "en_revision"].includes(caso.estado))
    .map((caso) => ({
      caso: caso.id,
      titulo: caso.titulo,
      etapa: Number(caso.etapa),
      estado: caso.estado,
      dias: Math.floor((ahoraMs - ms(caso.actualizado)) / (24 * HORA)),
    }))
    .filter((caso) => caso.dias >= detenidoDias)
    .sort((a, b) => b.dias - a.dias);

  const nombres = new Map(etapas.map((etapa) => [etapa.orden, etapa.nombre]));
  const medidas: MedidaEtapa[] = [...acumuladores.entries()]
    .sort(([a], [b]) => a - b)
    .map(([orden, a]) => {
      const ahoraEtapa: Record<string, number> = {};
      for (const caso of casos) {
        if (Number(caso.etapa) === orden && ACTIVOS.includes(caso.estado)) {
          ahoraEtapa[caso.estado] = (ahoraEtapa[caso.estado] ?? 0) + 1;
        }
      }
      return {
        orden,
        nombre: nombres.get(orden) ?? `Etapa ${orden}`,
        ahora: ahoraEtapa,
        cola: tiempos(a.cola),
        trabajo: tiempos(a.trabajo),
        espera: tiempos(a.espera),
        revision: tiempos(a.revision),
        cierres: a.cierres,
        revisiones: a.revisiones,
        devueltas: a.devueltas,
        tasa_devolucion: a.revisiones ? Math.round((a.devueltas / a.revisiones) * 100) / 100 : null,
        esperas: a.esperas,
        liberaciones: a.liberaciones,
        modelos: [...a.modelos.entries()]
          .map(([modelo, fila]) => ({ modelo, ...fila }))
          .sort((x, y) => y.cierres - x.cierres),
        motivos: a.motivos.sort((x, y) => (x.fecha < y.fecha ? 1 : -1)).slice(0, motivosPorEtapa),
      };
    });

  // La traba: la etapa que más frena por caso que pasó por ella, contando esperas,
  // devoluciones y liberaciones. Con un solo evento no alcanza para decir que se traba.
  let traba: Tablero["traba"] = null;
  let peor = 0;
  for (const medida of medidas) {
    const pasaron = Math.max(medida.cierres, medida.trabajo.casos, 1);
    const frenos = medida.esperas + medida.devueltas + medida.liberaciones;
    const indice = frenos / pasaron;
    if (frenos >= 2 && indice > peor) {
      peor = indice;
      const motivo = medida.devueltas >= medida.esperas && medida.devueltas >= medida.liberaciones
        ? "devoluciones"
        : medida.esperas >= medida.liberaciones ? "esperas" : "liberaciones";
      traba = { orden: medida.orden, nombre: medida.nombre, motivo };
    }
  }

  return {
    casos: casos.length,
    entregados: casos.filter((caso) => caso.estado === "entregada").length,
    ciclo: tiempos(ciclo),
    etapas: medidas,
    personas: [...personas.entries()]
      .map(([persona, fila]) => ({
        persona,
        cierres: fila.cierres,
        devueltas: fila.devueltas,
        tasa_devolucion: fila.cierres ? Math.round((fila.devueltas / fila.cierres) * 100) / 100 : null,
      }))
      .sort((a, b) => b.cierres - a.cierres),
    detenidos,
    traba,
  };
}
