// Cuentas con Google y ranking del modo un jugador.
//
// Entrar es opcional: sin cuenta se juega igual que siempre. Con cuenta, cada
// partida de un jugador se guarda (el historial) y el mejor puntaje de cada uno
// con 10 canciones entra al ranking — 40 puntos en 5 canciones no se comparan
// con 40 en 20, así que hay una sola tabla —, que se mira por período: la
// semana (desde el viernes), el mes (desde el 1) o de siempre.
//
// Todo pasa por /api (netlify/functions/api.mjs): verifica el token de Google,
// lleva la sesión en una cookie y habla con la base (db/esquema.sql). Esta
// página nunca ve la clave de la base.
import { esc } from "./utils.js";
import { soloTramo } from "./sharecard.js";
import { track, propiedadesUsuario, usuarioAnalytics } from "./analytics.js";
import { contarVideos, favoritosHtml } from "./favoritos.js";

export const cuentasActivas = true;
// El ID de cliente OAuth de Google Cloud, el mismo que usa la función de /api.
// También es público. Vacío, se entra solo por redirección.
const GOOGLE_CLIENT_ID = "790742708415-p6r2dinuf89fa51ket66imcct7vd02db.apps.googleusercontent.com";

const LS_SESION = "eun_sesion_v1";             // "1" si acá hubo una sesión abierta (la cookie de verdad no se lee desde la página)
const LS_PENDIENTE = "eun_partida_pendiente_v1";
const PENDIENTE_VENCE_MS = 60 * 60 * 1000;    // una partida sin guardar de hace más de una hora ya no va
const OPCIONES_CANCIONES = [5, 10, 15, 20, 30, 0];  // las mismas que el select de Opciones; 0 = sin límite
export const RANKING_CANCIONES = 10;   // el ranking es solo el de partidas de 10 canciones
const LIMITE_RANKING = 20;
// Los de ranking_solo(): la semana arranca el viernes y el mes el 1, a las 0 h de Argentina
const PERIODOS = [
  { id: "semana",  boton: "Semana",    titulo: "semanal",   cuando: "esta semana" },
  { id: "mes",     boton: "Mes",       titulo: "mensual",   cuando: "este mes" },
  { id: "siempre", boton: "Histórico", titulo: "histórico", cuando: "" },
];
const periodo = (id)=> PERIODOS.find(p=> p.id === id) || PERIODOS[2];

let usuario = null;          // { id, nombre } con la sesión abierta
let partidaFinal = null;     // { id, canciones } de la partida que se acaba de terminar, si entra al ranking
let periodoVisto = "semana";
let mostrar = ()=>{};        // show() de main.js

