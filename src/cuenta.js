// Cuentas con Google y ranking del modo un jugador, sobre Supabase.
//
// Entrar es opcional: sin cuenta se juega igual que siempre. Con cuenta, cada
// partida de un jugador se guarda (el historial) y el mejor puntaje de cada uno
// entra al ranking, que hay uno por cantidad de canciones — 40 puntos en 5
// canciones no se comparan con 40 en 20. Las tablas y las reglas de acceso
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

let usuario = null;          // { id, nombre } con la sesión abierta
let partidaFinal = null;     // { canciones, segundos } de la partida que se acaba de terminar
let rankingVisto = 10;
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
export async function iniciarCuentas(opciones){
  mostrar = opciones.show;
  if(!cuentasActivas) return;
  document.getElementById("ranking-btn").hidden = false;
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

async function tomarSesion(sesion){
  const id = sesion && sesion.user ? sesion.user.id : null;
  if(!id){ usuario = null; renderCuenta(); return; }
  if(usuario && usuario.id === id) return;
  const sb = await cliente();
  const { data } = await sb.from("perfiles").select("nombre").eq("id", id).maybeSingle();
  usuario = { id, nombre: data ? data.nombre : "Jugador" };
  renderCuenta();
}

// desde: inicio | final | ranking
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
  renderCuenta();
}

async function renombrar(){
  if(!usuario) return;
  const nuevo = (prompt("¿Con qué nombre querés aparecer en el ranking?", usuario.nombre) || "").trim().slice(0, 30);
  if(!nuevo || nuevo === usuario.nombre) return;
  const sb = await cliente();
  const { error } = await sb.from("perfiles").update({ nombre: nuevo }).eq("id", usuario.id);
  if(error){ alert("No pudimos cambiar el nombre. Probá de nuevo."); return; }
  usuario.nombre = nuevo;
  track("cuenta", { accion: "renombrar" });
  renderCuenta();
  if(document.getElementById("s-ranking").classList.contains("on")) verRanking(rankingVisto);
}

const LOGO_G = `<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;
function botonGoogle(desde, texto){
  return `<button type="button" class="btn google" onclick="entrarConGoogle('${desde}')">${LOGO_G}<span>${texto}</span></button>`;
}

// La barrita del inicio
function renderCuenta(){
  const el = document.getElementById("cuenta-bar");
  if(!el) return;
  el.hidden = !cuentasActivas;
  el.innerHTML = usuario
    ? `<span>👤 <b>${esc(usuario.nombre)}</b>
         <button type="button" class="linkish" onclick="renombrarCuenta()" aria-label="Cambiar el nombre del ranking">✏️</button></span>
       <button type="button" class="btn ghost mini" onclick="salirDeCuenta()">Salir</button>`
    : `<span class="cuenta-txt">Entrá para guardar tus partidas y aparecer en el ranking</span>
       ${botonGoogle("inicio", "Entrar con Google")}`;
}

/* ============================================================
   PARTIDAS
   segundos: uno por canción resuelta, los que hicieron falta para sacarla
   (1 a 6) o 0 si no salió. Los puntos los calcula la base con eso.
   ============================================================ */
async function guardarPartida(p){
  const sb = await cliente();
  const { data, error } = await sb.from("partidas_solo")
    .insert({ canciones: p.canciones, segundos: p.segundos })
    .select("puntos").single();
  if(error) throw error;
  const mio = await miFilaDelRanking(p.canciones);
  track("partida_guardada", {
    canciones_por_partida: p.canciones, puntos: data.puntos, puesto: mio ? Number(mio.puesto) : 0,
  });
  return { puntos: data.puntos, mio };
}
async function miFilaDelRanking(canciones){
  const sb = await cliente();
  const { data } = await sb.rpc("ranking_solo", { p_canciones: canciones, p_limite: 1 });
  return (data || []).find(f=> f.es_mio) || null;
}

// Volvió de Google desde la pantalla final: se guarda esa partida y se muestra dónde quedó.
async function guardarPendiente(){
  let p = null;
  try{ p = JSON.parse(localStorage.getItem(LS_PENDIENTE)); localStorage.removeItem(LS_PENDIENTE); }catch(_){}
  if(!p || !Array.isArray(p.segundos) || Date.now() - (p.cuando || 0) > PENDIENTE_VENCE_MS) return;
  try{
    await guardarPartida(p);
    verRanking(p.canciones, "Guardamos tu partida 🎧");
  }catch(e){ console.warn("[cuenta]", e); }
}

// Pantalla final. canciones = null en el modo con amigos (no hay ranking).
let turnoFinal = 0;
export async function rankingFinal(canciones, segundos){
  const el = document.getElementById("ranking-final");
  const turno = ++turnoFinal;
  partidaFinal = null;
  el.hidden = true;
  if(!cuentasActivas || canciones === null || !segundos.length) return;
  partidaFinal = { canciones, segundos };
  el.hidden = false;
  if(!usuario){
    el.innerHTML = `<p class="hint" style="margin:0 0 10px">¿Querés aparecer en el ranking? Entrá y guardamos esta partida.</p>
      ${botonGoogle("final", "Entrar con Google y guardarla")}`;
    return;
  }
  el.innerHTML = `<p class="hint" style="margin:0">Guardando en el ranking…</p>`;
  try{
    const { puntos, mio } = await guardarPartida(partidaFinal);
    if(turno !== turnoFinal) return;          // ya arrancó otra partida
    const de = canciones ? ` con ${canciones} canciones` : " sin límite";
    const txt = !mio ? "Partida guardada."
      : mio.puntos === puntos ? `🏆 Quedaste <b>#${mio.puesto}</b> en el ranking${de}.`
      : `Partida guardada. Tu mejor${de} (${mio.puntos} puntos) está <b>#${mio.puesto}</b>.`;
    el.innerHTML = `<p class="hint" style="margin:0 0 10px">${txt}</p>
      <button type="button" class="btn ghost big" onclick="verRanking(${canciones})">🏆 Ver el ranking</button>`;
  }catch(e){
    if(turno !== turnoFinal) return;
    el.innerHTML = `<p class="hint" style="margin:0">No pudimos guardar la partida en el ranking 😕</p>`;
  }
}

