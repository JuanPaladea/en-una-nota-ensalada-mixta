// Cuentas con Google y ranking del modo un jugador.
//
// Entrar es opcional: sin cuenta se juega igual que siempre. Con cuenta, cada
// partida de un jugador se guarda (el historial) y el mejor puntaje de cada uno
// entra al ranking, que hay uno por cantidad de canciones — 40 puntos en 5
// canciones no se comparan con 40 en 20 — y por período: la semana (desde el
// viernes), el mes (desde el 1) o de siempre.
//
// Todo pasa por /api (netlify/functions/api.mjs): verifica el token de Google,
// lleva la sesión en una cookie y habla con la base (db/esquema.sql). Esta
// página nunca ve la clave de la base.
import { esc } from "./utils.js";
import { soloTramo } from "./sharecard.js";
import { track, propiedadesUsuario, usuarioAnalytics } from "./analytics.js";
import { contarVideos, favoritosHtml, nombreGenero } from "./favoritos.js";
import { pastilla, indicadorTabs } from "./motion.js";
import { api } from "./api.js";
import { GENRES } from "./data.js";
import { estadisticasHtml } from "./logros.js";
import { fechaCorta as fechaDeDia, diaProvisional, olvidarDesafio } from "./fijas.js";
import { misLigas, ligasEnMemoria, olvidarLigas, crearLiga, unirseALiga, salirDeLiga, ligaPendiente, sumarPendiente, ligasHtml, LINK_LIGA } from "./ligas.js";

export const cuentasActivas = true;
// El ID de cliente OAuth de Google Cloud, el mismo que usa la función de /api.
// También es público. Vacío, se entra solo por redirección.
const GOOGLE_CLIENT_ID = "790742708415-p6r2dinuf89fa51ket66imcct7vd02db.apps.googleusercontent.com";

const LS_SESION = "eun_sesion_v1";             // "1" si acá hubo una sesión abierta (la cookie de verdad no se lee desde la página)
const LS_PENDIENTE = "eun_partida_pendiente_v1";
const PENDIENTE_VENCE_MS = 60 * 60 * 1000;    // una partida sin guardar de hace más de una hora ya no va
const OPCIONES_CANCIONES = [5, 10, 15, 20, 30, 0];  // las mismas que el select de Opciones; 0 = sin límite
const RANKING_CANCIONES = 10;   // el ranking es solo el de partidas de 10 canciones
const LIMITE_RANKING = 20;
// Los de ranking_solo(): la semana arranca el viernes y el mes el 1, a las 0 h de Argentina.
// "hoy" es otra tabla: la del desafío del día (ranking_desafio).
const PERIODOS = [
  { id: "hoy",     boton: "Hoy",       titulo: "de hoy",    cuando: "hoy" },
  { id: "semana",  boton: "Semana",    titulo: "semanal",   cuando: "esta semana" },
  { id: "mes",     boton: "Mes",       titulo: "mensual",   cuando: "este mes" },
  { id: "siempre", boton: "Histórico", titulo: "histórico", cuando: "" },
];
const periodo = (id)=> PERIODOS.find(p=> p.id === id) || PERIODOS[2];

let usuario = null;          // { id, nombre } con la sesión abierta
let partidaFinal = null;     // { id, canciones } de la partida que se acaba de terminar, si entra al ranking
const rankingVisto = RANKING_CANCIONES;
let periodoVisto = "semana";
let generoVisto = "";        // id de una playlist: solo las partidas jugadas con esa sola ("" = todas)
let ligaVista = "";          // id de una liga propia: solo sus cuentas ("" = todo el mundo)
let mostrar = ()=>{};        // show() de main.js
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
  indicadorTabs();   // con una sección más, la rayita de la barra de abajo cambia de lugar
  renderCuenta();
  const vuelve = volviendoDeGoogle();
  if(!vuelve && !haySesionGuardada()){ avisarLigaPendiente(); return; }
  try{
    const { usuario: yo } = await api("/yo");
    if(vuelve){
      limpiarUrl();
      track("cuenta", { accion: yo ? "entro" : "cancelo", detalle: "" });
      // El evento recomendado de GA4: aparece solo en los informes de usuarios
      if(yo) track("login", { method: "Google" });
    }
    await tomarSesion(yo);
    if(usuario){ await guardarPendiente(); await sumarLigaDelLink(); }
    else avisarLigaPendiente();
  }catch(e){
    console.warn("[cuenta]", e);
  }
}