// Una llamada a la API. Sin cuerpo es un GET; con cuerpo, un POST de JSON.
// Cualquier respuesta que no sea 2xx tira un error con su .status; si no hubo
// respuesta (sin red, o pasaron los 12 segundos) el error va sin .status.
const API_ESPERA_MS = 12000;
async function api(ruta, cuerpo){
  const corte = new AbortController();
  const reloj = setTimeout(()=> corte.abort(), API_ESPERA_MS);
  try{
    const r = await fetch("/api" + ruta, cuerpo === undefined
      ? { credentials: "same-origin", signal: corte.signal }
      : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo), signal: corte.signal });
    if(!r.ok) throw Object.assign(new Error(ruta + ": " + r.status), { status: r.status });
    return await r.json();
  }finally{ clearTimeout(reloj); }
}
// Lo mismo, pero si se cortó la red o el servidor falló (5xx) prueba dos veces
// más. Solo para lo que se puede repetir sin cambiar nada (ver solo_sonar y
// solo_resolver en db/esquema.sql: el mismo paso dos veces vale por uno).
const espera = (ms)=> new Promise(ok=> setTimeout(ok, ms));
async function apiInsistente(ruta, cuerpo){
  for(let intento = 0; ; intento++){
    try{ return await api(ruta, cuerpo); }
    catch(e){
      if(intento >= 2 || (e.status && e.status < 500)) throw e;
      await espera(700 * (intento + 1));
    }
  }
}
function haySesionGuardada(){
  try{ return Boolean(localStorage.getItem(LS_SESION)); }catch(_){ return false; }
}
function recordarSesion(hay){
  try{ hay ? localStorage.setItem(LS_SESION, "1") : localStorage.removeItem(LS_SESION); }catch(_){}
}
// Al volver de Google por redirección, /api manda de vuelta con ?entro=1 (o =0
// si no se pudo entrar o se canceló)
function volviendoDeGoogle(){
  return new URLSearchParams(location.search).has("entro");
}
// Se saca de la barra para que no quede en un link compartido ni en el
// historial. Los demás parámetros (?interno=1) quedan.
function limpiarUrl(){
  const q = new URLSearchParams(location.search);
  q.delete("entro");
  const resto = q.toString();
  history.replaceState(history.state, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
}

/* ============================================================
   SESIÓN
   ============================================================ */
let alCambiar = ()=>{};      // main.js: rehace el saludo del inicio y Mi cuenta

export async function iniciarCuentas(opciones){
  mostrar = opciones.show;
  alCambiar = opciones.alCambiar || alCambiar;
  if(!cuentasActivas) return;
  document.getElementById("tab-ranking").hidden = false;
  renderCuenta();
  const vuelve = volviendoDeGoogle();
  if(!vuelve && !haySesionGuardada()) return;
  try{
    const { usuario: yo } = await api("/yo");
    if(vuelve){
      limpiarUrl();
      track("cuenta", { accion: yo ? "entro" : "cancelo", detalle: "" });
      // El evento recomendado de GA4: aparece solo en los informes de usuarios
      if(yo) track("login", { method: "Google" });
    }
    await tomarSesion(yo);
    if(usuario) await guardarPendiente();
  }catch(e){
    console.warn("[cuenta]", e);
  }
}

export const usuarioActual = ()=> usuario;

// yo: { id, nombre } de la sesión, o null si no hay
async function tomarSesion(yo){
  recordarSesion(Boolean(yo));
  if(!yo){
    if(!usuario) return;
    usuario = null; olvidarCache(); renderCuenta(); return;
  }
  if(usuario && usuario.id === yo.id) return;
  usuario = { id: yo.id, nombre: yo.nombre };
  olvidarCache();
  renderCuenta();
}

// Desde la pantalla final, la partida que acaban de jugar se guarda al entrar
function marcarPendiente(desde){
  if(desde === "final" && partidaFinal){
    try{ localStorage.setItem(LS_PENDIENTE, JSON.stringify({ ...partidaFinal, cuando: Date.now() })); }catch(_){}
  }
}

// Entrar por redirección: se va a Google y vuelve con ?entro=. Es el botón
// propio, que queda mientras carga el de Google o si no carga (un bloqueador).
// desde: inicio | final | ranking | cuenta
function entrar(desde){
  track("cuenta", { accion: "entrar", desde });
  marcarPendiente(desde);
  location.href = "/api/auth/entrar?vuelta=" + encodeURIComponent(location.pathname);
}

/* El botón de Google (Google Identity Services): abre la ventanita de Google
   sin salir de la página y devuelve un token que /api verifica. Se baja recién
   cuando hay un botón para entrar en pantalla. */
let gisPromesa = null;
let nonce = "";              // el de este intento; a Google va su SHA-256
let desdeGoogle = "cuenta";  // dónde se tocó el botón (para Analytics y la partida pendiente)
function cargarGis(){
  if(!gisPromesa){
    gisPromesa = new Promise((ok, mal)=>{
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = ()=> window.google && google.accounts ? ok(google.accounts.id) : mal(new Error("gis"));
      s.onerror = ()=> mal(new Error("gis"));
      document.head.appendChild(s);
    }).then(async gis=>{
      const azar = crypto.getRandomValues(new Uint8Array(24));
      nonce = Array.from(azar, b=> b.toString(16).padStart(2, "0")).join("");
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
      gis.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: alVolverDeGoogle,
        nonce: Array.from(new Uint8Array(hash), b=> b.toString(16).padStart(2, "0")).join(""),
        context: "signin",
        itp_support: true,
      });
      return gis;
    });
  }
  return gisPromesa;
}

