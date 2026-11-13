// Partidas con las canciones fijas: el desafío del día y los duelos por link.
//
// En las dos se juega Un jugador con una lista de videos ya decidida y con
// cada canción sonando desde el mismo segundo para todos; lo demás (escribir el
// título, los puntos, los cuadritos) es el juego de siempre. Acá están los
// datos y lo que se muestra; la partida en sí la lleva main.js.
//
//   Desafío del día: las mismas 10 canciones para todos, una chance por día.
//     Las sortea la base (GET /api/desafio) y tiene su propio ranking.
//   Duelo: las canciones de una partida que alguien acaba de jugar, para que
//     otro juegue lo mismo desde un link (?duelo=…) y se comparen.
import { api, apiSuave } from "./api.js";
import { load, save, esc } from "./utils.js";
import { cancionDeVideo, rachas } from "./logros.js";
import { songKey } from "./utils.js";

const LS_DESAFIO = "eun_desafio_v1";   // { "2026-11-13": { puntos, segundos } } de este navegador
const LS_DUELOS = "eun_duelos_v1";     // { idDelDuelo: { partida, puntos } } los que ya se jugaron acá
const LS_NOMBRE = "eun_nombre_v1";     // el nombre para los duelos sin cuenta
const DIAS_GUARDADOS = 90;
export const LINK_DUELO = "https://enunanota.com.ar/?duelo=";

/* ============================================================
   LA LISTA DE CANCIONES
   ============================================================ */
// Arma la partida con los videos que este navegador conoce (si el catálogo de
// la página está más viejo que el de la base, alguno puede faltar).
// total: cuántas se juegan · las que sobran quedan de suplentes, por si YouTube
// no pasa alguna.
export function armarFija(tipo, videos, inicios, total, extra = {}){
  const todas = [];
  videos.forEach((v, i)=>{
    const c = cancionDeVideo(v);
    if(c) todas.push({ ...c, id: c.yt, key: songKey(c.gid, c.t), inicio: inicios[i] });
  });
  const n = Math.min(total, todas.length);
  return { tipo, total: n, canciones: todas.slice(0, n), suplentes: todas.slice(n), ...extra };
}

/* ============================================================
   DESAFÍO DEL DÍA
   ============================================================ */
let desafio = null, pedidoEn = 0;
const FRESCO_MS = 60 * 1000;

// { dia, videos, inicios, jugaron, mio } o null si no hay base. Se vuelve a
// pedir pasado un minuto (cambia cuánta gente lo jugó) o con forzar.
let enVuelo = null;      // el pedido en curso: el inicio se dibuja varias veces al arrancar y alcanza con uno
export function traerDesafio(forzar){
  if(desafio && !forzar && Date.now() - pedidoEn < FRESCO_MS) return Promise.resolve(desafio);
  if(enVuelo && !forzar) return enVuelo;
  const pedido = apiSuave("/desafio").then(d=>{
    if(enVuelo === pedido) enVuelo = null;
    if(d && d.dia){ desafio = d; pedidoEn = Date.now(); }
    return d && d.dia ? d : null;
  });
  enVuelo = pedido;
  return pedido;
}
export const desafioEnMemoria = ()=> desafio;
// Cambió la sesión o se guardó el desafío: "mio" ya no vale, hay que volver a pedirlo
export function olvidarDesafio(){ pedidoEn = 0; if(desafio) desafio = { ...desafio, mio: null }; }
// La fecha de hoy en la Argentina ("2026-11-13"), para dibujar la tarjeta del
// inicio antes de que responda la base. La que vale es la que manda la base.
export function diaProvisional(){
  try{
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }catch(_){
    const f = new Date();
    return f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0") + "-" + String(f.getDate()).padStart(2, "0");
  }
}