/* ---- Links de liga (?liga=…) ----
   ligas.js guarda el código al abrir el link. Con sesión, la cuenta se suma
   y se abre el ranking de esa liga; sin sesión, se va a Mi cuenta, donde el
   cartel de entrar avisa que hay una invitación esperando. */
async function sumarLigaDelLink(){
  const r = await sumarPendiente();
  if(!r) return;
  ligaVista = r.liga;
  verRanking(rankingVisto, `Ya sos parte de “${r.nombre}” 🎉`, "semana", "liga");
}
function avisarLigaPendiente(){
  if(ligaPendiente() && !usuario) mostrar("s-cuenta");
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
    await sumarLigaDelLink();
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
  ligaVista = "";
  olvidarCache();
  renderCuenta();
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
  if(el) el.innerHTML = usuario ? `<button type="button" class="salir" onclick="salirDeCuenta()">Cerrar sesión</button>` : "";
}

/* ============================================================
   MI CUENTA
   Perfil, estadísticas, récords con su puesto y las últimas partidas. Todo
   sale de las partidas propias (las reglas de la base no dejan leer otras)
   y los puestos de ranking_solo().
   ============================================================ */
let misPartidas = null;        // cache: [{ canciones, segundos, puntos, jugada, videos }], más nuevas primero
let puestos = {};              // cache: { "canciones/período": fila de ranking_solo con es_mio, o null }
function olvidarCache(){ misPartidas = null; puestos = {}; olvidarLigas(); olvidarDesafio(); }

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
        <h3>${ligaPendiente() ? "Te invitaron a una liga" : "Guardá tus partidas"}</h3>
        <p>${ligaPendiente()
          ? "Entrá con Google y quedás sumado: van a competir entre ustedes en el ranking y en el desafío del día."
          : "Entrá con Google para tener tus récords de Un jugador en cualquier dispositivo y aparecer en el ranking."}
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
        <span class="tarjeta-d">Las partidas de Un jugador se guardan solas y entran al ranking.</span></span></div>
        <div id="cuenta-ligas"></div>`;
      renderLigas(turno);
      return;
    }
    const canciones = partidas.reduce((n, p)=> n + p.segundos.length, 0);
    const salieron = partidas.flatMap(p=> p.segundos).filter(s=> s > 0);
    const promedio = salieron.length ? (salieron.reduce((a, b)=> a + b, 0) / salieron.length) : 0;
    const mejores = {};
    // Los récords son de las partidas comunes: ni el desafío, ni los duelos, ni el modo artista
    partidas.filter(p=> !p.dia && !p.duelo && (p.modo || "titulo") === "titulo")
      .forEach(p=>{ mejores[p.canciones] = Math.max(mejores[p.canciones] || 0, p.puntos); });
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
          <small>${fechaCorta(p.jugada)} · ${p.dia ? "desafío del día" : p.duelo ? "duelo"
            : (p.canciones ? p.canciones + " canciones" : "sin límite") + (p.modo === "artista" ? " · artista" : "")}</small></div>`).join("")}</div>
      <div id="cuenta-ligas"></div>
      ${estadisticasHtml(partidas)}`;
    renderLigas(turno);
    // el puesto de cada récord, de a uno a medida que llegan
    OPCIONES_CANCIONES.filter(n=> mejores[n] && n === RANKING_CANCIONES).forEach(async n=>{
      const mio = await miPuesto(n);
      if(turno !== turnoCuenta) return;
      const celda = box.querySelector(`[data-rec="${n}"] .pos`);
      if(celda) celda.textContent = mio ? "#" + mio.puesto : "";
    });
  }catch(e){
    track("error_cuenta", { donde: "mis_partidas" });
    if(turno !== turnoCuenta) return;
    document.getElementById("cuenta-datos").innerHTML = `<p class="cargando">No pudimos cargar tus partidas.</p>`;
  }
}

/* ---- Mis ligas (ligas.js) ---- */
async function renderLigas(turno){
  const lista = await misLigas();
  const box = document.getElementById("cuenta-ligas");
  if(!box || turno !== turnoCuenta) return;
  box.innerHTML = ligasHtml(lista);
}
async function ligaCrear(ev){
  ev.preventDefault();
  const form = ev.target, btn = form.querySelector("button");
  const nombre = form.nombre.value.trim();
  if(!nombre) return;
  btn.disabled = true;
  const codigo = await crearLiga(nombre);
  btn.disabled = false;
  if(!codigo){ alert("No pudimos crear la liga (se pueden tener hasta 10). Probá de nuevo."); return; }
  await renderLigas(turnoCuenta);
  // Recién creada: lo que sigue es invitar
  const fila = document.querySelector("#cuenta-ligas .liga-row:last-of-type .act");
  if(fila) fila.focus();
}
async function ligaUnirse(ev){
  ev.preventDefault();
  const form = ev.target, btn = form.querySelector("button");
  const codigo = form.codigo.value.trim();
  if(!codigo) return;
  btn.disabled = true;
  let r = null;
  try{ r = await unirseALiga(codigo); }catch(_){}
  btn.disabled = false;
  if(!r || !r.liga){ alert("No encontramos una liga con ese código (o ya está completa)."); return; }
  ligaVista = r.liga;
  verRanking(rankingVisto, `Ya sos parte de “${r.nombre}” 🎉`, "semana", "liga");
}
async function ligaSalir(id){
  const l = ligasEnMemoria().find(x=> x.id === id);
  if(!l || !confirm(`¿Salir de “${l.nombre}”?${l.miembros === 1 ? " Sos el único: la liga se borra." : ""}`)) return;
  if(await salirDeLiga(id)){
    if(ligaVista === id) ligaVista = "";
    renderLigas(turnoCuenta);
  }
}
async function ligaCompartir(codigo, btn){
  const url = LINK_LIGA + codigo;
  const text = "🏆 Sumate a mi liga de “En una nota” y competimos entre nosotros:";
  track("liga", { accion: "invitar" });
  if(navigator.share){
    try{ await navigator.share({ title: "Liga · En una nota", text, url }); return; }
    catch(e){ if(e && e.name === "AbortError") return; }
  }
  try{
    await navigator.clipboard.writeText(text + " " + url);
    const antes = btn.textContent; btn.textContent = "✔ Copiado";
    setTimeout(()=>{ btn.textContent = antes; }, 2000);
  }catch(_){ prompt("Copiá el link y mandalo:", url); }
}
function verRankingDeLiga(id){
  ligaVista = id;
  verRanking(rankingVisto, "", undefined, "liga");
}

/* ============================================================
   PARTIDAS
   La partida se va anotando en la base mientras se juega, con o sin cuenta:
   qué video sonó y cuándo, y con cuántos segundos salió (1 a 6, 0 si no
   salió). La base comprueba que el video sea del catálogo, que el título sea
   el suyo y que haya pasado el tiempo de esos fragmentos; si algo no cierra,
   la descarta. Al terminar, con cuenta, la pasa al historial y al ranking.
   ============================================================ */
let enCurso = null;   // { canciones, id, valida, propias, cola }

// Los pasos van en orden: cada uno sale recién cuando volvió el anterior.
function paso(p, nombre, args){
  p.cola = p.cola.then(async ()=>{
    if(!p.valida) return;
    if(!await api("/solo/" + nombre, { partida: p.id, ...args })) p.valida = false;
  }).catch(()=>{ p.valida = false; });
}

// extra: { genero, modo, dia, duelo } — la playlist si se juega con una sola,
// qué se adivina, y el desafío del día o el duelo si la partida es uno.
export function soloEmpezar(canciones, extra = {}){
  enCurso = null;
  if(!cuentasActivas) return;
  const datos = { modo: extra.modo || "titulo", genero: extra.genero || null, dia: extra.dia || null, duelo: extra.duelo || null };
  const p = { canciones, id: null, valida: true, propias: false, ...datos };
  p.cola = api("/solo/empezar", { canciones, ...datos })
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
// titulo: lo que eligió (el título o, en el modo artista, el artista),
// normalizado como en el catálogo; null si no salió. pistas: cuántos de los
// segundos fueron pistas y no audio.
export function soloResolvio(segundos, titulo, pistas = 0){
  const p = enCurso;
  if(p && p.valida) paso(p, "resolver", { segundos, titulo, pistas });
}

// La partida que se acaba de terminar, cuando la base ya la dio por buena:
// una promesa con su id, o con null si no sirve (canciones propias,
// descartada, sin base). main.js la usa para armar o responder un duelo.
let partidaOk = Promise.resolve(null);
export const partidaLista = ()=> partidaOk;

// Pasa la partida a la cuenta. En el desafío del día, null quiere decir que
// esa cuenta ya lo había jugado (vale el primer intento) y no es un error.
async function guardarPartida(p){
  const puntos = await api("/solo/terminar", { partida: p.id });
  if(puntos === null){
    if(p.dia) return { puntos: null, mio: null };
    throw new Error("partida vencida");
  }
  olvidarCache();
  const mio = p.dia ? await miFilaDelRanking(p.canciones, "hoy").catch(()=> null) : await miPuesto(p.canciones);
  track("partida_guardada", {
    canciones_por_partida: p.canciones, puntos, puesto: mio ? Number(mio.puesto) : 0,
    tipo: p.dia ? "desafio" : p.duelo ? "duelo" : "comun",
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
    const { puntos } = await guardarPartida(p);
    if(p.dia) verRanking(p.canciones, puntos === null
      ? "Ya habías jugado el desafío de hoy con tu cuenta: vale tu primer intento."
      : "Guardamos tu desafío 🎧", "hoy", "guardado");
    else if(p.canciones === RANKING_CANCIONES && !p.duelo && p.modo !== "artista")
      verRanking(p.canciones, "Guardamos tu partida 🎧", "semana", "guardado");
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
  partidaOk = cuentasActivas && p && resueltas
    ? p.cola.then(()=> p.valida ? p.id : null, ()=> null)
    : Promise.resolve(null);
  if(!cuentasActivas || !p || !resueltas) return;
  el.hidden = false;
  el.innerHTML = `<p class="hint" style="margin:0">${p.duelo ? "Guardando la partida…" : "Guardando en el ranking…"}</p>`;
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
  partidaFinal = { id: p.id, canciones, dia: p.dia, duelo: p.duelo, modo: p.modo };
  // El desafío del día: su propio ranking, una partida por cuenta
  if(p.dia){
    if(!usuario){
      track("invitacion_cuenta", { desde: "final", canciones_por_partida: canciones, tipo: "desafio" });
      el.innerHTML = `<p class="hint" style="margin:0 0 10px">¿Querés ver en qué puesto quedaste hoy? Entrá y guardamos tu desafío.</p>
        ${botonGoogle("final", "Entrar con Google y guardarlo", "continue_with")}`;
      pintarBotonesGoogle();
      return;
    }
    try{
      const { puntos, mio } = await guardarPartida(partidaFinal);
      if(turno !== turnoFinal) return;
      const txt = puntos === null ? "Ya lo habías jugado con tu cuenta: vale tu primer intento"
        : mio ? `Quedaste <b style="color:var(--amber)">#${mio.puesto}</b> en el desafío de hoy`
        : "Desafío guardado.";
      el.innerHTML = `<button type="button" class="tarjeta" style="border:0;padding:0;background:none" onclick="verRanking(${canciones}, '', 'hoy', 'final')">
          <span class="grow"><span class="eyebrow">Desafío del día</span><span class="tarjeta-t">${txt}</span>
          <span class="tarjeta-d">Mañana a las 0 h hay canciones nuevas</span></span>
          <span class="pill amber">Ver ›</span></button>`;
    }catch(e){
      track("error_cuenta", { donde: "guardar" });
      if(turno !== turnoFinal) return;
      el.innerHTML = `<p class="hint">No pudimos guardar tu desafío 😕</p>`;
    }
    return;
  }
  if(canciones !== RANKING_CANCIONES || p.duelo || p.modo === "artista"){
    // Se guarda en el historial igual, pero el ranking es solo el de 10
    // canciones adivinando el título, y sin los duelos (ahí las canciones ya se conocen)
    if(usuario){
      try{ await guardarPartida(partidaFinal); }catch(_){ track("error_cuenta", { donde: "guardar" }); }
      if(turno !== turnoFinal) return;
    }
    const porque = p.duelo ? "Los duelos no cuentan para el ranking"
      : p.modo === "artista" ? "Adivinando el artista no hay ranking"
      : `El ranking es solo con ${RANKING_CANCIONES} canciones`;
    el.innerHTML = `<p class="hint" style="margin:0">${porque}${usuario ? ". Tu partida quedó en tu historial." : "."}</p>`;
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
    const de = canciones ? ` · ${canciones} canciones` : " · sin límite";
    const txt = !semana ? "Partida guardada."
      : semana.puntos === puntos ? `Quedaste <b style="color:var(--amber)">#${semana.puesto}</b> esta semana`
      : `Tu mejor de la semana (${semana.puntos} puntos) está <b style="color:var(--amber)">#${semana.puesto}</b>`;
    const historico = mio ? `<span class="tarjeta-d">Histórico: #${mio.puesto}${mio.puntos === puntos ? "" : ` con ${mio.puntos} puntos`}</span>` : "";
    el.innerHTML = `<button type="button" class="tarjeta" style="border:0;padding:0;background:none" onclick="verRanking(${canciones}, '', 'semana', 'final')">
        <span class="grow"><span class="eyebrow">Ranking${de}</span><span class="tarjeta-t">${txt}</span>${historico}</span>
        <span class="pill amber">Ver ›</span></button>`;
  }catch(e){
    track("error_cuenta", { donde: "guardar" });
    if(turno !== turnoFinal) return;
    el.innerHTML = `<p class="hint">No pudimos guardar la partida en el ranking 😕</p>`;
  }
}