// Cambia los botones propios que haya en pantalla por el de Google
function pintarBotonesGoogle(){
  if(!GOOGLE_CLIENT_ID) return;
  const huecos = [...document.querySelectorAll(".g-entrar:not([data-listo])")];
  if(!huecos.length) return;
  cargarGis().then(gis=>{
    huecos.forEach(h=>{
      if(!h.isConnected || h.dataset.listo) return;
      h.dataset.listo = "1";
      const ancho = Math.round(h.getBoundingClientRect().width) || 260;
      const grande = h.dataset.tam !== "medium";   // el de la barra de arriba va a su medida
      h.innerHTML = "";
      gis.renderButton(h, {
        theme: "filled_black", size: h.dataset.tam, shape: "pill", text: h.dataset.texto, locale: "es-419",
        ...(grande ? { width: Math.min(400, Math.max(200, ancho)) } : {}),
        click_listener: ()=>{
          desdeGoogle = h.dataset.desde;
          track("cuenta", { accion: "entrar", desde: desdeGoogle });
          marcarPendiente(desdeGoogle);
        },
      });
    });
  }).catch(()=>{ /* sin el script de Google queda el botón propio */ });
}

async function alVolverDeGoogle(respuesta){
  try{
    const { usuario: yo } = await api("/auth/google", { credential: respuesta.credential, nonce });
    track("cuenta", { accion: "entro", detalle: "" });
    track("login", { method: "Google" });
    await tomarSesion(yo);
    await guardarPendiente();
  }catch(e){
    console.warn("[cuenta]", e);
    track("error_cuenta", { donde: "google", desde: desdeGoogle });
    alert("No pudimos entrar con Google. Probá de nuevo en un rato.");
  }
}

async function salir(){
  track("cuenta", { accion: "salir" });
  try{ await api("/auth/salir", {}); }catch(_){}
  recordarSesion(false);
  usuario = null;
  olvidarCache();
  renderCuenta();
}

// Borra la cuenta con todas sus partidas (y la saca del ranking). No hay vuelta atrás.
async function borrarCuenta(){
  if(!usuario) return;
  if(!confirm("¿Borrar tu cuenta? Se borran tu nombre y todas tus partidas guardadas, y salís del ranking. No se puede deshacer.")) return;
  try{ await api("/yo/borrar", {}); }
  catch(_){
    track("error_cuenta", { donde: "borrar" });
    alert("No pudimos borrar la cuenta. Probá de nuevo en un rato.");
    return;
  }
  track("cuenta", { accion: "borrar" });
  recordarSesion(false);
  usuario = null;
  partidaFinal = null;
  olvidarCache();
  renderCuenta();
  alert("Listo: borramos tu cuenta y tus partidas.");
}

// El nombre del ranking se cambia ahí mismo, en Mi cuenta (antes era una
// ventanita del navegador)
function editarNombre(abrir){
  const ver = document.getElementById("nm-ver"), form = document.getElementById("nm-form");
  if(!ver || !form) return;
  ver.hidden = abrir; form.hidden = !abrir;
  if(abrir){ const inp = document.getElementById("nm-in"); inp.value = usuario.nombre; inp.focus(); inp.select(); }
}
async function guardarNombre(ev){
  ev.preventDefault();
  if(!usuario) return;
  const nuevo = (document.getElementById("nm-in").value || "").trim().slice(0, 30);
  if(!nuevo || nuevo === usuario.nombre){ editarNombre(false); return; }
  const btn = ev.target.querySelector("button[type=submit]");
  if(btn) btn.disabled = true;
  let guardado = null;
  try{ guardado = (await api("/yo/nombre", { nombre: nuevo })).nombre; }catch(_){}
  if(btn) btn.disabled = false;
  if(!guardado){ track("error_cuenta", { donde: "nombre" }); alert("No pudimos cambiar el nombre. Probá de nuevo."); return; }
  usuario.nombre = guardado;
  track("cuenta", { accion: "renombrar" });
  renderCuenta();
}

