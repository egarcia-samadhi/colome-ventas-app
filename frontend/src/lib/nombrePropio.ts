/**
 * Normalización de datos SOLO EN EXPOSICIÓN (2026-08-28, pedido explícito de
 * Ezequiel — ver 00-Normas-de-Trabajo.md, sección "4.quinquies"). El ERP y
 * los catálogos cargados a mano traen texto con capitalización inconsistente
 * (todo mayúsculas, todo minúsculas, mezclado); esto lo formatea a "Nombre
 * Propio" para mostrar en pantalla. NUNCA escribir el resultado de vuelta a
 * la base -- los valores crudos son también claves de matcheo (joins contra
 * el ERP, diccionarios de mapeo por texto exacto).
 */

// Siglas legales y acrónimos que un Title Case ingenuo rompería
// ("S.A." -> "S.a.", "USA" -> "Usa") -- se comparan en mayúsculas, sin
// puntuación, contra cada palabra/token.
const ACRONIMOS = new Set([
  "SA", "SRL", "SL", "SAS", "LTD", "INC", "LLC", "CORP", "SPA", "CO",
  "USA", "UE", "UK", "IVA", "ID", "SBDAPROV",
]);

// Conectores que quedan en minúscula salvo que sean la primera palabra.
const CONECTORES = new Set(["de", "del", "la", "las", "los", "y", "en", "con", "a", "el"]);

function formatearToken(token: string): string {
  if (!token) return token;
  // Tokens con puntos internos (ej. "S.A.", "S.R.L.") se procesan segmento
  // por segmento para no romper la sigla.
  if (token.includes(".")) {
    return token
      .split(".")
      .map((seg, i, arr) => (seg || i === arr.length - 1 ? formatearToken(seg) : ""))
      .join(".");
  }
  // Mismo criterio para "&" (ej. "J&C" en una razón social) -- sin esto,
  // "J&C" pasaba entero por el fallback de abajo y daba "J&c".
  if (token.includes("&")) {
    return token.split("&").map(formatearToken).join("&");
  }
  const soloLetras = token.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ]/g, "");
  if (ACRONIMOS.has(soloLetras)) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

/** Formatea un valor a "Nombre Propio" para mostrar en pantalla. No modifica el dato original. */
export function nombrePropio(value: string | number | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (!str.trim()) return str;
  return str
    .split(" ")
    .map((palabra, i) => {
      if (!palabra) return palabra;
      const bare = palabra.toLowerCase().replace(/[^a-záéíóúñ]/g, "");
      // Un token con "." es una sigla/abreviatura (ej. "A." en "S. A. S."),
      // nunca un conector real -- si no, "a" (preposición) lo pisaba y daba
      // "S. a. S." en vez de "S. A. S.".
      if (i > 0 && !palabra.includes(".") && CONECTORES.has(bare)) return palabra.toLowerCase();
      return formatearToken(palabra);
    })
    .join(" ");
}
