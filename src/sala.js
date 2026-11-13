// Pulsadores: con amigos, cada equipo toca "¡YO!" en su celular.
//
// El que maneja la partida abre una sala (un código de 4 letras) y los demás
// entran desde su celular con ?sala=CÓDIGO, eligen equipo y les queda un botón
// gigante. Gana el primero que llega a la base (public.sala_pulsar), no el
// que el dueño de casa cree haber escuchado antes.
//
// No hay conexión en tiempo real: los celulares no preguntan nada, solo avisan
// cuando tocan, y la respuesta les dice si llegaron primeros. El único que
// pregunta es el que maneja la partida, y solo mientras hay una canción
// sonando o esperando que alguien arriesgue.
import { api, apiSuave } from "./api.js";
import { esc } from "./utils.js";
import { track } from "./analytics.js";
import { animar, calmo, temblar } from "./motion.js";

export const LINK_SALA = "https://enunanota.com.ar/?sala=";

/* ============================================================
   EL QUE MANEJA LA PARTIDA
   ============================================================ */
let sala = null;        // { codigo, clave }
let escucha = null;     // el timeout de la próxima pregunta
let abierta = false;    // la base tiene los pulsadores abiertos (hasta que se le avisa que cierre)

export const salaActual = ()=> sala;

// Abre la sala con esos equipos. Devuelve el código, o null si no se pudo.
export async function abrirSala(equipos){
  const r = await apiSuave("/sala/crear", { equipos });
  if(!r || !r.codigo) return null;
  sala = r; abierta = false; limpia = true;
  track("sala", { accion: "abrir", equipos: equipos.length });
  return sala.codigo;
}
export function cerrarSala(){
  dejarDeEscuchar();
  if(sala && abierta) apiSuave("/sala/ronda", { codigo: sala.codigo, clave: sala.clave, abierta: false });
  sala = null; abierta = false;
}

// Empieza a sonar una canción: se puede pulsar. alPulsar(equipo) se llama una
// sola vez, con el índice del equipo que llegó primero.
export function abrirPulsadores(equipos, alPulsar){
  if(!sala) return;
  dejarDeEscuchar();
  abierta = true; limpia = false;
  const s = sala;
  const turno = (s.turno = (s.turno || 0) + 1);
  const empezo = Date.now();
  const preguntar = async ()=>{
    if(sala !== s || s.turno !== turno || !abierta) return;
    const e = await apiSuave("/sala/estado", { codigo: s.codigo, clave: s.clave });
    if(sala !== s || s.turno !== turno || !abierta) return;
    // Pulsó alguien: se deja de preguntar. La base sigue abierta hasta que
    // main.js cierre la ronda, así a los que llegan después les dice quién ganó.
    if(e && Number.isInteger(e.primero)){ escucha = null; s.turno++; alPulsar(e.primero); return; }
    // Seguido al principio, que es cuando alguien la saca; más espaciado si
    // nadie arriesga, y a los 5 minutos se deja de preguntar.
    const pasado = Date.now() - empezo;
    if(pasado > 5 * 60 * 1000) return;
    escucha = setTimeout(preguntar, pasado < 20000 ? 450 : pasado < 90000 ? 1000 : 2500);
  };
  // La primera pregunta sale recién cuando la base ya abrió la ronda
  apiSuave("/sala/ronda", { codigo: s.codigo, clave: s.clave, abierta: true, equipos })
    .then(()=>{ escucha = setTimeout(preguntar, 300); });
}
// Ya eligieron quién canta (o se salteó): nadie más puede pulsar. El que
// ganó lo sigue viendo en su celular hasta que la canción termina, que es
// cuando se llama con limpiar.
let limpia = true;      // la base no recuerda a nadie de una canción anterior
export function cerrarPulsadores(limpiar){
  dejarDeEscuchar();
  if(!sala || (!abierta && (!limpiar || limpia))) return;
  abierta = false;
  limpia = Boolean(limpiar);
  apiSuave("/sala/ronda", { codigo: sala.codigo, clave: sala.clave, abierta: false, limpiar: Boolean(limpiar) });
}
function dejarDeEscuchar(){
  if(escucha){ clearTimeout(escucha); escucha = null; }
  if(sala) sala.turno = (sala.turno || 0) + 1;
}

// El cartel de Armar partida con el código, para que se sumen
export function invitacionHtml(codigo){
  return `<div class="sala-inv">
      <span class="eyebrow">Que entren desde su celular</span>
      <span class="sala-cod" aria-label="Código de la sala: ${codigo.split("").join(" ")}">${codigo.split("").map((l, i)=> `<b style="--i:${i}">${l}</b>`).join("")}</span>
      <span class="tarjeta-d">enunanota.com.ar/?sala=${codigo}</span>
      <button type="button" class="btn ghost mini" onclick="compartirSala()">📲 Mandar el link al grupo</button>
    </div>`;
}
export async function compartirSala(){
  if(!sala) return;
  const url = LINK_SALA + sala.codigo;
  const text = "🎤 Entrá desde tu celular para tocar ¡YO! en “En una nota”:";
  track("sala", { accion: "compartir" });
  if(navigator.share){
    try{ await navigator.share({ title: "En una nota · pulsadores", text, url }); return; }
    catch(e){ if(e && e.name === "AbortError") return; }
  }
  try{ await navigator.clipboard.writeText(text + " " + url); alert("¡Link copiado! Pegalo en el grupo."); }
  catch(_){ prompt("Copiá el link y mandalo al grupo:", url); }
}

// Un pitido corto cuando alguien pulsa (y cuando se acaba el tiempo para cantar)
let audio = null;
export function pitido(tono = 880, ms = 160){
  try{
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "triangle"; o.frequency.value = tono;
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  }catch(_){}
}

