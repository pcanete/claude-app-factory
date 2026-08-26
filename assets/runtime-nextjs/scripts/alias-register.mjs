/**
 * Engancha `alias-loader.mjs` en el proceso.
 *
 * Va aparte porque `module.register` corre en el hilo principal y el resolvedor en el de
 * carga: son dos módulos por diseño de Node, no por gusto. Se usa como
 * `node --import ./scripts/alias-register.mjs <script>`.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(import.meta.filename));
