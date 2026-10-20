// Cuentas con Google y ranking del modo un jugador, sobre Supabase.
//
// Entrar es opcional: sin cuenta se juega igual que siempre. Con cuenta, cada
// partida de un jugador se guarda (el historial) y el mejor puntaje de cada uno
// entra al ranking, que hay uno por cantidad de canciones — 40 puntos en 5
// canciones no se comparan con 40 en 20 — y por período: la semana (desde el
// lunes), el mes (desde el 1) o de siempre. Las tablas y las reglas de acceso
// están en supabase/migrations/.
//
// URL y clave publicable salen del proyecto en supabase.com (Project Settings →
// API). La clave publicable es pública a propósito: lo que protege los datos
// son las reglas de la base. Vaciarlas apaga las cuentas y el ranking.
import { esc } from "./utils.js";
import { soloTramo } from "./sharecard.js";
import { track } from "./analytics.js";

const SUPABASE_URL = "https://cebmgdrrfagsbrfyeqqm.supabase.co";
const SUPABASE_KEY = "sb_publishable_GK8qADTCcOrWDGWit99ubQ_P6d52nWh";
export const cuentasActivas = Boolean(SUPABASE_URL && SUPABASE_KEY);

const LS_SESION = "eun_sesion_v1";             // donde supabase-js guarda la sesión
const LS_PENDIENTE = "eun_partida_pendiente_v1";
const PENDIENTE_VENCE_MS = 60 * 60 * 1000;    // una partida sin guardar de hace más de una hora ya no va
const OPCIONES_CANCIONES = [5, 10, 15, 20, 30, 0];  // las mismas que el select de Opciones; 0 = sin límite
const LIMITE_RANKING = 20;
// Los de ranking_solo(): la semana arranca el lunes y el mes el 1, a las 0 h de Argentina
const PERIODOS = [
  { id: "semana",  boton: "Semana",    titulo: "semanal",   cuando: "esta semana" },
  { id: "mes",     boton: "Mes",       titulo: "mensual",   cuando: "este mes" },
  { id: "siempre", boton: "Histórico", titulo: "histórico", cuando: "" },
];
const periodo = (id)=> PERIODOS.find(p=> p.id === id) || PERIODOS[2];

let usuario = null;          // { id, nombre } con la sesión abierta
let partidaFinal = null;     // { id, canciones } de la partida que se acaba de terminar, si entra al ranking
let rankingVisto = 10;
let periodoVisto = "semana";
let mostrar = ()=>{};        // show() de main.js