/* ============================================================
   EL CELULAR QUE PULSA
   Una pantalla aparte (#s-pulsador): elegir equipo y el botón.
   ============================================================ */
const SS_EQUIPO = "eun_sala_equipo_v1";   // { codigo, equipo }: al recargar sigue en su equipo
let mia = null;          // { codigo, equipos, equipo }
let enviando = false, vuelve = null;

// El código de ?sala=…, o null. Se saca de la barra.
export function salaDelLink(){
  const q = new URLSearchParams(location.search);
  if(!q.has("sala")) return null;
  const c = (q.get("sala") || "").trim().toUpperCase();
  q.delete("sala");
  const resto = q.toString();
  history.replaceState(history.state, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
  return /^[A-Z]{4}$/.test(c) ? c : "";
}

// Entra a la sala y dibuja la pantalla. Devuelve false si la sala no existe.
export async function entrarASala(codigo){
  const box = document.getElementById("pulsador");
  box.innerHTML = `<p class="cargando">Buscando la sala…</p>`;
  const s = codigo ? await apiSuave("/sala?codigo=" + encodeURIComponent(codigo)) : null;
  if(!s){
    box.innerHTML = `<div class="puls-msg"><b>No encontramos esa sala</b>
      <p>Fijate el código en la pantalla del que maneja la partida. Las salas duran unas horas.</p>
      <button type="button" class="btn ghost big" onclick="irA('jugar')">Ir al juego</button></div>`;
    return false;
  }
  mia = { codigo: s.codigo, equipos: s.equipos, equipo: null };
  try{
    const g = JSON.parse(sessionStorage.getItem(SS_EQUIPO));
    if(g && g.codigo === s.codigo && g.equipo < s.equipos.length) mia.equipo = g.equipo;
  }catch(_){}
  track("sala", { accion: "entrar" });
  pintar();
  // Que la pantalla no se apague con el celular apoyado en la mesa
  try{ if(navigator.wakeLock) navigator.wakeLock.request("screen").catch(()=>{}); }catch(_){}
  return true;
}

function elegirEquipo(i){
  if(!mia) return;
  mia.equipo = i;
  try{ sessionStorage.setItem(SS_EQUIPO, JSON.stringify({ codigo: mia.codigo, equipo: i })); }catch(_){}
  pintar();
}
function cambiarEquipo(){ if(mia){ mia.equipo = null; pintar(); } }

function pintar(){
  const box = document.getElementById("pulsador");
  if(mia.equipo === null){
    box.innerHTML = `<p class="hola"><small>Sala ${mia.codigo}</small>¿De qué equipo sos?</p>
      <div class="teamgrid puls-equipos">${mia.equipos.map((n, i)=>
        `<button type="button" class="btn lime big" style="--i:${i}" onclick="salaElegir(${i})">${esc(n)}</button>`).join("")}</div>`;
    return;
  }
  box.innerHTML = `<div class="puls-top">
      <span class="pill">Sala ${mia.codigo}</span>
      <button type="button" class="linkish" onclick="salaCambiar()">${esc(mia.equipos[mia.equipo])} · cambiar</button>
    </div>
    <button type="button" class="puls-btn" id="puls-btn" onclick="salaPulsar()" aria-label="¡Yo! Arriesgar">
      <span class="puls-onda" aria-hidden="true"></span>
      <span class="puls-t">¡YO!</span>
    </button>
    <p class="puls-estado" id="puls-estado" role="status">Tocá cuando sepas cuál es</p>`;
}

const MENSAJES = {
  primero:  "¡Llegaste primero! A cantar 🎤",
  cerrada:  "Todavía no suena nada",
  excluido: "Tu equipo ya arriesgó en esta",
  no:       "La sala ya no existe",
  error:    "No hay conexión. Probá de nuevo",
};
async function pulsar(){
  if(!mia || mia.equipo === null || enviando) return;
  enviando = true;
  const btn = document.getElementById("puls-btn"), est = document.getElementById("puls-estado");
  clearTimeout(vuelve);
  btn.className = "puls-btn";
  // La respuesta al toque es inmediata; el resultado llega con la base
  animar(btn, [{ transform: "scale(.94)" }, { transform: "scale(1)" }], { duration: 160, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  let r;
  try{ r = await api("/sala/yo", { codigo: mia.codigo, equipo: mia.equipo }); }
  catch(_){ r = { estado: "error" }; }
  enviando = false;
  if(!document.getElementById("puls-btn")) return;      // cambió de pantalla mientras tanto
  if(Array.isArray(r.equipos)) mia.equipos = r.equipos;
  const estado = r.estado || "error";
  btn.classList.add(estado);
  est.textContent = estado === "tarde"
    ? "Llegó antes " + (mia.equipos[r.primero] || "otro equipo")
    : MENSAJES[estado] || MENSAJES.error;
  if(estado === "primero"){
    try{ navigator.vibrate && navigator.vibrate([60, 40, 120]); }catch(_){}
    const onda = btn.querySelector(".puls-onda");
    if(!calmo()) animar(onda, [{ transform: "scale(1)", opacity: 0.55 }, { transform: "scale(1.7)", opacity: 0 }],
      { duration: 700, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  } else if(estado === "tarde" || estado === "excluido"){
    temblar(btn);
  }
  track("sala", { accion: "pulsar", estado });
  vuelve = setTimeout(()=>{
    const b = document.getElementById("puls-btn"), e = document.getElementById("puls-estado");
    if(b) b.className = "puls-btn";
    if(e) e.textContent = "Tocá cuando sepas cuál es";
  }, estado === "primero" ? 6000 : 2500);
}

Object.assign(window, { salaElegir: elegirEquipo, salaCambiar: cambiarEquipo, salaPulsar: pulsar, compartirSala });