/* ============================================================
   RANKING
   Semana, mes o histórico, y una tabla por cantidad de canciones. Podio para
   los tres primeros, lista corta debajo y tu fila aparte (fija abajo en el
   celular), aunque estés lejos del podio.
   ============================================================ */
const nombreOpcion = (n)=> n ? n + " canciones" : "Sin límite";
// "con 10 canciones esta semana", "sin límite este mes", "con 5 canciones"
const deQue = ()=> periodoVisto === "hoy" ? "el desafío de hoy"
  : (rankingVisto ? "con " + rankingVisto + " canciones" : "sin límite")
    + (generoVisto ? " de " + nombreGenero(generoVisto) : "")
    + (periodo(periodoVisto).cuando ? " " + periodo(periodoVisto).cuando : "");

// Los dos filtros de arriba de la tabla: el género (no en el desafío del día,
// que es uno solo para todos) y, si la cuenta tiene ligas, cuál mirar.
function renderFiltros(){
  const el = document.getElementById("rk-filtros");
  const ligas = usuario ? ligasEnMemoria() : [];
  const opcion = (valor, texto, elegido)=> `<option value="${valor}"${valor === elegido ? " selected" : ""}>${esc(texto)}</option>`;
  el.innerHTML = `
    <label class="rk-filtro"${periodoVisto === "hoy" ? " hidden" : ""}><span>Género</span>
      <select onchange="filtrarRanking('genero', this.value)">
        ${opcion("", "Todos", generoVisto)}${GENRES.map(g=> opcion(g.id, nombreGenero(g.id), generoVisto)).join("")}
      </select></label>
    ${ligas.length ? `<label class="rk-filtro"><span>Liga</span>
      <select onchange="filtrarRanking('liga', this.value)">
        ${opcion("", "Todo el mundo", ligaVista)}${ligas.map(l=> opcion(l.id, l.nombre, ligaVista)).join("")}
      </select></label>` : ""}`;
}
function filtrarRanking(cual, valor){
  if(cual === "genero") generoVisto = GENRES.some(g=> g.id === valor) ? valor : "";
  else ligaVista = valor;
  verRanking(rankingVisto, "", undefined, cual);
}