// supabase-js pesa: se baja recién cuando hace falta (ya hay sesión, se vuelve
// de Google, o se abre el ranking). El que nunca entra no lo descarga.
let clientePromesa = null;
function cliente(){
  if(!clientePromesa){
    clientePromesa = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { flowType: "pkce", storageKey: LS_SESION, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }));
  }
  return clientePromesa;
}
function haySesionGuardada(){
  try{ return Boolean(localStorage.getItem(LS_SESION)); }catch(_){ return false; }
}
function volviendoDeGoogle(){
  const q = new URLSearchParams(location.search);
  return q.has("code") || q.has("error_description");
}
// Google vuelve con ?code=… (o ?error=…): se saca de la barra para que no quede
// en un link compartido ni en el historial. Los demás parámetros (?interno=1) quedan.
function limpiarUrl(){
  const q = new URLSearchParams(location.search);
  ["code", "error", "error_code", "error_description"].forEach(k=> q.delete(k));
  const resto = q.toString();
  history.replaceState(history.state, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
}

/* ============================================================
   SESIÓN
   ============================================================ */
let alCambiar = ()=>{};      // main.js: rehace el saludo del inicio y Mi cuenta
// main.js: los géneros favoritos de este navegador ({ leer, tomar })
let favoritos = { leer: ()=> [], tomar: ()=>{} };

export async function iniciarCuentas(opciones){
  mostrar = opciones.show;
  alCambiar = opciones.alCambiar || alCambiar;
  favoritos = opciones.favoritos || favoritos;
  if(!cuentasActivas) return;
  document.getElementById("tab-ranking").hidden = false;
  renderCuenta();
  const vuelve = volviendoDeGoogle();
  if(!vuelve && !haySesionGuardada()) return;
  try{
    const sb = await cliente();
    const { data } = await sb.auth.getSession();   // espera el canje del ?code=
    if(vuelve){
      const fallo = new URLSearchParams(location.search).get("error_description");
      limpiarUrl();
      track("cuenta", { accion: data.session ? "entro" : "cancelo", detalle: fallo || "" });
    }
    await tomarSesion(data.session);
    // supabase-js pide no llamarse a sí mismo dentro de este aviso: va al próximo turno
    sb.auth.onAuthStateChange((_ev, sesion)=>{ setTimeout(()=> tomarSesion(sesion), 0); });
    if(usuario) await guardarPendiente();
  }catch(e){
    console.warn("[cuenta]", e);
  }
}

export const usuarioActual = ()=> usuario;

async function tomarSesion(sesion){
  const id = sesion && sesion.user ? sesion.user.id : null;
  if(!id){
    if(!usuario) return;
    usuario = null; olvidarCache(); renderCuenta(); return;
  }
  if(usuario && usuario.id === id) return;
  const sb = await cliente();
  const { data } = await sb.from("perfiles").select("nombre, generos").eq("id", id).maybeSingle();
  const suyos = data && Array.isArray(data.generos) ? data.generos : [];
  usuario = { id, nombre: data ? data.nombre : "Jugador", generos: suyos };
  // Mandan los de la cuenta; si todavía no tiene, se le pasan los de este navegador
  if(suyos.length) favoritos.tomar(suyos);
  else if(data && favoritos.leer().length) guardarFavoritos(favoritos.leer());
  olvidarCache();
  renderCuenta();
}

// desde: inicio | final | ranking | cuenta
async function entrar(desde){
  track("cuenta", { accion: "entrar", desde });
  // Desde la pantalla final, la partida que acaban de jugar se guarda al volver
  if(desde === "final" && partidaFinal){
    try{ localStorage.setItem(LS_PENDIENTE, JSON.stringify({ ...partidaFinal, cuando: Date.now() })); }catch(_){}
  }
  try{
    const sb = await cliente();
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
    if(error) throw error;
  }catch(e){
    alert("No pudimos abrir el ingreso con Google. Probá de nuevo en un rato.");
  }
}

async function salir(){
  track("cuenta", { accion: "salir" });
  try{ const sb = await cliente(); await sb.auth.signOut(); }catch(_){}
  usuario = null;
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
  const sb = await cliente();
  const { error } = await sb.from("perfiles").update({ nombre: nuevo }).eq("id", usuario.id);
  if(btn) btn.disabled = false;
  if(error){ alert("No pudimos cambiar el nombre. Probá de nuevo."); return; }
  usuario.nombre = nuevo;
  track("cuenta", { accion: "renombrar" });
  renderCuenta();
}

// Géneros favoritos: los marca main.js en Mi cuenta y acá van a la cuenta. Van
// en fila, uno detrás del otro, y cada uno manda lo último que se marcó: así
// el que llega último a la base es siempre el más nuevo.
let colaFavoritos = Promise.resolve();
export function guardarFavoritos(ids){
  if(!usuario) return;
  const u = usuario;
  u.generos = ids.slice(0, 30);
  colaFavoritos = colaFavoritos.then(async ()=>{
    if(usuario !== u) return;
    const sb = await cliente();
    const { error } = await sb.from("perfiles").update({ generos: u.generos }).eq("id", u.id);
    if(error) console.warn("[cuenta]", error);
  }).catch(e=> console.warn("[cuenta]", e));
}

const LOGO_G = `<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
function botonGoogle(desde, texto){
  return `<button type="button" class="btn google" onclick="entrarConGoogle('${desde}')">${LOGO_G}<span>${texto}</span></button>`;
}
// "Juan P." → "JP"
function iniciales(nombre){
  const p = String(nombre).replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).filter(Boolean);
  return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
}

// Lo que depende de la sesión: el avatar de arriba y Mi cuenta
function renderCuenta(){
  const nav = document.getElementById("nav-cuenta");
  if(nav){
    nav.innerHTML = !cuentasActivas ? ""
      : usuario
        ? `<button type="button" class="av" onclick="irA('cuenta')" aria-label="Mi cuenta: ${esc(usuario.nombre)}">${esc(iniciales(usuario.nombre))}</button>`
        : botonGoogle("inicio", "Entrar");
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
let misPartidas = null;        // cache: [{ canciones, segundos, puntos, jugada }], más nuevas primero
let puestos = {};              // cache: { "canciones/período": fila de ranking_solo con es_mio, o null }
function olvidarCache(){ misPartidas = null; puestos = {}; }

async function cargarMisPartidas(){
  if(misPartidas) return misPartidas;
  const sb = await cliente();
  const { data, error } = await sb.from("partidas_solo")
    .select("canciones, segundos, puntos, jugada")
    .order("jugada", { ascending: false }).limit(500);
  if(error) throw error;
  misPartidas = data || [];
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
    <div id="cuenta-favs"></div>
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
      <div class="lbl">Tus récords</div>
      <div class="rec">${OPCIONES_CANCIONES.map(n=> `<div class="${mejores[n] ? "" : "none"}" data-rec="${n}">
          ${n ? n + " canciones" : "Sin límite"}<b>${mejores[n] || "—"}</b><span class="pos">${mejores[n] ? "…" : ""}</span></div>`).join("")}</div>
      <div class="lbl">Últimas partidas</div>
      <div class="hist">${partidas.slice(0, 5).map(p=> `<div class="hist-row">
          ${cuadritos(p.segundos, true)}<b>${p.puntos}</b>
          <small>${fechaCorta(p.jugada)} · ${p.canciones ? p.canciones + " canciones" : "sin límite"}</small></div>`).join("")}</div>`;
    // el puesto de cada récord, de a uno a medida que llegan
    OPCIONES_CANCIONES.filter(n=> mejores[n]).forEach(async n=>{
      const mio = await miPuesto(n);
      if(turno !== turnoCuenta) return;
      const celda = box.querySelector(`[data-rec="${n}"] .pos`);
      if(celda) celda.textContent = mio ? "#" + mio.puesto : "";
    });
  }catch(e){
    if(turno !== turnoCuenta) return;
    document.getElementById("cuenta-datos").innerHTML = `<p class="cargando">No pudimos cargar tus partidas.</p>`;
  }
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