const LOGO_G = `<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
// El botón propio, adentro del hueco donde pintarBotonesGoogle() pone el de
// Google. gis: el texto del de Google (signin_with | continue_with | signin);
// tam: su tamaño (large | medium)
function botonGoogle(desde, texto, gis = "signin_with", tam = "large"){
  return `<div class="g-entrar" data-desde="${desde}" data-texto="${gis}" data-tam="${tam}"><button type="button" class="btn google" onclick="entrarConGoogle('${desde}')">${LOGO_G}<span>${texto}</span></button></div>`;
}
// "Ana G." → "AG"
function iniciales(nombre){
  const p = String(nombre).replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
}

// Lo que depende de la sesión: el avatar de arriba, Mi cuenta y, en Analytics,
// el ID de la cuenta y la propiedad con_cuenta. Con una sesión guardada que
// todavía no se confirmó no se marca: si no, sus primeros eventos irían como "no".
function renderCuenta(){
  if(usuario || !haySesionGuardada()){
    usuarioAnalytics(usuario ? usuario.id : null);
    propiedadesUsuario({ con_cuenta: usuario ? "si" : "no" });
  }
  const nav = document.getElementById("nav-cuenta");
  if(nav){
    nav.innerHTML = !cuentasActivas ? ""
      : usuario
        ? `<button type="button" class="av" onclick="irA('cuenta')" aria-label="Mi cuenta: ${esc(usuario.nombre)}">${esc(iniciales(usuario.nombre))}</button>`
        : botonGoogle("inicio", "Entrar", "signin", "medium");
    // Con una sesión guardada que todavía no se confirmó, lo más probable es
    // que en un rato aparezca el avatar: el de Google no hace falta. Si no,
    // se baja cuando la página ya cargó.
    if(!usuario && !haySesionGuardada()) (window.requestIdleCallback || setTimeout)(pintarBotonesGoogle);
  }
  if(document.getElementById("s-cuenta").classList.contains("on")) renderMiCuenta();
  else renderSalir();
  alCambiar();
}
function renderSalir(){
  const el = document.getElementById("cuenta-salir");
  if(el) el.innerHTML = usuario
    ? `<button type="button" class="salir" onclick="salirDeCuenta()">Cerrar sesión</button>
       <button type="button" class="salir borrar" onclick="borrarCuenta()">Borrar mi cuenta</button>`
    : "";
}

/* ============================================================
   MI CUENTA
   Perfil, estadísticas, récords con su puesto y las últimas partidas. Todo
   sale de las partidas propias (las reglas de la base no dejan leer otras)
   y los puestos de ranking_solo().
   ============================================================ */
let misPartidas = null;        // cache: [{ canciones, segundos, puntos, jugada, videos }], más nuevas primero
let puestos = {};              // cache: { "canciones/período": fila de ranking_solo con es_mio, o null }
function olvidarCache(){ misPartidas = null; puestos = {}; }

async function cargarMisPartidas(){
  if(misPartidas) return misPartidas;
  misPartidas = await api("/partidas");
  return misPartidas;
}
// Tu fila en el ranking de esa cantidad y período (puesto y mejor puntaje), o null
export async function miPuesto(canciones, per = "siempre"){
  if(!cuentasActivas || !usuario) return null;
  const k = canciones + "/" + per;
  if(!(k in puestos)){
    puestos[k] = miFilaDelRanking(canciones, per).catch(()=> null);
  }
  return puestos[k];
}

const cuadritos = (segundos, chicos)=> `<span class="sqs${chicos ? " s" : ""}">${segundos.map(s=>
  `<span class="sq ${s === 0 ? "k" : s === 1 ? "g" : s <= 3 ? "y" : "o"}"></span>`).join("")}</span>`;
const fechaCorta = (d)=> new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short" });

let turnoCuenta = 0;
export async function renderMiCuenta(){
  renderSalir();
  const el = document.getElementById("cuenta-perfil");
  const local = document.getElementById("cuenta-local");
  if(!el) return;
  local.hidden = Boolean(usuario);
  if(!cuentasActivas){ el.innerHTML = ""; return; }
  if(!usuario){
    el.innerHTML = `<div class="login-card">
        <div class="av" aria-hidden="true">🎧</div>
        <h3>Guardá tus partidas</h3>
        <p>Entrá con Google para tener tus récords de Un jugador en cualquier dispositivo y aparecer en el ranking.
          Solo se muestra un nombre corto que podés cambiar.</p>
        ${botonGoogle("cuenta", "Entrar con Google")}
      </div>`;
    pintarBotonesGoogle();
    return;
  }
  const turno = ++turnoCuenta;
  el.innerHTML = `
    <div class="prof">
      <div class="av lg" aria-hidden="true">${esc(iniciales(usuario.nombre))}</div>
      <div class="grow">
        <div class="nm" id="nm-ver"><span>${esc(usuario.nombre)}</span>
          <button type="button" class="edit" onclick="editarNombre(true)">Editar</button></div>
        <form class="nm-form" id="nm-form" hidden onsubmit="guardarNombre(event)">
          <input type="text" id="nm-in" maxlength="30" aria-label="Tu nombre en el ranking" autocomplete="nickname">
          <button type="submit" class="btn mag mini">Guardar</button>
          <button type="button" class="btn ghost mini" onclick="editarNombre(false)">Cancelar</button>
        </form>
        <small>Así te ven en el ranking · entraste con Google</small>
      </div>
    </div>
    <div id="cuenta-datos"><p class="cargando">Cargando tus partidas…</p></div>`;
  try{
    const partidas = await cargarMisPartidas();
    if(turno !== turnoCuenta) return;
    const box = document.getElementById("cuenta-datos");
    if(!partidas.length){
      box.innerHTML = `<div class="tarjeta"><span class="grow"><span class="tarjeta-t">Todavía no jugaste con tu cuenta</span>
        <span class="tarjeta-d">Las partidas de Un jugador se guardan solas y entran al ranking.</span></span></div>`;
      return;
    }
    const canciones = partidas.reduce((n, p)=> n + p.segundos.length, 0);
    const salieron = partidas.flatMap(p=> p.segundos).filter(s=> s > 0);
    const promedio = salieron.length ? (salieron.reduce((a, b)=> a + b, 0) / salieron.length) : 0;
    const mejores = {};
    partidas.forEach(p=>{ mejores[p.canciones] = Math.max(mejores[p.canciones] || 0, p.puntos); });
    box.innerHTML = `
      <div class="tiles">
        <div class="tile"><b>${partidas.length}</b><span>partidas</span></div>
        <div class="tile"><b>${canciones}</b><span>canciones</span></div>
        <div class="tile"><b>${promedio ? promedio.toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " s" : "—"}</b><span>promedio para sacarla</span></div>
      </div>
      ${favoritosHtml(contarVideos(partidas.flatMap(p=> p.videos || [])), "tus partidas de Un jugador")}
      <div class="lbl">Tus récords</div>
      <div class="rec">${OPCIONES_CANCIONES.map(n=> `<div class="${mejores[n] ? "" : "none"}" data-rec="${n}">
          ${n ? n + " canciones" : "Sin límite"}<b>${mejores[n] || "—"}</b><span class="pos">${mejores[n] ? "…" : ""}</span></div>`).join("")}</div>
      <div class="lbl">Últimas partidas</div>
      <div class="hist">${partidas.slice(0, 5).map(p=> `<div class="hist-row">
          ${cuadritos(p.segundos, true)}<b>${p.puntos}</b>
          <small>${fechaCorta(p.jugada)} · ${p.canciones ? p.canciones + " canciones" : "sin límite"}</small></div>`).join("")}</div>`;
    // el puesto va solo en el récord de 10 canciones, que es el que tiene ranking
    box.querySelectorAll(".rec .pos").forEach(c=>{ c.textContent = ""; });
    if(mejores[RANKING_CANCIONES]){
      const celda = box.querySelector(`[data-rec="${RANKING_CANCIONES}"] .pos`);
      celda.textContent = "…";
      const mio = await miPuesto(RANKING_CANCIONES);
      if(turno !== turnoCuenta) return;
      celda.textContent = mio ? "#" + mio.puesto : "";
    }
  }catch(e){
    track("error_cuenta", { donde: "mis_partidas" });
    if(turno !== turnoCuenta) return;
    document.getElementById("cuenta-datos").innerHTML = `<p class="cargando">No pudimos cargar tus partidas.</p>`;
  }
}

/* ============================================================
   PARTIDAS
   La partida se va anotando en la base mientras se juega, con o sin cuenta:
   qué video sonó y cuándo, y con cuántos segundos salió (1 a 6, 0 si no
   salió). La base comprueba que el video sea del catálogo y que el título sea
   el suyo; si algo no cierra, la descarta. Al terminar, con cuenta, la pasa al
   historial y al ranking.
   ============================================================ */
let enCurso = null;   // { canciones, id, valida, propias, cola }

// Los pasos van en orden: cada uno sale recién cuando volvió el anterior. Un
// corte de red no tira la partida: se insiste (la base toma el mismo paso
// repetido como uno solo).
function paso(p, nombre, args){
  p.cola = p.cola.then(async ()=>{
    if(!p.valida) return;
    if(!await apiInsistente("/solo/" + nombre, { partida: p.id, ...args })) p.valida = false;
  }).catch(()=>{ p.valida = false; });
}

export function soloEmpezar(canciones){
  enCurso = null;
  if(!cuentasActivas) return;
  const p = { canciones, id: null, valida: true, propias: false };
  p.cola = apiInsistente("/solo/empezar", { canciones })
    .then(id=>{ p.id = id; if(!id) p.valida = false; })
    .catch(()=>{ p.valida = false; });
  enCurso = p;
}
// Empezó a sonar una canción (o la reemplazó otra porque YouTube no la pasó).
// Las propias (audios o links cargados a mano) no están en el catálogo.
export function soloSono(video, propia){
  const p = enCurso;
  if(!p || !p.valida) return;
  if(propia){ p.propias = true; p.valida = false; return; }
  paso(p, "sonar", { video });
}
// titulo: el que eligió, normalizado como en el catálogo; null si no salió.
export function soloResolvio(segundos, titulo){
  const p = enCurso;
  if(p && p.valida) paso(p, "resolver", { segundos, titulo });
}

async function guardarPartida(p){
  const puntos = await api("/solo/terminar", { partida: p.id });
  if(puntos === null) throw new Error("partida vencida");
  olvidarCache();
  const mio = await miPuesto(p.canciones);
  track("partida_guardada", {
    canciones_por_partida: p.canciones, puntos, puesto: mio ? Number(mio.puesto) : 0,
  });
  return { puntos, mio };
}
async function miFilaDelRanking(canciones, per){
  const data = await api(`/ranking?canciones=${canciones}&limite=1&periodo=${per}`);
  return (data || []).find(f=> f.es_mio) || null;
}

// Volvió de Google desde la pantalla final: se guarda esa partida y se muestra dónde quedó.
async function guardarPendiente(){
  let p = null;
  try{ p = JSON.parse(localStorage.getItem(LS_PENDIENTE)); localStorage.removeItem(LS_PENDIENTE); }catch(_){}
  if(!p || !p.id || Date.now() - (p.cuando || 0) > PENDIENTE_VENCE_MS) return;
  try{
    await guardarPartida(p);
    verRanking("semana", "guardado", "Guardamos tu partida 🎧");
  }catch(e){ console.warn("[cuenta]", e); }
}

// Pantalla final. resueltas = null en el modo con amigos (no hay ranking).
let turnoFinal = 0;
export async function rankingFinal(resueltas){
  const el = document.getElementById("ranking-final");
  const turno = ++turnoFinal;
  const p = enCurso;
  enCurso = null;
  partidaFinal = null;
  el.hidden = true;
  if(!cuentasActivas || !p || !resueltas) return;
  el.hidden = false;
  el.innerHTML = `<p class="hint" style="margin:0">Guardando en el ranking…</p>`;
  await p.cola;
  if(turno !== turnoFinal) return;          // ya arrancó otra partida
  if(!p.valida){
    track("partida_descartada", { canciones_por_partida: p.canciones, por: p.propias ? "propias" : "base" });
    el.innerHTML = `<p class="hint" style="margin:0">${p.propias
      ? "Las partidas con canciones propias no entran al ranking."
      : "Esta partida no pudo entrar al ranking 😕"}</p>`;
    return;
  }
  const canciones = p.canciones;
  partidaFinal = { id: p.id, canciones };
  if(canciones !== RANKING_CANCIONES){
    // Se guarda en el historial igual, pero el ranking es solo el de 10 canciones
    if(usuario){
      try{ await guardarPartida(partidaFinal); }catch(_){ track("error_cuenta", { donde: "guardar" }); }
      if(turno !== turnoFinal) return;
    }
    el.innerHTML = `<p class="hint" style="margin:0">El ranking es solo con ${RANKING_CANCIONES} canciones${usuario ? ". Tu partida quedó en tu historial." : "."}</p>`;
    return;
  }
  if(!usuario){
    // Contra cuenta/entrar desde final da cuántos aceptan la invitación
    track("invitacion_cuenta", { desde: "final", canciones_por_partida: canciones });
    el.innerHTML = `<p class="hint" style="margin:0 0 10px">¿Querés aparecer en el ranking? Entrá y guardamos esta partida.</p>
      ${botonGoogle("final", "Entrar con Google y guardarla", "continue_with")}`;
    pintarBotonesGoogle();
    return;
  }
  try{
    // La partida recién guardada siempre entra en la semana: ese puesto va
    // grande y el histórico debajo
    const { puntos, mio } = await guardarPartida(partidaFinal);
    const semana = await miPuesto(canciones, "semana");
    if(turno !== turnoFinal) return;          // ya arrancó otra partida
    const txt = !semana ? "Partida guardada."
      : semana.puntos === puntos ? `Quedaste <b style="color:var(--amber)">#${semana.puesto}</b> esta semana`
      : `Tu mejor de la semana (${semana.puntos} puntos) está <b style="color:var(--amber)">#${semana.puesto}</b>`;
    const historico = mio ? `<span class="tarjeta-d">Histórico: #${mio.puesto}${mio.puntos === puntos ? "" : ` con ${mio.puntos} puntos`}</span>` : "";
    el.innerHTML = `<button type="button" class="tarjeta" style="border:0;padding:0;background:none" onclick="verRanking('semana', 'final')">
        <span class="grow"><span class="eyebrow">Ranking · ${canciones} canciones</span><span class="tarjeta-t">${txt}</span>${historico}</span>
        <span class="pill amber">Ver ›</span></button>`;
  }catch(e){
    track("error_cuenta", { donde: "guardar" });
    if(turno !== turnoFinal) return;
    el.innerHTML = `<p class="hint">No pudimos guardar la partida en el ranking 😕</p>`;
  }
}