// Cómo le fue a este navegador ese día, o null si no lo jugó acá
export function desafioLocal(dia){
  const todos = load(LS_DESAFIO, {});
  return todos && todos[dia] ? todos[dia] : null;
}
export function guardarDesafioLocal(dia, puntos, segundos){
  const todos = load(LS_DESAFIO, {}) || {};
  if(todos[dia]) return;                       // vale el primer intento
  todos[dia] = { puntos, segundos };
  const dias = Object.keys(todos).sort().slice(-DIAS_GUARDADOS);
  try{ save(LS_DESAFIO, Object.fromEntries(dias.map(d=> [d, todos[d]]))); }catch(_){}
}
// Cuántos días seguidos lleva jugando el desafío (hasta hoy o hasta ayer)
export function rachaDesafio(hoy, diasDeLaCuenta = []){
  const dias = Object.keys(load(LS_DESAFIO, {}) || {}).concat(diasDeLaCuenta);
  return rachas(dias, hoy).actual;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
// "2026-11-13" → "13 nov"
export function fechaCorta(dia){
  const [, m, d] = dia.split("-").map(Number);
  return d + " " + MESES[m - 1];
}

// Los cuadritos de una partida (mismos colores que la imagen final)
export const cuadritosHtml = (segundos, chicos)=> `<span class="sqs${chicos ? " s" : ""}">${segundos.map(s=>
  `<span class="sq ${s === 0 ? "k" : s === 1 ? "g" : s <= 3 ? "y" : "o"}"></span>`).join("")}</span>`;

// La tarjeta del inicio. d: lo de traerDesafio() · racha: días seguidos.
// Sin jugar invita; ya jugado muestra cómo te fue y lleva al ranking de hoy.
export function tarjetaDesafioHtml(d, racha, conCuenta){
  if(!d) return "";
  const mio = d.mio || desafioLocal(d.dia);
  const fecha = fechaCorta(d.dia);
  if(!mio){
    const ya = d.jugaron ? ` · ya ${d.jugaron === 1 ? "lo jugó 1" : "lo jugaron " + d.jugaron}` : "";
    return `<button type="button" class="tarjeta desafio" onclick="jugarDesafio()">
        <span class="desafio-ic" aria-hidden="true">🗓️</span>
        <span class="grow">
          <span class="eyebrow">Desafío del día · ${fecha}</span>
          <span class="tarjeta-t">Las mismas 10 canciones para todos</span>
          <span class="tarjeta-d">Una sola chance${ya}${racha > 1 ? " · llevás " + racha + " días seguidos" : ""}</span>
        </span>
        <span class="play-dot" aria-hidden="true">▶</span>
      </button>`;
  }
  // Sin "mio" se jugó en este navegador pero no quedó en ninguna cuenta
  const puesto = d.mio ? `#${d.mio.puesto} de ${d.jugaron}` : conCuenta ? "Lo jugaste sin tu cuenta" : "Entrá para ver tu puesto";
  return `<button type="button" class="tarjeta desafio hecho" onclick="verRanking(10, '', 'hoy', 'inicio')">
      <span class="grow">
        <span class="eyebrow">Desafío del día · ${fecha}</span>
        <span class="tarjeta-t">Hiciste ${mio.puntos} ${mio.puntos === 1 ? "punto" : "puntos"}</span>
        ${cuadritosHtml(mio.segundos, true)}
        <span class="tarjeta-d">${puesto}${racha > 1 ? " · " + racha + " días seguidos 🔥" : ""} · mañana hay otro</span>
      </span>
      <span class="pill amber">Ranking ›</span>
    </button>`;
}

/* ============================================================
   DUELOS
   ============================================================ */
// { id, canciones, modo, videos, inicios, resultados:[{ nombre, puntos, segundos, es_mio }] } o null
export function traerDuelo(id){
  const mio = dueloLocal(id);
  return apiSuave("/duelo?id=" + encodeURIComponent(id) + (mio && mio.partida ? "&partida=" + mio.partida : ""));
}
// Arma el duelo con la partida recién jugada. Devuelve el id o null.
export async function crearDuelo(partida, inicios, nombre){
  const r = await apiSuave("/duelo/crear", { partida, inicios, nombre });
  return r && r.id ? r.id : null;
}
// Anota el resultado y devuelve el duelo con la tabla (null si no se pudo)
export async function anotarDuelo(id, partida, puntos, nombre){
  const d = await api("/duelo/anotar", { partida, nombre });
  if(d) recordarDuelo(id, partida, puntos);
  return d;
}

// Los duelos que ya se jugaron en este navegador: no se juegan dos veces
export function dueloLocal(id){
  const todos = load(LS_DUELOS, {});
  return todos && todos[id] ? todos[id] : null;
}
export function recordarDuelo(id, partida, puntos){
  const todos = load(LS_DUELOS, {}) || {};
  todos[id] = { partida, puntos, cuando: Date.now() };
  const ids = Object.keys(todos).sort((a, b)=> todos[a].cuando - todos[b].cuando).slice(-100);
  try{ save(LS_DUELOS, Object.fromEntries(ids.map(k=> [k, todos[k]]))); }catch(_){}
}

// El nombre con el que alguien sin cuenta aparece en un duelo. Se pide una vez.
export function nombreParaDuelo(){
  let n = String(load(LS_NOMBRE, "") || "").trim();
  if(n) return n;
  n = (prompt("¿Con qué nombre aparecés en el duelo?") || "").replace(/\s+/g, " ").trim().slice(0, 30);
  if(n){ try{ save(LS_NOMBRE, n); }catch(_){} }
  return n;
}

// El que armó el duelo es el primero que lo jugó: su fila es la más vieja,
// que es la única que hay hasta que alguien lo responde. Para el título
// alcanza con el de más arriba que no sea uno mismo.
export function rivalDe(duelo){
  return (duelo.resultados || []).find(r=> !r.es_mio) || null;
}

// La tabla del duelo. Las filas entran escalonadas (extras.css).
export function tablaDueloHtml(duelo){
  const filas = duelo.resultados || [];
  if(!filas.length) return "";
  return `<div class="duelo-tabla">${filas.map((f, i)=> `<div class="duelo-row ${f.es_mio ? "mio" : ""}" style="--i:${i}">
      <span class="pos">${i + 1}</span>
      <span class="nom">${esc(f.nombre)}${f.es_mio ? " <small>(vos)</small>" : ""}${cuadritosHtml(f.segundos, true)}</span>
      <span class="pt">${f.puntos}</span>
    </div>`).join("")}</div>`;
}

// "Le ganaste a Ana por 12", "Ana te ganó por 5", "Empataron"
export function veredicto(duelo){
  const mio = (duelo.resultados || []).find(r=> r.es_mio);
  const otros = (duelo.resultados || []).filter(r=> !r.es_mio);
  if(!mio || !otros.length) return { txt: "", gano: false };
  const mejor = otros[0];          // vienen ordenados: el mejor de los demás
  const dif = mio.puntos - mejor.puntos;
  if(dif > 0) return { txt: otros.length > 1 ? `¡Les ganaste a todos! ${esc(mejor.nombre)} quedó a ${dif}` : `¡Le ganaste a ${esc(mejor.nombre)} por ${dif}!`, gano: true };
  if(dif === 0) return { txt: `Empataste con ${esc(mejor.nombre)}`, gano: false };
  return { txt: `${esc(mejor.nombre)} te ganó por ${-dif}`, gano: false };
}