// Sin cuenta no hace falta supabase-js: alcanza un POST con la clave publicable.
async function rpc(nombre, args){
  if(clientePromesa){
    const sb = await cliente();
    const { data, error } = await sb.rpc(nombre, args);
    if(error) throw error;
    return data;
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if(!r.ok) throw new Error(nombre + ": " + r.status);
  return r.json();
}
// Los pasos van en orden: cada uno sale recién cuando volvió el anterior.
function paso(p, nombre, args){
  p.cola = p.cola.then(async ()=>{
    if(!p.valida) return;
    if(!await rpc(nombre, { p_partida: p.id, ...args })) p.valida = false;
  }).catch(()=>{ p.valida = false; });
}

export function soloEmpezar(canciones){
  enCurso = null;
  if(!cuentasActivas) return;
  const p = { canciones, id: null, valida: true, propias: false };
  p.cola = rpc("solo_empezar", { p_canciones: canciones })
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
  paso(p, "solo_sonar", { p_video: video });
}
// titulo: el que eligió, normalizado como en el catálogo; null si no salió.
export function soloResolvio(segundos, titulo){
  const p = enCurso;
  if(p && p.valida) paso(p, "solo_resolver", { p_segundos: segundos, p_titulo: titulo });
}

async function guardarPartida(p){
  const puntos = await rpc("solo_terminar", { p_partida: p.id });
  if(puntos === null) throw new Error("partida vencida");
  olvidarCache();
  const mio = await miPuesto(p.canciones);
  track("partida_guardada", {
    canciones_por_partida: p.canciones, puntos, puesto: mio ? Number(mio.puesto) : 0,
  });
  return { puntos, mio };
}
async function miFilaDelRanking(canciones, per){
  const sb = await cliente();
  const { data } = await sb.rpc("ranking_solo", { p_canciones: canciones, p_limite: 1, p_periodo: per });
  return (data || []).find(f=> f.es_mio) || null;
}

// Volvió de Google desde la pantalla final: se guarda esa partida y se muestra dónde quedó.
async function guardarPendiente(){
  let p = null;
  try{ p = JSON.parse(localStorage.getItem(LS_PENDIENTE)); localStorage.removeItem(LS_PENDIENTE); }catch(_){}
  if(!p || !p.id || Date.now() - (p.cuando || 0) > PENDIENTE_VENCE_MS) return;
  try{
    await guardarPartida(p);
    verRanking(p.canciones, "Guardamos tu partida 🎧", "semana");
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
  if(!usuario){
    el.innerHTML = `<p class="hint" style="margin:0 0 10px">¿Querés aparecer en el ranking? Entrá y guardamos esta partida.</p>
      ${botonGoogle("final", "Entrar con Google y guardarla")}`;
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
    el.innerHTML = `<button type="button" class="tarjeta" style="border:0;padding:0;background:none" onclick="verRanking(${canciones}, '', 'semana')">
        <span class="grow"><span class="eyebrow">Ranking${de}</span><span class="tarjeta-t">${txt}</span>${historico}</span>
        <span class="pill amber">Ver ›</span></button>`;
  }catch(e){
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
const deQue = ()=> (rankingVisto ? "con " + rankingVisto + " canciones" : "sin límite")
  + (periodo(periodoVisto).cuando ? " " + periodo(periodoVisto).cuando : "");

let turnoRanking = 0;
// per: semana | mes | siempre; sin él queda el último que se miró
export async function verRanking(canciones, aviso, per){
  if(!cuentasActivas) return;
  rankingVisto = OPCIONES_CANCIONES.includes(Number(canciones)) ? Number(canciones) : 10;
  if(PERIODOS.some(p=> p.id === per)) periodoVisto = per;
  if(!document.getElementById("s-ranking").classList.contains("on")) mostrar("s-ranking");
  track("ranking_visto", { canciones_por_partida: rankingVisto, periodo: periodoVisto });
  const turno = ++turnoRanking;
  document.getElementById("rk-aviso").textContent = aviso || "";
  document.getElementById("rk-aviso").hidden = !aviso;
  document.getElementById("rk-periodos").innerHTML = PERIODOS.map(p=>
    `<button type="button" aria-pressed="${p.id === periodoVisto}" onclick="verRanking(${rankingVisto}, '', '${p.id}')">${p.boton}</button>`).join("");
  document.getElementById("rk-tabs").innerHTML = OPCIONES_CANCIONES.map(n=>
    `<button type="button" aria-pressed="${n === rankingVisto}" onclick="verRanking(${n})"${n ? "" : ' aria-label="Sin límite"'}>${n || "∞"}</button>`).join("");
  document.getElementById("rk-titulo").textContent = `Ranking ${periodo(periodoVisto).titulo} · ` + nombreOpcion(rankingVisto).toLowerCase();
  document.getElementById("rk-sub").textContent = "Un jugador · el mejor puntaje de cada cuenta"
    + (periodo(periodoVisto).cuando ? " " + periodo(periodoVisto).cuando : "");
  const podio = document.getElementById("rk-podio");
  const lista = document.getElementById("rk-lista");
  const yo = document.getElementById("rk-yo");
  podio.innerHTML = "";
  lista.innerHTML = `<p class="rk-vacio">Cargando…</p>`;
  yo.innerHTML = "";
  try{
    const sb = await cliente();
    const { data, error } = await sb.rpc("ranking_solo", { p_canciones: rankingVisto, p_limite: LIMITE_RANKING, p_periodo: periodoVisto });
    if(error) throw error;
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
    if(turno !== turnoRanking) return;
    lista.innerHTML = `<p class="rk-vacio">No pudimos cargar el ranking. Probá de nuevo en un rato.</p>`;
  }
}
// Tu fila: puesto, puntos y cuánto te falta para el de arriba
function renderYo(data){
  const yo = document.getElementById("rk-yo");
  if(!usuario){
    yo.innerHTML = `<div class="rk-yo fuera">Entrá con Google para aparecer acá${botonGoogle("ranking", "Entrar con Google")}</div>`;
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
  entrarConGoogle: entrar, salirDeCuenta: salir, editarNombre, guardarNombre, verRanking,
});