/* ============================================================
   RANKING
   Semana, mes o histórico, siempre con partidas de 10 canciones. Podio para
   los tres primeros, lista corta debajo y tu fila aparte (fija abajo en el
   celular), aunque estés lejos del podio.
   ============================================================ */
// "con 10 canciones esta semana", "con 10 canciones"
const deQue = ()=> "con " + RANKING_CANCIONES + " canciones"
  + (periodo(periodoVisto).cuando ? " " + periodo(periodoVisto).cuando : "");

let turnoRanking = 0;
// per: semana | mes | siempre; sin él queda el último que se miró
// desde (para Analytics): seccion | inicio | final | guardado | periodo
// aviso: un cartel arriba de la tabla ("Guardamos tu partida")
export async function verRanking(per, desde, aviso){
  if(!cuentasActivas) return;
  if(PERIODOS.some(p=> p.id === per)) periodoVisto = per;
  if(!document.getElementById("s-ranking").classList.contains("on")) mostrar("s-ranking");
  track("ranking_visto", { canciones_por_partida: RANKING_CANCIONES, periodo: periodoVisto, desde: desde || "" });
  const turno = ++turnoRanking;
  document.getElementById("rk-aviso").textContent = aviso || "";
  document.getElementById("rk-aviso").hidden = !aviso;
  document.getElementById("rk-periodos").innerHTML = PERIODOS.map(p=>
    `<button type="button" aria-pressed="${p.id === periodoVisto}" onclick="verRanking('${p.id}', 'periodo')">${p.boton}</button>`).join("");
  document.getElementById("rk-titulo").textContent = `Ranking ${periodo(periodoVisto).titulo} · ${RANKING_CANCIONES} canciones`;
  document.getElementById("rk-sub").textContent = "Un jugador · el mejor puntaje de cada cuenta"
    + (periodo(periodoVisto).cuando ? " " + periodo(periodoVisto).cuando : "");
  const podio = document.getElementById("rk-podio");
  const lista = document.getElementById("rk-lista");
  const yo = document.getElementById("rk-yo");
  podio.innerHTML = "";
  lista.innerHTML = `<p class="rk-vacio">Cargando…</p>`;
  yo.innerHTML = "";
  try{
    const data = await api(`/ranking?canciones=${RANKING_CANCIONES}&limite=${LIMITE_RANKING}&periodo=${periodoVisto}`);
    if(turno !== turnoRanking) return;       // cambiaron de pestaña mientras cargaba
    renderYo(data);
    if(!data.length){
      lista.innerHTML = `<p class="rk-vacio">Todavía nadie jugó ${deQue()}. ¡Podés ser el primero!</p>`;
      return;
    }
    const tres = [2, 1, 3].map(p=> data.find(f=> Number(f.puesto) === p)).filter(Boolean);
    podio.innerHTML = tres.map(f=> `<div class="pod p${f.puesto} ${f.es_mio ? "mio" : ""}">
        <div class="av" aria-hidden="true">${esc(iniciales(f.nombre))}</div>
        <div class="n">${esc(f.nombre)}${f.es_mio ? " (vos)" : ""}</div>
        <div class="p">${f.puntos} pts</div>
        <div class="blk">${f.puesto}</div>
      </div>`).join("");
    // Los del podio no se repiten abajo; tu fila, si quedó fuera de los
    // primeros, va solo en la tarjeta de abajo
    const resto = data.filter(f=> Number(f.puesto) > 3 && Number(f.puesto) <= LIMITE_RANKING);
    lista.innerHTML = resto.map(f=> `<div class="rk-row ${f.es_mio ? "mio" : ""}">
        <span class="pos">${f.puesto}</span>
        <span class="nom">${esc(f.nombre)}${f.es_mio ? " <small>(vos)</small>" : ""}</span>
        <span class="pt">${f.puntos}</span>
      </div>`).join("");
  }catch(e){
    track("error_cuenta", { donde: "ranking" });
    if(turno !== turnoRanking) return;
    lista.innerHTML = `<p class="rk-vacio">No pudimos cargar el ranking. Probá de nuevo en un rato.</p>`;
  }
}
// Tu fila: puesto, puntos y cuánto te falta para el de arriba
function renderYo(data){
  const yo = document.getElementById("rk-yo");
  if(!usuario){
    yo.innerHTML = `<div class="rk-yo fuera">Entrá con Google para aparecer acá${botonGoogle("ranking", "Entrar con Google")}</div>`;
    pintarBotonesGoogle();
    return;
  }
  const mio = data.find(f=> f.es_mio);
  if(!mio){
    yo.innerHTML = `<div class="rk-yo fuera">Todavía no jugaste ${deQue()} con tu cuenta.</div>`;
    return;
  }
  const puesto = Number(mio.puesto);
  const arriba = data.filter(f=> Number(f.puesto) < puesto && !f.es_mio).pop();
  const falta = puesto === 1 ? "¡Vas primero!"
    : arriba ? (Number(arriba.puesto) === puesto - 1
        ? `Te faltan ${arriba.puntos - mio.puntos + 1} puntos para el #${arriba.puesto}`
        : `Te faltan ${arriba.puntos - mio.puntos + 1} puntos para entrar al top ${arriba.puesto}`)
    : "";
  yo.innerHTML = `<div class="rk-yo">
      <span class="pos">#${puesto}</span>
      <span>Vos · ${esc(mio.nombre)}${falta ? `<small>${falta}</small>` : ""}</span>
      <span class="pt">${mio.puntos}</span>
    </div>`;
}

// Los onclick del HTML llaman funciones globales (como en main.js)
Object.assign(window, {
  entrarConGoogle: entrar, salirDeCuenta: salir, borrarCuenta, editarNombre, guardarNombre, verRanking,
});
