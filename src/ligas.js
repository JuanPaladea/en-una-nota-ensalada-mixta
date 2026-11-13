// Ligas privadas: un ranking entre amigos.
//
// Alguien crea la liga, pasa el link (?liga=CÓDIGO) y los demás se suman con
// su cuenta de Google. No se juega distinto: es el mismo ranking de siempre
// (y el del desafío del día) mostrando solo a los de la liga. Hace falta
// cuenta, porque el ranking es de cuentas.
import { api, apiSuave } from "./api.js";
import { esc, load } from "./utils.js";
import { track } from "./analytics.js";

const LS_PENDIENTE = "eun_liga_pendiente_v1";   // el código de un link abierto sin sesión: se suma al entrar
export const LINK_LIGA = "https://enunanota.com.ar/?liga=";

let ligas = null;      // cache: [{ id, codigo, nombre, miembros, es_creador }]
export function olvidarLigas(){ ligas = null; }
export async function misLigas(){
  if(!ligas) ligas = await apiSuave("/ligas", undefined, []);
  return ligas || [];
}
export const ligasEnMemoria = ()=> ligas || [];

// Devuelve el código de la liga nueva, o null
export async function crearLiga(nombre){
  const r = await apiSuave("/ligas/crear", { nombre });
  if(r && r.codigo){ olvidarLigas(); track("liga", { accion: "crear" }); return r.codigo; }
  return null;
}
// Devuelve { liga, nombre } (liga null si el código no existe o no hay lugar)
export async function unirseALiga(codigo){
  const r = await api("/ligas/unirse", { codigo: String(codigo).trim() });
  if(r && r.liga){ olvidarLigas(); track("liga", { accion: "unirse" }); }
  return r;
}
export async function salirDeLiga(id){
  const ok = await apiSuave("/ligas/salir", { liga: id }, false);
  if(ok){ olvidarLigas(); track("liga", { accion: "salir" }); }
  return ok;
}

/* ---- El link de invitación ----
   ?liga=CÓDIGO se guarda y se saca de la barra. Si ya hay sesión se suma
   enseguida; si no, cuando entre. */
export function codigoDelLink(){
  const q = new URLSearchParams(location.search);
  const c = (q.get("liga") || "").trim().toUpperCase();
  if(!q.has("liga")) return;
  q.delete("liga");
  const resto = q.toString();
  history.replaceState(history.state, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
  if(/^[A-Z0-9]{6}$/.test(c)){ try{ localStorage.setItem(LS_PENDIENTE, JSON.stringify(c)); }catch(_){} }
}
export const ligaPendiente = ()=> load(LS_PENDIENTE, null);
// Con sesión: se suma a la liga del link, si había uno. Devuelve { liga, nombre } o null.
export async function sumarPendiente(){
  const c = ligaPendiente();
  if(!c) return null;
  try{
    const r = await unirseALiga(c);
    localStorage.removeItem(LS_PENDIENTE);
    return r && r.liga ? r : null;
  }catch(_){ return null; }   // sin red: queda para la próxima
}

/* ---- Mi cuenta ---- */
// La lista de ligas con su código, más crear una o sumarse con un código.
// Los formularios llaman a ligaCrear / ligaUnirse / ligaSalir / ligaCompartir
// (los expone cuenta.js).
export function ligasHtml(lista){
  const filas = lista.map((l, i)=> `<div class="list-row liga-row" style="--i:${i}">
      <button type="button" class="liga-ver" onclick="verRankingDeLiga('${l.id}')">
        <span>${esc(l.nombre)}<small>${l.miembros === 1 ? "Solo vos por ahora" : l.miembros + " jugadores"} · código ${l.codigo}</small></span>
      </button>
      <button type="button" class="act" onclick="ligaCompartir('${l.codigo}', this)">Invitar</button>
      <button type="button" class="x" title="Salir de la liga" aria-label="Salir de ${esc(l.nombre)}" onclick="ligaSalir('${l.id}')">✕</button>
    </div>`).join("");
  return `<div class="lbl">Mis ligas <span class="lbl-info">un ranking entre amigos</span></div>
    <div class="list ligas">
      ${filas || `<p class="hint liga-vacia">Armá una liga, pasale el link a tus amigos y compitan entre ustedes en el ranking y en el desafío del día.</p>`}
      <form class="liga-form" onsubmit="ligaCrear(event)">
        <input type="text" name="nombre" maxlength="40" placeholder="Nombre de la liga nueva" aria-label="Nombre de la liga nueva" required>
        <button type="submit" class="btn cyan mini">Crear</button>
      </form>
      <form class="liga-form" onsubmit="ligaUnirse(event)">
        <input type="text" name="codigo" maxlength="6" placeholder="¿Te pasaron un código?" aria-label="Código de una liga" autocapitalize="characters" autocomplete="off" required>
        <button type="submit" class="btn ghost mini">Sumarme</button>
      </form>
    </div>`;
}