/* ============================================================
   RANKING
   ============================================================ */
const nombreOpcion = (n)=> n ? n + " canciones" : "Sin límite";

export async function verRanking(canciones, aviso){
  if(!cuentasActivas) return;
  rankingVisto = OPCIONES_CANCIONES.includes(Number(canciones)) ? Number(canciones) : 10;
  if(!document.getElementById("s-ranking").classList.contains("on")) mostrar("s-ranking");
  track("ranking_visto", { canciones_por_partida: rankingVisto });
  document.getElementById("rk-aviso").textContent = aviso || "";
  document.getElementById("rk-tabs").innerHTML = OPCIONES_CANCIONES.map(n=>
    `<button type="button" class="rk-tab" aria-pressed="${n === rankingVisto}" onclick="verRanking(${n})">${n || "∞"}</button>`).join("");
  document.getElementById("rk-titulo").textContent = "🎧 Un jugador · " + nombreOpcion(rankingVisto);
  const lista = document.getElementById("rk-lista");
  lista.innerHTML = `<p class="hint" style="margin:0">Cargando…</p>`;
  renderMias();
  try{
    const sb = await cliente();
    const { data, error } = await sb.rpc("ranking_solo", { p_canciones: rankingVisto, p_limite: LIMITE_RANKING });
    if(error) throw error;
    if(!data.length){
      lista.innerHTML = `<p class="hint" style="margin:0">Todavía nadie jugó${rankingVisto ? " con " + rankingVisto + " canciones" : " sin límite"}. ¡Podés ser el primero!</p>`;
      return;
    }
    const medallas = ["🥇", "🥈", "🥉"];
    lista.innerHTML = data.map((f, i)=>`
      ${i > 0 && f.puesto - data[i-1].puesto > 1 ? `<div class="rk-salto">⋯</div>` : ""}
      <div class="brow ${f.es_mio ? "cur" : ""}">
        <span>${medallas[f.puesto - 1] || `<span class="rk-n">${f.puesto}.</span>`} ${esc(f.nombre)}${f.es_mio ? " <small>(vos)</small>" : ""}</span>
        <span class="pts">${f.puntos}</span>
      </div>`).join("");
  }catch(e){
    lista.innerHTML = `<p class="hint" style="margin:0">No pudimos cargar el ranking. Probá de nuevo en un rato.</p>`;
  }
}

// Tus partidas: las últimas, de la cantidad de canciones que se está mirando
async function renderMias(){
  const box = document.getElementById("rk-mias");
  if(!usuario){
    box.innerHTML = `<p class="hint" style="margin:0 0 10px">Entrá con tu cuenta de Google para guardar tus partidas y aparecer acá.</p>
      ${botonGoogle("ranking", "Entrar con Google")}`;
    return;
  }
  box.innerHTML = `<p class="hint" style="margin:0">Cargando…</p>`;
  const pedido = rankingVisto;
  try{
    const sb = await cliente();
    const { data, error } = await sb.from("partidas_solo")
      .select("puntos, segundos, jugada").eq("canciones", pedido)
      .order("jugada", { ascending: false }).limit(15);
    if(error) throw error;
    if(pedido !== rankingVisto) return;      // cambiaron de pestaña mientras cargaba
    if(!data.length){
      box.innerHTML = `<p class="hint" style="margin:0">Todavía no jugaste${pedido ? " con " + pedido + " canciones" : " sin límite"} con tu cuenta.</p>`;
      return;
    }
    const fecha = (d)=> new Date(d).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
    box.innerHTML = data.map(p=>`
      <div class="brow">
        <span><small class="rk-fecha">${fecha(p.jugada)}</small>
          <span class="tira">${p.segundos.map(s=> soloTramo({ ok: s > 0, seg: s }).emoji).join("")}</span></span>
        <span class="pts">${p.puntos}</span>
      </div>`).join("");
  }catch(e){
    box.innerHTML = `<p class="hint" style="margin:0">No pudimos cargar tus partidas.</p>`;
  }
}

// Los onclick del HTML llaman funciones globales (como en main.js)
Object.assign(window, {
  entrarConGoogle: entrar, salirDeCuenta: salir, renombrarCuenta: renombrar, verRanking,
});