let turnoRanking = 0;
// per: hoy | semana | mes | siempre; sin él queda el último que se miró
// desde (para Analytics): seccion | inicio | final | guardado | periodo | genero | liga
// La cantidad de canciones ya no se elige: solo hay ranking de 10 (_canciones se ignora)
export async function verRanking(_canciones, aviso, per, desde){
  if(!cuentasActivas) return;
  if(PERIODOS.some(p=> p.id === per)) periodoVisto = per;
  if(!usuario) ligaVista = "";
  if(!document.getElementById("s-ranking").classList.contains("on")) mostrar("s-ranking");
  const hoy = periodoVisto === "hoy";
  track("ranking_visto", {
    canciones_por_partida: rankingVisto, periodo: periodoVisto, desde: desde || "",
    genero: hoy ? "" : generoVisto, liga: ligaVista ? "si" : "no",
  });
  const turno = ++turnoRanking;
  renderFiltros();
  // Las ligas llegan después: si hay alguna, aparece el selector
  if(usuario) misLigas().then(ligas=>{
    if(turno !== turnoRanking) return;
    if(ligaVista && !ligas.some(l=> l.id === ligaVista)){ ligaVista = ""; verRanking(rankingVisto, aviso, undefined, desde); return; }
    renderFiltros();
  });
  document.getElementById("rk-aviso").textContent = aviso || "";
  document.getElementById("rk-aviso").hidden = !aviso;
  // Los botones se arman una vez; después cambia cuál está apretado y la
  // pastilla se desliza hasta él
  const periodos = document.getElementById("rk-periodos");
  if(!periodos.querySelector("button")){
    periodos.innerHTML = PERIODOS.map(p=>
      `<button type="button" data-per="${p.id}" onclick="verRanking(${rankingVisto}, '', '${p.id}', 'periodo')">${p.boton}</button>`).join("");
  }
  periodos.querySelectorAll("button").forEach(b=> b.setAttribute("aria-pressed", String(b.dataset.per === periodoVisto)));
  pastilla(periodos);
  const liga = ligaVista ? ligasEnMemoria().find(l=> l.id === ligaVista) : null;
  document.getElementById("rk-titulo").textContent = hoy
    ? "Desafío de hoy · " + fechaDeDia(diaProvisional())
    : `Ranking ${periodo(periodoVisto).titulo} · ` + (generoVisto ? nombreGenero(generoVisto) : nombreOpcion(rankingVisto).toLowerCase());
  document.getElementById("rk-sub").textContent = (liga ? "Liga " + liga.nombre + " · " : "") + (hoy
    ? "Las mismas 10 canciones para todos · una chance por cuenta"
    : "Un jugador · el mejor puntaje de cada cuenta" + (periodo(periodoVisto).cuando ? " " + periodo(periodoVisto).cuando : ""));
  const podio = document.getElementById("rk-podio");
  const lista = document.getElementById("rk-lista");
  const yo = document.getElementById("rk-yo");
  podio.innerHTML = "";
  lista.innerHTML = `<p class="rk-vacio">Cargando…</p>`;
  yo.innerHTML = "";
  try{
    const data = await api(`/ranking?canciones=${rankingVisto}&limite=${LIMITE_RANKING}&periodo=${periodoVisto}`
      + (generoVisto && !hoy ? "&genero=" + generoVisto : "") + (ligaVista ? "&liga=" + ligaVista : ""));
    if(turno !== turnoRanking) return;       // cambiaron de pestaña mientras cargaba
    renderYo(data);
    if(!data.length){
      lista.innerHTML = `<p class="rk-vacio">Todavía nadie ${liga ? "de la liga " : ""}jugó ${deQue()}. ¡Podés ser el primero!${
        generoVisto && !hoy ? "<br>Cuentan las partidas de 10 canciones jugadas solo con ese género." : ""}</p>`;
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
    // las filas entran escalonadas, después del podio (hasta 10: el resto, todas juntas)
    lista.innerHTML = resto.map((f, i)=> `<div class="rk-row ${f.es_mio ? "mio" : ""}" style="animation-delay:${(0.45 + Math.min(i, 10) * 0.03).toFixed(2)}s">
        <span class="pos">${f.puesto}</span>
        <span class="nom">${esc(f.nombre)}${f.es_mio ? " <small>(vos)</small>" : ""}${hoy && f.segundos ? cuadritos(f.segundos, true) : ""}</span>
        <span class="pt">${f.puntos}</span>
      </div>`).join("");
  }catch(e){
    track("error_cuenta", { donde: "ranking" });
    if(turno !== turnoRanking) return;
    // La liga ya no existe o la cuenta salió de ella: se vuelve a la tabla de todos
    if(ligaVista){ ligaVista = ""; olvidarLigas(); verRanking(rankingVisto, aviso, undefined, desde); return; }
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
    yo.innerHTML = periodoVisto === "hoy"
      ? `<div class="rk-yo fuera">Todavía no jugaste el desafío de hoy.
          <button type="button" class="btn mag" onclick="jugarDesafio()">▶ Jugar el desafío</button></div>`
      : `<div class="rk-yo fuera">Todavía no jugaste ${deQue()} con tu cuenta.</div>`;
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
  entrarConGoogle: entrar, salirDeCuenta: salir, editarNombre, guardarNombre, verRanking,
  filtrarRanking, ligaCrear, ligaUnirse, ligaSalir, ligaCompartir, verRankingDeLiga,
});
