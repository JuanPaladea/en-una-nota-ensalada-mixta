import "./styles.css";
import { GENRES } from "./data.js";
import { RELLENO } from "./relleno.js";
import { load, save, songKey, esc, extractVideoId, norm } from "./utils.js";
import { idbPut, idbGet, idbDel } from "./idb.js";
import { shareCard, drawCard, drawSoloCard, soloTramo } from "./sharecard.js";
import { track, trackAlSalir } from "./analytics.js";
import { SHARE_URL, shareGame } from "./share.js";
import { nombreGenero, favoritosHtml } from "./favoritos.js";
import { iniciarCuentas, rankingFinal, soloEmpezar, soloSono, soloResolvio, verRanking, usuarioActual, miPuesto, renderMiCuenta, cuentasActivas, partidaLista } from "./cuenta.js";
import "./extras.css";
import { apiSuave } from "./api.js";
import { estadisticasHtml, logrosNuevos, logroNuevoHtml } from "./logros.js";
import { armarFija, traerDesafio, desafioEnMemoria, diaProvisional, desafioLocal, guardarDesafioLocal, rachaDesafio, tarjetaDesafioHtml, fechaCorta,
  traerDuelo, crearDuelo, anotarDuelo, dueloLocal, nombreParaDuelo, rivalDe, tablaDueloHtml, veredicto, LINK_DUELO } from "./fijas.js";
import { codigoDelLink } from "./ligas.js";
import { abrirSala, cerrarSala, salaActual, abrirPulsadores, cerrarPulsadores, invitacionHtml, pitido, salaDelLink, entrarASala } from "./sala.js";
import { animar, entrar, golpe, flotar, volar, cancelarVuelos, contar, fijar, temblar, papelitos, pastilla, indicadorTabs } from "./motion.js";

/* ============================================================
   ESTADO
   ============================================================ */
const LS_LINKS = "eun_links_v1";
const LS_CUSTOM = "eun_custom_v1";
const LS_LOCAL = "eun_local_v1";
const LS_HISTORY = "eun_played_hist_v1";
const LS_TEAMS = "eun_teams_v1";
const LS_JUGADO = "eun_jugado_v1";
const LS_MODO = "eun_modo_v1";
const LS_RECORD = "eun_record_solo_v1";
const LS_ULTIMA = "eun_ultima_v1";
const LS_PENALTY = "eun_resta_v1";
const LS_POR_GENERO = "eun_por_genero_v1";
const LS_ADIVINA = "eun_adivina_v1";     // un jugador: qué se escribe, 'titulo' o 'artista'
const LS_TIEMPO = "eun_tiempo_v1";       // con amigos: segundos para cantar (0 = sin límite)
const LS_PARTIDAS = "eun_partidas_v1";   // las últimas partidas de Un jugador de este navegador (estadísticas y logros)
const LS_PROPIAS = "eun_propias_v2";     // ya se avisó que las canciones propias van con "Mis canciones"
const OPCIONES_CANCIONES = [5, 10, 15, 20, 30, 0];   // canciones por partida; 0 = sin límite
const OPCIONES_TIEMPO = [0, 5, 10, 15];              // segundos para cantar; 0 = sin límite
// Décadas para filtrar: la de 1960 junta todo lo anterior
const DECADAS = [[1960, "60s"], [1970, "70s"], [1980, "80s"], [1990, "90s"], [2000, "2000s"], [2010, "2010s"], [2020, "2020s"]];
const MAX_PARTIDAS_LOCALES = 150;
let links = load(LS_LINKS, {});          // { songKey: videoId }
let customSongs = load(LS_CUSTOM, []);    // [{t,a,gid}]
let localTracks = load(LS_LOCAL, []);     // [{id,t,a}] audio guardado en IndexedDB
let playedHistory = load(LS_HISTORY, []); // keys ya sonadas en partidas anteriores (persiste entre partidas)
let jugado = load(LS_JUGADO, { partidas: 0, canciones: 0 }); // lo jugado en este navegador, para el pedido de Cafecito
let porGenero = load(LS_POR_GENERO, null) || porGeneroDelHistorial();  // { idGénero: canciones que sonaron }, para los géneros favoritos
const localUrls = {};                     // id -> objectURL (cache de sesión)
const memBlobs = {};                      // id -> File (respaldo en memoria si IndexedDB no está disponible)
let selectedGenres = new Set();
// Equipos: los nombres se guardan en localStorage y sobreviven a la revancha,
// al volver al menú principal y a recargar la página (los puntos no).
let teams = loadTeams();                  // [{name, score}]
// La última partida que se armó: para "Repetir la última" y para que Armar
// partida arranque con los mismos géneros y la misma cantidad.
let ultima = load(LS_ULTIMA, null);       // { modo, generos:[ids], canciones }
let opts = {
  noRepeat:true,
  maxSongs: ultima && OPCIONES_CANCIONES.includes(ultima.canciones) ? ultima.canciones : 10,
  penalty: load(LS_PENALTY, false) === true,   // el que arriesga y erra pierde un punto
};
// 'grupo' = equipos, el grupo juzga · 'solo' = se escribe el título y el juego lo comprueba
let modo = load(LS_MODO, "grupo") === "solo" ? "solo" : "grupo";
let record = load(LS_RECORD, {});         // modo solo: { "10": mejor puntaje con 10 canciones, "a10": lo mismo adivinando el artista, ... }
// Un jugador: se escribe el título o quién la canta. Se recuerda.
let adivina = load(LS_ADIVINA, "titulo") === "artista" ? "artista" : "titulo";
// Con amigos: cuánto tiene para cantar el que arriesga (0 = lo que quiera)
let tiempoCantar = OPCIONES_TIEMPO.includes(load(LS_TIEMPO, 0)) ? load(LS_TIEMPO, 0) : 0;
// Décadas elegidas en Armar partida (vacío = todas)
let decadas = new Set(ultima && Array.isArray(ultima.decadas) ? ultima.decadas.filter(d=> DECADAS.some(x=> x[0]===d)) : []);
// Partida con las canciones fijas (el desafío del día o un duelo): ver fijas.js
let fija = null;          // { tipo, total, canciones, suplentes, dia | id, modo }
let partidasLocales = load(LS_PARTIDAS, []);   // [{ canciones, segundos, puntos, jugada, videos, genero, modo, dia }], más nuevas primero
if(!Array.isArray(partidasLocales)) partidasLocales = [];

let pool = [];        // canciones jugables [{t,a,gid,id,key}]
let played = [];      // keys ya jugadas
let currentSong = null;

/* ============================================================
   ALMACENAMIENTO / DATOS DE CANCIONES
   ============================================================ */
// devuelve un objectURL para el id (desde cache, IndexedDB o el File en memoria)
// Se cachea la promesa además del resultado: la precarga y el play pueden pedir
// el mismo id casi a la vez, y sin esto se creaban dos objectURL para el mismo blob.
const localUrlPending = {};
function localUrlFor(id){
  if(localUrls[id]) return Promise.resolve(localUrls[id]);
  if(localUrlPending[id]) return localUrlPending[id];
  localUrlPending[id] = (async ()=>{
    let blob = memBlobs[id];
    if(!blob){ try{ blob = await idbGet(id); }catch(e){ blob=null; } }
    if(!blob) return null;
    const url = URL.createObjectURL(blob);
    localUrls[id]=url;
    return url;
  })().finally(()=>{ delete localUrlPending[id]; });
  return localUrlPending[id];
}
function allSongs(){
  const base = [];
  GENRES.forEach(g=> g.songs.forEach(([t,a,yt,y])=> base.push({t,a,gid:g.id,yt:yt||null,y:y||null})));
  customSongs.forEach(s=> base.push({t:s.t,a:s.a,gid:s.gid||"custom",yt:null}));
  localTracks.forEach(s=> base.push({t:s.t,a:s.a||"Archivo local",gid:"local",yt:null,local:true,id:s.id}));
  return base;
}
// Las playlists precargadas no se tocan: el link que pegó el usuario solo vale
// para sus canciones propias (un link viejo sobre una precargada se ignora).
function customId(s){ return links[songKey(s.gid||"custom", s.t)] || null; }
function countLinked(){ return customSongs.filter(customId).length; }

/* ============================================================
   NAVEGACIÓN / UTILIDADES DE UI
   ============================================================ */
// Tres secciones: Jugar, Ranking y Mi cuenta. Cada pantalla ilumina la suya
// arriba (compu) o en la barra de abajo (celular). Armar partida, la partida
// y el resultado van sin la barra de abajo: ahí manda el botón principal.
const SECCION = {
  "s-inicio":"jugar", "s-setup":"jugar", "s-game":"jugar", "s-results":"jugar",
  "s-duelo":"jugar", "s-pulsador":"jugar",
  "s-ranking":"ranking", "s-cuenta":"cuenta", "s-armar":"cuenta",
};
const SIN_TABS = ["s-setup", "s-game", "s-results", "s-duelo", "s-pulsador"];
let pantalla = "s-inicio", pantallaAnterior = "s-inicio";
// "s-inicio" → "inicio", para los parámetros de Analytics
const sinS = (id)=> id.replace(/^s-/, "");
function show(id){
  const cambia = id !== pantalla;
  if(cambia){
    pantallaAnterior = pantalla; pantalla = id;
    // La entrada escalonada del inicio es solo para la primera vez que se ve
    document.body.classList.remove("estreno");
    cancelarVuelos();
  }
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("on"));
  document.getElementById(id).classList.add("on");
  // El CSS usa estas clases: en la partida no se ve nada de arriba, y en
  // las pantallas de SIN_TABS el celular esconde la barra de abajo.
  document.body.classList.toggle("playing", id==="s-game");
  document.body.classList.toggle("sin-tabs", SIN_TABS.includes(id));
  document.querySelectorAll(".tab").forEach(t=>{
    if(t.dataset.tab === SECCION[id]) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  indicadorTabs();
  scrollTop();
  if(id==="s-inicio") renderInicio();
  if(id==="s-setup") renderSetup();
  if(id==="s-armar"){
    renderSongList();
    if(cambia) track("mis_canciones", { accion: "abrir", desde: sinS(pantallaAnterior) });
  }
  if(id==="s-cuenta"){ renderCuentaLocal(); renderMiCuenta(); }
}
// Las secciones de arriba / de la barra de abajo
function irA(seccion){
  track("seccion", { seccion });
  soltarFija();
  if(seccion==="ranking"){ verRanking(opts.maxSongs, "", undefined, "seccion"); return; }
  show(seccion==="cuenta" ? "s-cuenta" : "s-inicio");
}
// Mis canciones se abre desde el inicio, desde Mi cuenta o desde el aviso de
// Armar partida: "Volver" lleva a donde estaba.
function volver(){
  show(["s-inicio", "s-setup", "s-cuenta"].includes(pantallaAnterior) ? pantallaAnterior : "s-inicio");
}
// Si no volvemos arriba a mano, al cambiar de pantalla se queda donde estaba
// la anterior y lo primero que se ve es el medio de la nueva. Va sin
// animación y repetido en el frame siguiente porque al ocultar la pantalla
// anterior cambia el alto de la página: con "smooth" el navegador del celular
// cancelaba el scroll a mitad de camino.
function scrollTop(){
  const arriba = ()=>{
    window.scrollTo(0,0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;          // iOS viejo scrollea el body
  };
  arriba();
  requestAnimationFrame(arriba);
}
// Un resplandor del color desde los bordes (el centro queda libre: antes tapaba
// toda la pantalla de un color)
function flash(color){
  const f=document.getElementById("flash");
  f.style.setProperty("--c", color); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}

const plural = (n, uno, varios)=> n + " " + (n===1 ? uno : varios);

/* ============================================================
   INICIO
   Cómo juegan hoy (las dos tarjetas grandes del HTML), repetir la última
   partida y el récord de Un jugador con el puesto en el ranking.
   ============================================================ */
function renderInicio(){
  const u = usuarioActual();
  document.getElementById("hola").textContent = u
    ? "Hola, " + u.nombre.split(" ")[0]
    : "El juego para cantar con amigos";
  renderDesafioCard();
  renderRepetir();
  renderRecordCard();
}
// La tarjeta del desafío del día. Sale enseguida con lo que ya se sabe (la
// fecha y, si se jugó en este navegador, cómo fue) y se completa cuando
// responde la base: cuántos lo jugaron y tu puesto. Sin base, no hay tarjeta.
let turnoDesafio = 0;
async function renderDesafioCard(){
  const el = document.getElementById("desafio-card");
  if(!cuentasActivas){ el.innerHTML = ""; return; }
  const turno = ++turnoDesafio;
  const pintar = (d)=>{
    const html = tarjetaDesafioHtml(d, d ? rachaDesafio(d.dia) : 0, Boolean(usuarioActual()));
    if(el.dataset.html === html) return;
    el.dataset.html = html; el.innerHTML = html;
  };
  pintar(desafioEnMemoria() || { dia: diaProvisional(), jugaron: 0, mio: null });
  const d = await traerDesafio();
  if(turno === turnoDesafio) pintar(d);
}
// Los géneros de la última partida que todavía existen (y "Mis canciones" solo
// si quedan audios o canciones propias).
function generosDeUltima(){
  if(!ultima || !Array.isArray(ultima.generos)) return [];
  const validos = new Set(GENRES.map(g=> g.id));
  return ultima.generos.filter(id=> validos.has(id) || (id==="local" && hayPropias()));
}
// Hay algo en "Mis canciones": audios cargados o canciones de YouTube con link
function hayPropias(){ return localTracks.length > 0 || countLinked() > 0; }
function renderRepetir(){
  const el = document.getElementById("repetir");
  const gens = generosDeUltima();
  if(!gens.length){ el.innerHTML = ""; return; }
  const nombres = gens.slice(0, 2).map(nombreGenero).join(" + ") + (gens.length > 2 ? ` + ${gens.length-2} más` : "");
  const quienes = ultima.modo==="solo" ? "Un jugador" : "Con amigos · " + plural(teams.length, "equipo", "equipos");
  const cuantas = ultima.canciones ? ultima.canciones + " canciones" : "sin límite";
  el.innerHTML = `<button type="button" class="tarjeta" onclick="repetirUltima()">
      <span class="grow">
        <span class="eyebrow">Repetir la última</span>
        <span class="tarjeta-t">${esc(nombres)}</span>
        <span class="tarjeta-d">${quienes} · ${cuantas}</span>
      </span>
      <span class="play-dot" aria-hidden="true">▶</span>
    </button>`;
}
// Arma la partida anterior en un toque: mismos géneros, modo y cantidad
function repetirUltima(){
  const gens = generosDeUltima();
  if(!gens.length) return;
  soltarFija();
  selectedGenres = new Set(gens);
  decadas = new Set(Array.isArray(ultima.decadas) ? ultima.decadas : []);
  setModo(ultima.modo==="solo" ? "solo" : "grupo");
  if(OPCIONES_CANCIONES.includes(ultima.canciones)) opts.maxSongs = ultima.canciones;
  track("repetir_ultima", { modo_juego: modo, canciones_por_partida: opts.maxSongs });
  startGame();
}
// Tu récord con la cantidad de canciones que venís jugando y, con cuenta, tu
// puesto en esa tabla. Tocándola se abre el ranking.
let turnoRecord = 0;
async function renderRecordCard(){
  const el = document.getElementById("record-card");
  const turno = ++turnoRecord;
  let n = opts.maxSongs;
  // Si con esa cantidad nunca jugó Un jugador, la que tenga récord
  if(!record[String(n)]){
    const otra = OPCIONES_CANCIONES.find(k=> record[String(k)]);
    if(otra !== undefined) n = otra;
  }
  const de = n ? n + " canciones" : "sin límite";
  const tarjeta = (pts, pill)=> {
    const cuerpo = `<span class="grow"><span class="eyebrow" style="color:var(--cyan)">Récord · ${de}</span>
      <span class="big-pts">${pts} <small>pts</small></span></span>${pill}`;
    return cuentasActivas
      ? `<button type="button" class="tarjeta" onclick="verRanking(${n}, '', 'siempre', 'inicio')">${cuerpo}</button>`
      : `<div class="tarjeta">${cuerpo}</div>`;
  };
  const local = record[String(n)] || 0;
  const u = usuarioActual();
  if(!u){
    if(local) el.innerHTML = tarjeta(local, cuentasActivas ? `<span class="pill amber">Sumate al ranking ›</span>` : "");
    else el.innerHTML = cuentasActivas
      ? `<button type="button" class="tarjeta" onclick="irA('ranking')">
          <span class="grow"><span class="eyebrow">Ranking · Un jugador</span>
          <span class="tarjeta-t">¿Quién la saca con un segundo?</span></span>
          <span class="pill amber">Ver ›</span></button>`
      : "";
    return;
  }
  if(local) el.innerHTML = tarjeta(local, `<span class="pill amber">Ranking ›</span>`);
  const mio = n === 10 ? await miPuesto(n) : null;   // el ranking es solo el de 10 canciones
  if(turno !== turnoRecord) return;
  const pts = Math.max(local, mio ? mio.puntos : 0);
  el.innerHTML = pts ? tarjeta(pts, `<span class="pill amber">${mio ? "#" + mio.puesto + " histórico" : "Ranking"} ›</span>`) : "";
}

/* ============================================================
   MI CUENTA: lo que queda en este navegador
   El perfil, las estadísticas y las partidas de la cuenta los arma
   cuenta.js; esto es lo que existe con o sin sesión.
   ============================================================ */
function renderCuentaLocal(){
  const box = document.getElementById("cuenta-local");
  if(usuarioActual()){ box.innerHTML = ""; }
  else {
    // solo los récords adivinando el título (los del artista van con la clave "a10", "a5"…)
    const mejor = Math.max(0, ...Object.entries(record).filter(([k])=> /^\d+$/.test(k)).map(([, v])=> Number(v)).filter(Number.isFinite));
    box.innerHTML = `<div class="lbl">En este navegador</div>
      <div class="tiles">
        <div class="tile"><b>${jugado.partidas}</b><span>partidas</span></div>
        <div class="tile"><b>${jugado.canciones}</b><span>canciones</span></div>
        <div class="tile"><b>${mejor || "—"}</b><span>mejor récord</span></div>
      </div>
      ${favoritosHtml(porGenero, "este navegador")}
      <div class="lbl">Tus récords de Un jugador</div>
      <div class="rec">${OPCIONES_CANCIONES.map(n=>{
        const pts = record[String(n)] || 0;
        return `<div class="${pts ? "" : "none"}">${n ? n + " canciones" : "Sin límite"}<b>${pts || "—"}</b></div>`;
      }).join("")}</div>
      ${estadisticasHtml(partidasLocales)}`;
  }
  const propios = customSongs.length;
  document.getElementById("cuenta-canciones").innerHTML = `
    <button type="button" class="list-row" onclick="show('s-armar')">
      <span>${localTracks.length ? plural(localTracks.length, "audio", "audios") + " de tu compu" : "Todavía no cargaste audios"}<small>Suenan sin internet</small></span>
      <span class="act">Cargar</span></button>
    <button type="button" class="list-row" onclick="show('s-armar')">
      <span>${propios ? plural(propios, "canción propia", "canciones propias") : "Ninguna canción propia"} de YouTube<small>Las que no están en las playlists</small></span>
      <span class="act">Vincular</span></button>`;
  const ya = playedHistory.length;
  document.getElementById("pref-hist").textContent = ya
    ? `${plural(ya, "ya sonó", "ya sonaron")} y no se repiten hasta agotar la playlist`
    : "Todavía no sonó ninguna";
  syncPenalty();
}

/* ============================================================
   ARMAR PARTIDA: géneros, modo, equipos y opciones
   ============================================================ */
// Desde las tarjetas del inicio o desde "Jugar un jugador" del ranking. Con
// partida_iniciada da cuántos arman la partida y no la arrancan.
function elegirModo(m){
  soltarFija();
  setModo(m);
  track("armar_partida", { modo_juego: modo, desde: sinS(pantalla) });
  // Arranca con los géneros de la última partida, si había
  if(selectedGenres.size===0) generosDeUltima().forEach(id=> selectedGenres.add(id));
  show("s-setup");
}
function renderSetup(){
  renderGenres(); renderDecadas(); renderTeams(); renderMaxSongs(); renderAdivina(); renderTiempo();
  renderPulsadores(); syncPenalty(); updatePoolWarn();
}
/* ---- Décadas ----
   Un filtro encima de los géneros: sin ninguna elegida van todas. Las
   canciones sin año cargado (data.js) no entran cuando hay alguna elegida;
   las propias sí, porque las eligió quien juega. */
const decadaDe = (anio)=> Math.max(DECADAS[0][0], Math.floor(anio / 10) * 10);
function renderDecadas(){
  const el = document.getElementById("decadas");
  if(!el.querySelector("button")){
    el.innerHTML = DECADAS.map(([d, nombre])=>
      `<button type="button" data-d="${d}" onclick="toggleDecada(${d})">${nombre}</button>`).join("");
  }
  el.querySelectorAll("button").forEach(b=> b.setAttribute("aria-pressed", String(decadas.has(Number(b.dataset.d)))));
  document.getElementById("dec-info").textContent = decadas.size ? "· " + plural(decadas.size, "elegida", "elegidas") : "· todas";
  document.getElementById("dec-todas").hidden = !decadas.size;
}
function toggleDecada(d){
  decadas.has(d) ? decadas.delete(d) : decadas.add(d);
  track("decadas", { decadas: [...decadas].sort().join(",") || "todas" });
  renderDecadas(); updatePoolWarn();
}
function todasLasDecadas(){ decadas = new Set(); renderDecadas(); updatePoolWarn(); }

/* ---- Un jugador: qué se adivina ---- */
function renderAdivina(){
  const el = document.getElementById("opt-adivina");
  el.querySelectorAll("button").forEach(b=> b.setAttribute("aria-pressed", String(b.dataset.a === adivina)));
  pastilla(el);
  document.getElementById("adivina-hint").textContent = adivina === "artista"
    ? "Suena 1 segundo y escribís quién la canta. Adivinando el artista no hay ranking: es para practicar."
    : "Suena 1 segundo y escribís el título. Si no sale, se repite desde el mismo punto un segundo más largo, hasta 6. Errar también suma un segundo.";
}
function setAdivina(a){
  adivina = a === "artista" ? "artista" : "titulo";
  try{ save(LS_ADIVINA, adivina); }catch(_){}
  track("preferencia_cambiada", { adivina, desde: sinS(pantalla) });
  renderAdivina();
}

/* ---- Con amigos: tiempo para cantar y pulsadores ---- */
function renderTiempo(){
  const el = document.getElementById("opt-tiempo");
  if(!el.querySelector("button")){
    el.innerHTML = OPCIONES_TIEMPO.map(n=>
      `<button type="button" data-n="${n}" onclick="setTiempo(${n})"${n ? "" : ' aria-label="Sin límite de tiempo"'}>${n ? n + " s" : "∞"}</button>`).join("");
  }
  el.querySelectorAll("button").forEach(b=> b.setAttribute("aria-pressed", String(Number(b.dataset.n) === tiempoCantar)));
  pastilla(el);
}
function setTiempo(n){
  if(!OPCIONES_TIEMPO.includes(n)) return;
  tiempoCantar = n;
  try{ save(LS_TIEMPO, n); }catch(_){}
  track("preferencia_cambiada", { tiempo_cantar: n, desde: sinS(pantalla) });
  renderTiempo();
}
// La sala se abre al prender el interruptor, así ya pueden ir entrando
// mientras se arma la partida. Sin base (o sin red) el interruptor vuelve atrás.
function renderPulsadores(){
  const s = salaActual();
  document.getElementById("opt-pulsadores").checked = Boolean(s);
  const box = document.getElementById("sala-inv");
  const html = s ? invitacionHtml(s.codigo) : "";
  if(box.dataset.cod !== (s ? s.codigo : "")){ box.dataset.cod = s ? s.codigo : ""; box.innerHTML = html; }
}
async function setPulsadores(si){
  const chk = document.getElementById("opt-pulsadores");
  if(!si){ cerrarSala(); renderPulsadores(); return; }
  chk.disabled = true;
  const codigo = await abrirSala(teams.map((t, i)=> t.name.trim() || "Equipo " + (i + 1)));
  chk.disabled = false;
  if(!codigo) alert("No pudimos abrir la sala de pulsadores. Revisá la conexión y probá de nuevo.");
  renderPulsadores();
}
function renderGenres(){
  const el = document.getElementById("genres");
  const ficha = (id, em, nombre, detalle, extra)=>{
    const sel = selectedGenres.has(id);
    return `<button type="button" class="genre ${extra||""} ${sel?"sel":""}" data-g="${id}" aria-pressed="${sel}" onclick="toggleGenre('${id}')">
      <span class="em" aria-hidden="true">${em}</span>
      <span class="gn">${esc(nombre)}${detalle ? `<span class="gc">${detalle}</span>` : ""}</span>
      <span class="tick" aria-hidden="true">✓</span>
    </button>`;
  };
  // Playlist de audios locales (siempre visible; destaca porque suena seguro)
  // Sin la cantidad de canciones de cada género: solo el nombre
  el.innerHTML = GENRES.map(g=> ficha(g.id, g.em, nombreGenero(g.id), "")).join("") +
    ficha("local", "🎵", "Mis canciones", localTracks.length
      ? `<b style="color:var(--lime)">suena seguro</b>`
      : countLinked() ? plural(countLinked(), "canción tuya", "canciones tuyas") : "Cargá tus audios", "local");
}
// Al elegir no se vuelve a armar la lista: se cambia la clase de cada ficha,
// así el tilde entra y sale con su transición.
function marcarGeneros(){
  document.querySelectorAll("#genres .genre").forEach(b=>{
    const sel = selectedGenres.has(b.dataset.g);
    b.classList.toggle("sel", sel);
    b.setAttribute("aria-pressed", String(sel));
  });
}
function toggleGenre(id){
  selectedGenres.has(id) ? selectedGenres.delete(id) : selectedGenres.add(id);
  marcarGeneros(); updatePoolWarn();
}
// "Elegir todos" suma Mis canciones solo si hay audios o canciones propias
function todosLosGeneros(){
  return GENRES.map(g=> g.id).concat(hayPropias() ? ["local"] : []);
}
function toggleTodos(){
  const todos = todosLosGeneros();
  const estanTodos = todos.every(id=> selectedGenres.has(id));
  selectedGenres = estanTodos ? new Set() : new Set(todos);
  marcarGeneros(); updatePoolWarn();
}
// Los botones se arman una sola vez; después solo cambia cuál está apretado y
// la pastilla se desliza hasta él
function renderMaxSongs(){
  const el = document.getElementById("opt-maxsongs");
  if(!el.querySelector("button")){
    el.innerHTML = OPCIONES_CANCIONES.map(n=>
      `<button type="button" data-n="${n}" onclick="setMaxSongs(${n})"${n ? "" : ' aria-label="Sin límite"'}>${n || "∞"}</button>`).join("");
  }
  el.querySelectorAll("button").forEach(b=> b.setAttribute("aria-pressed", String(Number(b.dataset.n) === opts.maxSongs)));
  pastilla(el);
}
function setMaxSongs(n){
  if(!OPCIONES_CANCIONES.includes(n)) return;
  opts.maxSongs = n;
  renderMaxSongs();
}
// Restar un punto: se cambia en Armar partida o en Mi cuenta, y se recuerda
function setPenalty(v){
  opts.penalty = !!v;
  track("preferencia_cambiada", { resta_puntos: opts.penalty, desde: sinS(pantalla) });
  try{ save(LS_PENALTY, opts.penalty); }catch(_){}
  syncPenalty();
}
function syncPenalty(){
  ["opt-penalty", "pref-penalty"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.checked = opts.penalty;
  });
}
// Los nombres de los equipos se recuerdan entre partidas y entre sesiones.
function loadTeams(){
  const saved = load(LS_TEAMS, null);
  if(!Array.isArray(saved) || !saved.length) return [];
  return saved
    .filter(n => typeof n === "string")
    .slice(0, 12)
    .map(n => ({ name: n.slice(0,20), score: 0 }));
}
function saveTeams(){ save(LS_TEAMS, teams.map(t => t.name)); }

function addTeam(name){
  teams.push({name: name||"", score:0});
  saveTeams();
  renderTeams();
}
function renderTeams(){
  const colors=["#ff2e88","#25e0d6","#ffcb2e","#a6ff3d","#9d7bff","#ff8a3d","#5ad1ff","#ff5e9e"];
  const el=document.getElementById("teams");
  el.innerHTML = teams.map((p,i)=>`
    <div class="prow">
      <span class="dot" style="background:${colors[i%colors.length]}"></span>
      <input type="text" value="${esc(p.name)}" placeholder="Equipo ${i+1}"
        oninput="setTeamName(${i}, this.value)" maxlength="20">
      ${teams.length>1?`<button class="x" onclick="removeTeam(${i})" title="Quitar">✕</button>`:""}
    </div>`).join("");
}
// Con amigos o solo. Se recuerda para la próxima vez.
function setModo(m){
  const antes = modo;
  modo = m === "solo" ? "solo" : "grupo";
  try{ save(LS_MODO, modo); }catch(_){}
  // Solo cuando la persona lo cambia: al arrancar se llama con el modo guardado
  if(modo !== antes) track("modo_elegido", { modo_juego: modo });
  const solo = modo === "solo";
  document.getElementById("modo-grupo").setAttribute("aria-pressed", String(!solo));
  document.getElementById("modo-solo").setAttribute("aria-pressed", String(solo));
  pastilla(document.getElementById("modo-grupo").parentElement);
  document.getElementById("setup-titulo").textContent = solo ? "Un jugador" : "Con amigos";
  document.getElementById("teams-box").hidden = solo;
  document.getElementById("solo-box").hidden = !solo;
  document.getElementById("opt-penalty-box").hidden = solo;
}
function setTeamName(i, val){ if(teams[i]){ teams[i].name = val; saveTeams(); } }
function removeTeam(i){ teams.splice(i,1); saveTeams(); renderTeams(); }

// Las canciones propias de YouTube van con la ficha "Mis canciones", igual
// que los audios (antes se mezclaban siempre, y no se podía jugar solo con
// ellas ni sin ellas). Las décadas filtran solo las playlists precargadas.
function buildPool(){
  pool = [];
  allSongs().forEach(s=>{
    const propia = s.local || s.gid==="custom";
    const inSel = selectedGenres.has(propia ? "local" : s.gid);
    if(!inSel) return;
    if(decadas.size && !propia && !(s.y && decadas.has(decadaDe(s.y)))) return;
    const key = songKey(s.gid, s.t);
    if(s.local){ pool.push({...s, key}); return; }   // audio local: ya trae id
    const id = s.yt || links[key];                    // precargado, o el link de una propia
    if(id) pool.push({...s, id, key});
  });
}
// Abajo de "¡A jugar!": si con lo elegido no hay ninguna canción, el aviso de
// qué hacer. No se muestra cuántas hay, para no dar pistas del catálogo.
function updatePoolWarn(){
  buildPool();
  const el=document.getElementById("pool-warn");
  const info=document.getElementById("pool-info");
  const n = selectedGenres.size;
  document.getElementById("gen-info").textContent = n ? "· " + plural(n, "elegido", "elegidos") : "";
  document.getElementById("gen-todos").textContent =
    todosLosGeneros().every(id=> selectedGenres.has(id)) ? "Ninguno" : "Elegir todos";
  el.innerHTML = "";
  if(n===0){ info.textContent = "Elegí al menos un género"; return; }
  if(pool.length===0){
    const onlyLocal = selectedGenres.has("local") && n===1;
    info.textContent = "";
    el.innerHTML = decadas.size && !onlyLocal
      ? `<div class="aviso"><b>⚠️ No hay canciones de esas décadas</b> en los géneros que elegiste.
          Sumá otra década o <a href="#" onclick="todasLasDecadas();return false">elegí todas</a>.</div>`
      : `<div class="aviso">
      <b>⚠️ No hay canciones para jugar</b> en lo que elegiste.
      Entrá a <a href="#" onclick="show('s-armar');return false">📂 Mis canciones</a> y ${onlyLocal?'cargá tus archivos de audio':'cargá tus audios o pegá links de YouTube'} para poder jugar.</div>`;
    return;
  }
  info.textContent = "";
}

/* ============================================================
   ARMAR PLAYLIST
   ============================================================ */
function songRow(s, idx){
  const id = customId(s);
  const q = encodeURIComponent(s.t + " " + s.a);
  return `<div class="song">
    <div class="top">
      <div>
        <div class="tt">${esc(s.t)}</div>
        <div class="aa">${esc(s.a)}</div>
      </div>
      <span class="badge ${id?'linked':'empty'}">${id ? "✔ tu link" : "sin link"}</span>
    </div>
    <div class="link-row">
      <a class="btn amber mini" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">🔎 Buscar</a>
      <input type="url" placeholder="Pegá el link de YouTube…"
        value="${id?('https://youtu.be/'+id):''}"
        oninput="setLink('${songKey(s.gid||"custom", s.t)}', this.value, this)">
      <button class="x" onclick="removeCustom(${idx})">✕</button>
    </div>
  </div>`;
}
function renderSongList(){
  document.getElementById("songlist").innerHTML = customSongs.length
    ? customSongs.map(songRow).join("")
    : `<p class="hint" style="margin:0">Todavía no agregaste ninguna. Las de las playlists ya vienen listas y no se pueden cambiar.</p>`;
  document.getElementById("link-count").textContent = countLinked() + " con audio";
  renderLocalList();
}
function renderLocalList(){
  const el = document.getElementById("local-list");
  if(!el) return;
  if(!localTracks.length){ el.innerHTML = `<p class="hint" style="margin:6px 0 0">Todavía no cargaste ninguna. Tocá el botón de arriba y elegí varios archivos a la vez.</p>`; return; }
  el.innerHTML = `<div class="pill" style="margin-bottom:8px">🎵 ${localTracks.length} guardada${localTracks.length!==1?'s':''}</div>` +
    localTracks.map((s,idx)=>`
      <div class="song" style="padding:10px 12px">
        <div class="top">
          <div><div class="tt">${esc(s.t)}</div><div class="aa">${esc(s.a||'Archivo local')}</div></div>
          <button class="x" onclick="removeLocal(${idx})" title="Quitar">✕</button>
        </div>
      </div>`).join("");
}
async function onAudioFiles(inputEl){
  const files = [...inputEl.files];
  inputEl.value = "";
  if(!files.length) return;
  let added=0, failed=0;
  for(const f of files){
    if(!f.type.startsWith("audio/") && !/\.(mp3|m4a|aac|ogg|oga|wav|flac|opus|weba|webm)$/i.test(f.name)){ continue; }
    const id = "loc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,7);
    const t = f.name.replace(/\.[^.]+$/,"").replace(/_/g," ").trim() || "Canción";
    memBlobs[id] = f;                      // respaldo en memoria (siempre disponible esta sesión)
    try{ await idbPut(id, f); }catch(e){ failed++; }   // persistencia (mejor esfuerzo)
    localTracks.push({id, t, a:"Archivo local"});
    added++;
  }
  save(LS_LOCAL, localTracks);
  if(added) track("audio_propio_cargado", { cantidad: added, fallidos: failed, total: localTracks.length });
  if(!selectedGenres.has("local") && added) selectedGenres.add("local");
  renderLocalList(); renderGenres(); updatePoolWarn();
  if(failed) alert("Se cargaron "+added+" canciones para esta sesión. Nota: no se pudieron guardar de forma permanente en este navegador ("+failed+"), así que quizás debas volver a cargarlas la próxima vez.");
}
async function removeLocal(idx){
  const s = localTracks[idx];
  if(!s) return;
  if(localUrls[s.id]){ URL.revokeObjectURL(localUrls[s.id]); delete localUrls[s.id]; }
  delete memBlobs[s.id];
  try{ await idbDel(s.id); }catch(e){}
  localTracks.splice(idx,1);
  save(LS_LOCAL, localTracks);
  track("mis_canciones", { accion: "audio_quitado", total: localTracks.length });
  renderLocalList(); renderGenres(); updatePoolWarn();
}
function setLink(key, val, inputEl){
  const id = extractVideoId(val);
  const antes = links[key];
  if(id){ links[key]=id; inputEl.style.borderColor="var(--ok)"; }
  else if(val.trim()===""){ delete links[key]; inputEl.style.borderColor=""; }
  else { inputEl.style.borderColor="var(--no)"; return; }
  // Se llama con cada tecla: cuenta solo cuando el link cambia de verdad
  if(id && id !== antes) track("mis_canciones", { accion: "link_pegado" });
  else if(!id && antes) track("mis_canciones", { accion: "link_borrado" });
  save(LS_LINKS, links);
  document.getElementById("link-count").textContent = countLinked() + " con audio";
  const badge = inputEl.closest(".song").querySelector(".badge");
  badge.className = "badge " + (id ? "linked" : "empty");
  badge.textContent = id ? "✔ tu link" : "sin link";
}
function addCustomSong(){
  const t = prompt("Título de la canción:");
  if(!t) return;
  const a = prompt("Artista:") || "";
  customSongs.push({t:t.trim(), a:a.trim(), gid:"custom"});
  save(LS_CUSTOM, customSongs);
  track("mis_canciones", { accion: "cancion_agregada", total: customSongs.length });
  renderSongList();
}
function removeCustom(idx){
  const s = customSongs[idx];
  if(s) delete links[songKey(s.gid||"custom", s.t)];
  customSongs.splice(idx,1);
  save(LS_CUSTOM, customSongs); save(LS_LINKS, links);
  track("mis_canciones", { accion: "cancion_quitada", total: customSongs.length });
  renderSongList();
}

/* ---- Compartir la lista ----
   Las canciones propias de YouTube (las que tienen link) se pueden pasar por
   un link (?lista=…): el que lo abre las suma a las suyas. Los audios de la
   compu no viajan: quedan en el navegador de cada uno. */
const LINK_LISTA = "https://enunanota.com.ar/?lista=";
let listaCompartida = null;     // { codigo, firma }: para no guardar dos veces la misma lista
async function compartirLista(btn){
  const canciones = customSongs.filter(customId).map(s=> [s.t, s.a || "", customId(s)]);
  if(!canciones.length){ alert("Primero agregá alguna canción y pegale su link de YouTube."); return; }
  const firma = JSON.stringify(canciones);
  // Igual que con los duelos: un toque la guarda y otro la manda
  if(listaCompartida && listaCompartida.firma === firma){ mandarLista(listaCompartida.codigo, canciones.length, btn); return; }
  const nombre = (prompt("¿Cómo se llama la lista? (por ejemplo: Cumple de Ana)", "Mis canciones") || "").trim();
  if(!nombre) return;
  const antes = btn.textContent;
  btn.disabled = true; btn.textContent = "Guardando…";
  const r = await apiSuave("/lista", { nombre, canciones });
  btn.disabled = false;
  if(!r || !r.codigo){ btn.textContent = antes; alert("No pudimos guardar la lista. Probá de nuevo en un rato."); return; }
  listaCompartida = { codigo: r.codigo, firma };
  track("mis_canciones", { accion: "lista_compartida", total: canciones.length });
  btn.textContent = "📲 Mandar el link de la lista";
  entrar(btn, 0, 200);
}
async function mandarLista(codigo, cuantas, btn){
  const url = LINK_LISTA + codigo;
  const text = `🎵 Te paso mi lista de ${plural(cuantas, "canción", "canciones")} para jugar a “En una nota”:`;
  if(navigator.share){
    try{ await navigator.share({ title: "Lista · En una nota", text, url }); return; }
    catch(e){ if(e && e.name === "AbortError") return; }
  }
  try{
    await navigator.clipboard.writeText(text + " " + url);
    btn.textContent = "✔ Link copiado";
    setTimeout(()=>{ btn.textContent = "📲 Mandar el link de la lista"; }, 2200);
  }catch(_){ prompt("Copiá el link y mandalo:", url); }
}
// Se abrió un link de lista: se pregunta y se suman las que no estaban.
async function importarLista(codigo){
  const l = await apiSuave("/lista?codigo=" + encodeURIComponent(codigo));
  if(!l || !Array.isArray(l.canciones)){ alert("No encontramos esa lista. Puede que el link esté incompleto."); return; }
  const nuevas = l.canciones.filter(([t, , id])=>
    !customSongs.some(s=> norm(s.t) === norm(t) && customId(s) === id));
  show("s-armar");
  if(!nuevas.length){ alert(`Ya tenías todas las canciones de “${l.nombre}”.`); return; }
  if(!confirm(`¿Sumar ${plural(nuevas.length, "canción", "canciones")} de “${l.nombre}” a tus canciones?`)) return;
  nuevas.forEach(([t, a, id])=>{
    // Dos con el mismo título comparten la clave del link: la segunda se distingue
    let titulo = String(t).slice(0, 80);
    while(customSongs.some(s=> s.t === titulo)) titulo += " ·";
    customSongs.push({ t: titulo, a: String(a || "").slice(0, 80), gid: "custom" });
    links[songKey("custom", titulo)] = id;
  });
  save(LS_CUSTOM, customSongs); save(LS_LINKS, links);
  selectedGenres.add("local");
  track("mis_canciones", { accion: "lista_importada", total: nuevas.length });
  renderSongList();
  alert(`Listo: se sumaron ${plural(nuevas.length, "canción", "canciones")}. Para jugar con ellas elegí “Mis canciones” en Armar partida.`);
}

/* ============================================================
   REPRODUCTOR: YouTube + audio local
   ============================================================ */
let yt=null, ytReady=false, seekedThisRound=false;
let brokenIds=new Set(), skipTries=0;
// Videos que YouTube no dejó reproducir en este navegador. Casi siempre es por
// región: andan en Argentina y fallan en Chile o Colombia. brokenIds se vacía
// en cada partida, así que sin esto el mismo jugador volvía a chocarlos partida
// tras partida. Vencen a los 30 días por si el video se arregla.
const LS_ROTOS = "eun_rotos_v1";
const ROTOS_VENCEN = 30*24*60*60*1000;
// Solo se recuerdan los errores que no se arreglan reintentando: 100 = el video
// no existe, 101/150 (y sus variantes 151/152) = no permite embed acá. El 5
// (error del reproductor) puede ser un corte de red.
const ERRORES_PERMANENTES = [100, 101, 150, 151, 152];
let rotos = Object.fromEntries(
  Object.entries(load(LS_ROTOS, {})).filter(([,cuando])=> Date.now()-cuando < ROTOS_VENCEN)
);   // { videoId: cuándo falló (ms) }
let mediaKind=null;   // 'yt' | 'local' — qué medio usa la canción actual
const localAudioEl = () => document.getElementById("localaudio");

// Precarga: la canción se deja cargada y buscada apenas se sortea, mientras el
// grupo todavía está leyendo la pantalla. Sin esto, "Reproducir 1 segundo"
// arrancaba recién después de bufferear (en datos móviles, varios segundos de
// silencio incómodo antes de un fragmento que dura uno).
let preparedFor=null;   // key de la canción que ya está lista en el reproductor
let startAt=0;          // segundo desde el que arranca la canción actual
let prebuffering=false; // true mientras bufferea en silencio (muteado y tapado)

// Punto de arranque al azar, siempre desde el minuto 1 en adelante: muchos videos
// de YouTube tienen intro (hablada, instrumental o silencio) y un fragmento de
// 1 segundo que cae ahí no suena a nada.
const MIN_START = 60, START_SPREAD = 60;
function randomStart(){ return Math.floor(MIN_START + Math.random()*START_SPREAD); }
// Si la canción es corta y el punto elegido queda muy cerca del final, lo trae
// para atrás. d = duración en segundos (0 si todavía no se sabe).
function fitStart(st, d){
  if(!d || st < d - 30) return st;
  return Math.floor(d > 90 ? MIN_START + Math.random()*Math.max(0, d - 30 - MIN_START) : d*0.3);
}

// Reproducción por segundos
const SNIPPET_MS = 1000;      // cuánto suena cada "1 segundo"
let snippetTimer=null;        // timeout que corta el fragmento
let pauseAfterSnippet=false;  // true = frenar automáticamente al cumplir snippetMs
let snippetMs=SNIPPET_MS;     // lo que dura el fragmento actual (en el modo solo crece: 1 s, 2 s, 3 s…)
let inicioClip=null;          // modo solo: segundo de la canción donde arrancó el primer fragmento
let mediaStarted=false;       // la canción actual ya arrancó (para reanudar vs cargar)
let continuousMode=false;     // true = suena sin cortar hasta apretar detener
function clearSnippetTimer(){
  if(snippetTimer){ clearTimeout(snippetTimer); snippetTimer=null; }
  barraFragmento(0);
}
// Al empezar a sonar (evento del medio), si estamos en modo fragmento, programa el corte.
function armSnippet(){
  if(!pauseAfterSnippet) return;
  if(inicioClip===null) inicioClip = mediaTime();   // de acá vuelve a arrancar cada intento
  clearSnippetTimer();
  snippetTimer = setTimeout(snippetPause, snippetMs);
  barraFragmento(snippetMs);
}
// La barra al pie de la tapa: se llena en lo que dura el fragmento, así se ve
// cuánto falta para el corte. Arranca con el audio (no al apretar el botón) y
// con ms = 0 se esconde.
let animBarra=null;
function barraFragmento(ms){
  const el = document.getElementById("snip");
  if(animBarra){ animBarra.cancel(); animBarra=null; }
  if(!el) return;
  el.hidden = !ms;
  if(ms) animBarra = animar(el.firstElementChild, [{transform:"scaleX(0)"},{transform:"scaleX(1)"}],
    {duration:ms, easing:"linear", fill:"forwards"});
}

function onYouTubeIframeAPIReady(){
  yt = new YT.Player("ytplayer",{
    height:"100%", width:"100%",
    playerVars:{ controls:0, disablekb:1, modestbranding:1, rel:0, iv_load_policy:3, playsinline:1, fs:0 },
    events:{
      onReady:()=>{
        ytReady=true; try{ yt.setVolume(100); }catch(_){}
        // Si la API tardó más que el sorteo, precargamos la canción ya elegida.
        if(phase==='ready' && currentSong && !currentSong.local) prepareMedia(currentSong);
      },
      onStateChange:onPlayerState,
      onError:onPlayerError
    }
  });
}
function onPlayerState(e){
  if(e.data===YT.PlayerState.PLAYING){
    // En 'ready' todavía nadie apretó play: lo que está sonando es la precarga
    // (o un rebote del seek). Se frena y se mantiene muteado — que se escuche
    // acá sería revelar la canción antes de tiempo, así que nunca se desmutea
    // en esta fase. El seek al punto de arranque se hace una sola vez.
    if(phase==='ready'){
      try{
        yt.pauseVideo();
        if(prebuffering){
          // en el desafío y en los duelos el punto es el mismo para todos: no se corrige
          if(!inicioFijo(currentSong)) startAt = fitStart(startAt, yt.getDuration());
          yt.seekTo(startAt, true);
        }
      }catch(_){}
      prebuffering=false;
      return;
    }
    try{ yt.unMute(); yt.setVolume(100); }catch(_){}
    eqPlaying();
    armSnippet();   // si es fragmento de 1s, programa el corte
  } else if(e.data===YT.PlayerState.PAUSED || e.data===YT.PlayerState.ENDED){
    eqPaused();
  }
}
// Si un video de YouTube no se puede reproducir (embed deshabilitado 101/150, etc.)
// lo marca como roto y salta solito a otra canción, sin frenar el juego.
function onPlayerError(e){
  const s = currentSong;
  if(!s || s.local) return;
  if(phase!=='ready' && mediaKind!=='yt') return;
  brokenIds.add(s.id);
  if(ERRORES_PERMANENTES.includes(e && e.data)){
    rotos[s.id] = Date.now();
    try{ save(LS_ROTOS, rotos); }catch(_){}
  }
  // codigo: 100 = el video ya no existe, 101/150 = no permite embed, 5 = error
  // del reproductor. Con el video y el título se sabe cuál reemplazar en data.js.
  track("error_youtube", { momento: phase, codigo: e && e.data, video: s.id, cancion: s.t });
  // El video se rompió durante la precarga: todavía no apretaron play, así que
  // cambiamos la canción sin que se note. Antes el video roto aparecía recién
  // frente a todos y el juego tenía que saltar en pleno silencio.
  if(phase==='ready'){
    prebuffering=false; preparedFor=null;
    if(skipTries++ > 12) return;
    const nuevo = pickSong(true);
    if(!nuevo) return;
    currentSong = nuevo;
    preloadArt(nuevo);
    prepareMedia(nuevo);
    return;
  }
  if(phase!=='listening' && phase!=='continuous') return;
  if(skipTries++ > 12){ setCover("😕 YouTube bloquea estos videos al abrir el archivo directo. Usá la playlist 🎵 “Mis canciones” (suena sin internet).", true); return; }
  const alt = pickSong(true);
  if(!alt){ setCover("😕 No hay canciones reproducibles en estas playlists.", true); return; }
  currentSong = alt; seekedThisRound=false; mediaStarted=false; segundos=0; oidos=0; pistas=[]; fallidos=[]; inicioClip=null;
  if(continuousMode) playContinuous(); else playSnippet();
}

/* ---- Capa de medios: unifica audio local (<audio>) y YouTube ---- */
// El ecualizador se mueve y la tapa se enciende solo mientras hay audio de verdad
function eqSuena(si){
  const eq=document.getElementById("eq"); if(eq) eq.classList.toggle("paused", !si);
  const st=document.querySelector("#s-game .stage"); if(st) st.classList.toggle("sonando", si);
}
function eqPlaying(){ eqSuena(true); }
function eqPaused(){ eqSuena(false); }
function wireAudio(){
  const a=localAudioEl(); if(!a) return;
  a.addEventListener("loadedmetadata", ()=>{
    seekedThisRound=true;
    try{ a.currentTime=fitStart(randomStart(), a.duration||0); }catch(_){}
  });
  a.addEventListener("playing", ()=>{ eqPlaying(); armSnippet(); });
  a.addEventListener("pause", eqPaused);
  a.addEventListener("error", onLocalError);
}
async function playLocal(s){
  const a=localAudioEl();
  const url = await localUrlFor(s.id);
  if(!url){ onLocalError(); return; }
  a.src=url; a.volume=1;
  try{ await a.play(); }catch(e){ try{ a.play(); }catch(_){} }
}
function onLocalError(){
  if(mediaKind!=='local' || (phase!=='listening' && phase!=='continuous')) return;
  if(skipTries++ > 12){ setCover("😕 No se pudo reproducir ese archivo. Revisá tus canciones cargadas.", true); return; }
  const alt = pickSong(true);
  if(!alt){ setCover("😕 No hay canciones reproducibles.", true); return; }
  currentSong = alt; seekedThisRound=false; mediaStarted=false; segundos=0; oidos=0; pistas=[]; fallidos=[]; inicioClip=null;
  if(continuousMode) playContinuous(); else playSnippet();
}
/* ---- Precarga silenciosa ----
   Se llama al sortear la canción, no al apretar play. El video se carga muteado
   y se frena solo apenas bufferea (ver onPlayerState), así queda listo y buscado
   en el segundo de arranque. cueVideoById no sirve para esto: según la API de
   YouTube no pide el stream hasta que llamás playVideo(), así que el stall
   quedaba igual. */
function prepareMedia(s){
  preparedFor=null; prebuffering=false; startAt=0;
  if(!s) return;
  if(s.local){
    if(yt && yt.stopVideo){ try{ yt.stopVideo(); }catch(_){} }
    prepareLocal(s);
    return;
  }
  if(!ytReady || !yt) return;   // la API todavía no cargó: se carga al apretar play
  try{ localAudioEl().pause(); }catch(_){}
  startAt = inicioFijo(s) ? s.inicio : randomStart();
  prebuffering=true;
  try{
    yt.mute(); yt.setVolume(0);        // silencio total antes de tocar el video
    yt.loadVideoById({videoId:s.id, startSeconds:startAt});
    preparedFor = s.key;
  }catch(e){ prebuffering=false; preparedFor=null; }
}
async function prepareLocal(s){
  const url = await localUrlFor(s.id);
  if(!url) return;                     // el error real se maneja al reproducir
  if(!currentSong || currentSong.key!==s.key) return;   // ya cambió la canción
  const a=localAudioEl();
  a.src=url; a.volume=1;
  try{ a.load(); }catch(_){}           // el punto al azar lo fija loadedmetadata
  preparedFor = s.key;
}

// arranca (carga) la canción actual con el medio que corresponda; devuelve true si pudo
function mediaStart(){
  const s=currentSong; if(!s) return false;
  if(s.local){
    mediaKind='local';
    if(yt && yt.stopVideo){ try{ yt.stopVideo(); }catch(_){} }
    if(preparedFor===s.key){ localAudioEl().play().catch(()=>playLocal(s)); }
    else playLocal(s);   // el punto al azar lo fija el evento loadedmetadata
    return true;
  }
  mediaKind='yt';
  try{ localAudioEl().pause(); }catch(_){}
  if(!ytReady || !yt){ setCover("⏳ YouTube está cargando… reintentá en un segundo. (Tip: usá 🎵 “Mis canciones”, suena sin internet)", true); return false; }
  // Ya está precargada y buscada: suena al instante.
  if(preparedFor===s.key){
    prebuffering=false;   // si todavía bufferea, que siga de largo y suene
    try{ yt.unMute(); yt.setVolume(100); yt.playVideo(); return true; }catch(e){}
  }
  try{ yt.unMute(); yt.setVolume(100); yt.loadVideoById({videoId:s.id, startSeconds: inicioFijo(s) ? s.inicio : randomStart()}); }
  catch(e){ onPlayerError({data:5}); }
  return true;
}
// La canción trae decidido desde qué segundo suena (desafío del día, duelos)
function inicioFijo(s){ return Boolean(s) && Number.isFinite(s.inicio); }
function mediaPause(){
  clearSnippetTimer();
  if(mediaKind==='local'){ try{ localAudioEl().pause(); }catch(_){} }
  else if(yt && yt.pauseVideo){ yt.pauseVideo(); }
  eqPaused();
}
// En qué segundo de la canción está el medio actual, y saltar a uno.
function mediaTime(){
  try{ return mediaKind==='local' ? localAudioEl().currentTime : yt.getCurrentTime(); }catch(_){ return null; }
}
function mediaSeek(t){
  try{
    if(mediaKind==='local') localAudioEl().currentTime = t;
    else yt.seekTo(t, true);
  }catch(_){}
}
function mediaResume(){
  if(mediaKind==='local'){ localAudioEl().play().catch(()=>{}); }
  else if(yt && yt.playVideo){ yt.playVideo(); }
}
function mediaStop(){
  clearSnippetTimer(); pauseAfterSnippet=false; continuousMode=false;
  preparedFor=null; prebuffering=false;
  if(mediaKind==='local'){ const a=localAudioEl(); try{ a.pause(); a.currentTime=0; }catch(_){} }
  else if(yt && yt.stopVideo){ yt.stopVideo(); }
}

/* ============================================================
   JUEGO
   ============================================================ */
let phase='ready';        // ready | listening | continuous | decide | answering
let answeringTeam=-1;   // índice de equipo, 'all' (todos) o -1 (nadie)
let allHits=new Set();  // con "Para todos": índices de los equipos que la pegaron
let revealed=false;
let skipping=false;     // true cuando se saltea la canción sin puntos
let songNo=1;
let lastGameSongs=0;    // canciones de la última partida (para la tarjeta que se comparte)
let sinCortar=false;    // con amigos: la canción actual se escuchó sin cortar
let inicioPartida=0;    // cuándo arrancó la partida (ms), para medir cuánto dura

// Lo que se le avisa a la base al empezar una partida de Un jugador: la
// playlist, si se juega con una sola (para el ranking por género), y qué se
// adivina. En el desafío y los duelos, además, cuál es.
function datosPartida(){
  if(fija) return { modo: modoAdivina(), ...(fija.tipo==="desafio" ? { dia: fija.dia } : { duelo: fija.id }) };
  const unico = selectedGenres.size===1 ? [...selectedGenres][0] : null;
  return { modo: adivina, genero: unico && GENRES.some(g=> g.id===unico) ? unico : null };
}
// Qué se escribe en esta partida: en el desafío siempre el título, en un
// duelo lo que jugó el que lo armó, y si no lo elegido en Armar partida.
function modoAdivina(){ return fija ? (fija.modo === "artista" ? "artista" : "titulo") : adivina; }
// Cuántas canciones dura la partida (0 = sin límite)
function limite(){ return fija ? fija.total : opts.maxSongs; }

function startGame(){
  if(selectedGenres.size===0){ alert("Elegí al menos un género."); return; }
  buildPool();
  if(pool.length===0){ alert("No hay canciones para jugar. Entrá a 🔗 Armar canciones y agregá algunos links."); return; }
  fija = null; modoAntesDeFija = null;
  if(modo==='solo'){
    armarCatalogo();
    resetSolo();
  } else {
    teams.forEach((p,i)=>{ if(!p.name.trim()) p.name="Equipo "+(i+1); p.score=0; });
    if(teams.length===0){ teams=[{name:"Equipo 1",score:0}]; }
    saveTeams();   // los nombres quedan guardados para la próxima partida
  }
  opts.noRepeat = true;   // siempre: no se repiten canciones en una partida
  ultima = { modo, generos:[...selectedGenres], canciones:opts.maxSongs, decadas:[...decadas] };
  try{ save(LS_ULTIMA, ultima); }catch(_){}
  limpiarMarcador();
  // con amigos, en la compu ancha el marcador va al costado (lo hace el CSS)
  document.getElementById("s-game").classList.toggle("grupo", modo==='grupo');
  played=[]; brokenIds=new Set(); songNo=1;
  inicioPartida = Date.now();
  if(modo==='solo') soloEmpezar(opts.maxSongs, datosPartida());
  track("partida_iniciada", {
    modo_juego: modo,
    generos: [...selectedGenres].join(","),
    cantidad_generos: selectedGenres.size,
    equipos: modo==='solo' ? 1 : teams.length,
    canciones_por_partida: opts.maxSongs,
    resta_puntos: modo==='grupo' && opts.penalty,
    canciones_disponibles: pool.length,
    decadas: [...decadas].sort().join(",") || "todas",
    adivina: modo==='solo' ? adivina : "",
    tiempo_cantar: modo==='grupo' ? tiempoCantar : 0,
    pulsadores: modo==='grupo' && Boolean(salaActual()),
  });
  show("s-game");
  newSong();
}

/* ---- Partidas con las canciones fijas: desafío del día y duelos ----
   Se juegan como Un jugador sin tocar lo elegido en Armar partida: el modo
   guardado, los géneros y la cantidad quedan como estaban. */
let modoAntesDeFija = null;
function empezarFija(f){
  if(!fija) modoAntesDeFija = modo;
  fija = f;
  modo = 'solo';
  armarCatalogo();
  resetSolo();
  limpiarMarcador();
  document.getElementById("s-game").classList.remove("grupo");
  played=[]; brokenIds=new Set(); songNo=1;
  inicioPartida = Date.now();
  soloEmpezar(f.tipo==="desafio" ? 10 : f.opcion, datosPartida());
  track("partida_iniciada", {
    modo_juego: "solo", tipo: f.tipo, canciones_por_partida: f.total, equipos: 1,
    adivina: modoAdivina(),
  });
  show("s-game");
  newSong();
}
// Se vuelve a lo de siempre (al salir al inicio o al armar una partida común)
function soltarFija(){
  if(!fija) return;
  fija = null;
  if(modoAntesDeFija){ modo = modoAntesDeFija; modoAntesDeFija = null; }
}
// El desafío de hoy. Si ya se jugó (con la cuenta o en este navegador), al ranking.
async function jugarDesafio(){
  const d = await traerDesafio(true);
  if(!d){ alert("No pudimos cargar el desafío de hoy. Revisá la conexión y probá de nuevo."); return; }
  if(d.mio || desafioLocal(d.dia)){ verRanking(10, "", "hoy", "inicio"); return; }
  const f = armarFija("desafio", d.videos, d.inicios, 10, { dia: d.dia });
  // Pasa si la página quedó abierta desde antes de que se sumaran canciones
  if(f.total < 10){ alert("Hay canciones nuevas: recargá la página para jugar el desafío de hoy."); return; }
  track("desafio", { accion: "empezar" });
  empezarFija(f);
}

/* ---- Duelos ----
   Se llega por un link (?duelo=…): se ve quién retó y cómo le fue, y se
   juegan las mismas canciones desde el mismo segundo. */
let dueloVisto = null;      // el duelo que está en la pantalla s-duelo
async function abrirDuelo(id){
  show("s-duelo");
  const box = document.getElementById("duelo-box");
  document.getElementById("duelo-titulo").textContent = "Te retaron";
  box.innerHTML = `<p class="cargando">Buscando el duelo…</p>`;
  const d = await traerDuelo(id);
  if(pantalla !== "s-duelo") return;
  if(!d){
    dueloVisto = null;
    box.innerHTML = `<div class="tarjeta"><span class="grow"><span class="tarjeta-t">No encontramos ese duelo</span>
      <span class="tarjeta-d">Puede que el link esté incompleto o que sea muy viejo.</span></span></div>
      <button type="button" class="btn mag big" onclick="irA('jugar')">Ir al juego</button>`;
    return;
  }
  dueloVisto = d;
  const yaJugo = d.resultados.some(r=> r.es_mio) || Boolean(dueloLocal(d.id));
  const rival = rivalDe(d);
  const n = d.videos.length;
  document.getElementById("duelo-titulo").textContent = yaJugo ? "Así va el duelo"
    : rival ? rival.nombre + " te retó" : "Te retaron";
  track("duelo", { accion: "ver", jugado: yaJugo ? "si" : "no", jugaron: d.resultados.length });
  box.innerHTML = `
    <p class="duelo-bajada">${yaJugo
      ? "Ya lo jugaste: vale tu primer intento."
      : `${rival ? `Hizo <b>${rival.puntos} ${rival.puntos===1 ? "punto" : "puntos"}</b> en` : "Son"} ${n} canciones${d.modo==="artista" ? ", adivinando el artista" : ""}.
         Te tocan <b>las mismas</b>, desde el mismo segundo. ¿${rival ? "Lo superás" : "Te animás"}?`}</p>
    ${tablaDueloHtml(d)}
    ${yaJugo ? "" : `<button type="button" class="btn mag big" onclick="jugarDuelo()">▶ Jugar el duelo</button>`}
    <button type="button" class="btn ${yaJugo ? "cyan" : "ghost"} big" onclick="compartirDuelo('${d.id}', this)">📲 Pasárselo a alguien más</button>
    <button type="button" class="linkish" onclick="irA('jugar')">${yaJugo ? "Ir al juego" : "Ahora no"}</button>`;
}
function jugarDuelo(){
  const d = dueloVisto;
  if(!d) return;
  // El nombre se pide antes de jugar: al final solo queda ver cómo salió
  const u = usuarioActual();
  const nombre = u ? u.nombre : nombreParaDuelo();
  if(!nombre) return;
  const f = armarFija("duelo", d.videos, d.inicios, d.videos.length, { id: d.id, modo: d.modo, opcion: d.canciones, nombre });
  if(f.total < d.videos.length){ alert("Hay canciones nuevas: recargá la página para jugar este duelo."); return; }
  track("duelo", { accion: "empezar", canciones: f.total });
  empezarFija(f);
}
// Manda el link del duelo. texto: lo que acompaña al link.
async function compartirDuelo(id, btn, texto){
  const url = LINK_DUELO + id;
  const text = texto || "🎧 Te reto en “En una nota”: las mismas canciones, desde el mismo segundo. ¿Me ganás?";
  track("compartir", { que: "duelo", desde: sinS(pantalla) });
  if(navigator.share){
    try{ await navigator.share({ title: "Duelo · En una nota", text, url }); return; }
    catch(e){ if(e && e.name === "AbortError") return; }
  }
  try{
    await navigator.clipboard.writeText(text + " " + url);
    if(btn){ const antes = btn.textContent; btn.textContent = "✔ Link copiado"; setTimeout(()=>{ btn.textContent = antes; }, 2200); }
  }catch(_){ prompt("Copiá el link y mandáselo:", url); }
}

// total de canciones que durará la partida (para el contador "X / Y"). Es solo
// el límite elegido: nunca el tamaño de la playlist, para no dar pistas de
// cuántas canciones tiene. 0 = sin límite, el contador va sin total.
function totalSongs(){
  return limite();
}

// Devuelve una canción nueva, o null si se agotaron (con "no repetir" activo).
// force=true: solo lo usa el auto-salto de errores, permite repetir para no trabarse.
// Además de no repetir dentro de la partida, evita (mientras sea posible) canciones
// que ya sonaron en partidas anteriores — ese historial se guarda en localStorage.
function pickSong(force){
  if(fija){
    // En orden. Si YouTube no pasó alguna, se sigue con la que viene y al
    // final entra un suplente (en los duelos no hay: se juega una menos).
    const s = fija.canciones.concat(fija.suplentes).find(c=> !played.includes(c.key) && !brokenIds.has(c.id));
    if(!s) return null;
    played.push(s.key);
    return s;
  }
  let cands = pool.filter(s=> !brokenIds.has(s.id));
  if(!cands.length) return null;
  if(opts.noRepeat && !force){
    cands = cands.filter(s=> !played.includes(s.key));
    if(!cands.length) return null;   // ya sonaron todas → termina la partida
    const unheard = cands.filter(s=> !playedHistory.includes(s.key));
    if(unheard.length){
      cands = unheard;
    } else {
      // ya sonaron todas alguna vez: se reinicia el historial de este pool y se vuelve a sortear libre
      const poolKeys = new Set(pool.map(s=>s.key));
      playedHistory = playedHistory.filter(k=> !poolKeys.has(k));
    }
  }
  // Los que ya fallaron en este navegador van últimos: se prueban solo si no
  // queda otra. Así un bloqueador que rompe todos los videos no deja el juego vacío.
  const sanos = cands.filter(s=> !rotos[s.id]);
  if(sanos.length) cands = sanos;
  const s = cands[Math.floor(Math.random()*cands.length)];
  if(!played.includes(s.key)) played.push(s.key);
  if(opts.noRepeat && !playedHistory.includes(s.key)){
    playedHistory.push(s.key);
    save(LS_HISTORY, playedHistory);
  }
  return s;
}
// La primera vez arranca con las canciones que ya sonaron en este navegador
// (las claves del historial son "género::título")
function porGeneroDelHistorial(){
  const conteo = {};
  playedHistory.forEach(k=>{ const gid = String(k).split("::")[0]; conteo[gid] = (conteo[gid] || 0) + 1; });
  return conteo;
}
// Una canción más de ese género sonó en este navegador (con amigos o solo)
function sumarGenero(gid){
  if(!GENRES.some(g=> g.id===gid)) return;
  porGenero[gid] = (porGenero[gid] || 0) + 1;
  try{ save(LS_POR_GENERO, porGenero); }catch(_){}
}
function resetHistory(){
  track("historial_reiniciado", { canciones: playedHistory.length });
  playedHistory = [];
  save(LS_HISTORY, playedHistory);
  alert("Listo, se reinició el historial. Las canciones ya escuchadas pueden volver a salir desde la próxima partida.");
  renderCuentaLocal(); updatePoolWarn();
}

function setCover(txt, paused){
  const cover=document.getElementById("cover");
  cover.style.background="";
  cover.innerHTML=`<div>
    <div class="eq ${paused?'paused':''}" id="eq"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <div class="st" id="cover-state">${esc(txt)}</div>
  </div>`;
}

function newSong(){
  if(limite() && songNo > limite()){ endGame('limit'); return; }
  const s = pickSong();
  if(!s){ endGame('agotada'); return; }
  currentSong = s;
  preloadArt(s);
  pararCuenta(); callarPulsadores(true);
  seekedThisRound=false; revealed=false; answeringTeam=-1; skipping=false; skipTries=0;
  segundos=0; oidos=0; pistas=[]; fallidos=[]; inicioClip=null; soloRes=null; sugerencias=[]; sinCortar=false;
  mediaStarted=false; continuousMode=false; pauseAfterSnippet=false; clearSnippetTimer();
  phase='ready';
  prepareMedia(s);   // se carga mientras leen la pantalla, no cuando aprietan play
  const tot = totalSongs();
  document.getElementById("round-pill").textContent = tot ? ("Canción "+songNo+" de "+tot) : ("Canción "+songNo);
  setCover("Listo para sonar 🎧", true);
  renderPhase(); renderBoard();
}

// Una canción cuenta como escuchada cuando arranca el audio por primera vez en
// la ronda: apretar "1 segundo más" no la vuelve a contar.
function trackCancion(modoCorte){
  track("cancion_sonada", {
    modo: modoCorte,                        // corte = 1 segundo, continuo = sin cortar
    modo_juego: modo,                       // grupo | solo
    numero: songNo,
    tipo: currentSong && currentSong.local ? "propia" : "youtube",
  });
}

// Reproduce un fragmento de 1 segundo y frena (el corazón del juego).
// En el modo solo cada intento vuelve al mismo punto y suena un segundo más que
// el anterior (1 s, 2 s, 3 s…): dos fragmentos sueltos de 1 segundo cuesta
// unirlos en la cabeza. Con amigos sigue de largo desde donde se cortó, porque
// ahí se canta lo que sigue.
function playSnippet(){
  if(modo==='solo' && segundos >= MAX_SEGUNDOS) return;
  clearSnippetTimer();
  // El fragmento crece con lo que ya se escuchó, no con los pasos: una pista
  // baja un escalón pero no alarga el audio
  snippetMs = modo==='solo' ? (oidos+1)*SNIPPET_MS : SNIPPET_MS;
  continuousMode=false;
  pauseAfterSnippet=true;
  phase='listening';
  setCover("🎵 Sonando…");
  renderPhase();
  if(!mediaStarted){
    if(mediaStart()){
      mediaStarted=true; segundos++; oidos++; trackCancion("corte");
      sumarGenero(currentSong.gid);
      // Para el ranking: los audios y links propios no están en el catálogo
      if(modo==='solo') soloSono(currentSong.id, currentSong.local || currentSong.id!==currentSong.yt);
      escucharPulsadores();
    }
    else { pauseAfterSnippet=false; phase='ready'; renderPhase(); }
  } else {
    if(modo==='solo' && inicioClip!==null) mediaSeek(inicioClip);
    mediaResume(); segundos++; oidos++;
    escucharPulsadores();
  }
}
// Reproduce sin cortar hasta que aprieten detener.
function playContinuous(){
  clearSnippetTimer();
  pauseAfterSnippet=false;
  continuousMode=true;
  sinCortar=true;
  phase='continuous';
  setCover("🎵 Sonando… ¡hasta que corten!");
  renderPhase();
  if(!mediaStarted){
    if(mediaStart()){ mediaStarted=true; trackCancion("continuo"); escucharPulsadores(); }
    else { continuousMode=false; phase='decide'; renderPhase(); }
  } else { mediaResume(); escucharPulsadores(); }
}
// Corta: fin automático del fragmento, o botón "detener".
function snippetPause(){
  clearSnippetTimer();
  pauseAfterSnippet=false;
  mediaPause();
  phase='decide';
  setCover(modo==='solo' ? "🤔 ¿Cuál es?" : "✋ ¿Quién arriesga?", true);
  renderPhase(); renderBoard();
}
function stopPlayback(){
  continuousMode=false;
  flash("var(--amber)");
  snippetPause();
}

function pickTeam(i){
  clearSnippetTimer(); continuousMode=false;
  callarPulsadores();
  answeringTeam=i; skipping=false; phase='answering'; revealed=false;
  renderPhase(); renderBoard();
  iniciarCuenta();
}
function pickAll(){
  clearSnippetTimer(); continuousMode=false;
  callarPulsadores();
  answeringTeam='all'; skipping=false; phase='answering'; revealed=false;
  allHits=new Set();
  renderPhase(); renderBoard();
  iniciarCuenta();
}
function backToDecide(){
  clearSnippetTimer(); continuousMode=false;
  pararCuenta();
  phase='decide'; answeringTeam=-1;
  setCover("✋ ¿Quién arriesga?", true);
  renderPhase(); renderBoard();
  escucharPulsadores();
}

/* ---- Tiempo para cantar ----
   Con la opción activa, al elegir quién canta arranca una cuenta regresiva
   en la tapa. No anota nada sola: avisa que se acabó y el grupo decide. */
let cuentaTimer = null;
function pararCuenta(){
  if(cuentaTimer){ clearInterval(cuentaTimer); cuentaTimer = null; }
}
function iniciarCuenta(){
  pararCuenta();
  if(modo!=='grupo' || !tiempoCantar) return;
  let quedan = tiempoCantar;
  const cover = document.getElementById("cover");
  cover.style.background = "";
  cover.innerHTML = `<div class="cuenta">
      <b id="cuenta-n" aria-live="off">${quedan}</b>
      <div class="st">para cantar</div>
      <span class="cuenta-barra" aria-hidden="true"><span></span></span>
    </div>`;
  // La barra se vacía pareja (es tiempo, no una entrada): lineal y solo con transform
  animar(cover.querySelector(".cuenta-barra span"), [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
    { duration: tiempoCantar * 1000, easing: "linear", fill: "forwards" });
  cuentaTimer = setInterval(()=>{
    quedan--;
    const n = document.getElementById("cuenta-n");
    if(!n || phase!=='answering' || revealed){ pararCuenta(); return; }
    if(quedan > 0){
      n.textContent = quedan;
      if(quedan <= 3){ n.classList.add("apura"); golpe(n); }
      return;
    }
    pararCuenta();
    setCover("⏰ ¡Tiempo!", true);
    pitido(440, 450);
    flash("var(--amber)");
    temblar(laTapa());
  }, 1000);
}

/* ---- Pulsadores (sala.js) ----
   Con la sala abierta, mientras suena o se espera que alguien arriesgue, los
   celulares pueden tocar "¡YO!". El primero que llega corta el audio y queda
   elegido, igual que si lo hubieran tocado en esta pantalla. */
let escuchando = false;
function escucharPulsadores(){
  if(modo!=='grupo' || !salaActual() || escuchando) return;
  escuchando = true;
  abrirPulsadores(teams.map(t=> t.name), (i)=>{
    escuchando = false;
    if(pantalla!=="s-game" || !teams[i] || !['listening','continuous','decide'].includes(phase)) return;
    pauseAfterSnippet = false;
    mediaPause();
    pitido();
    flash("var(--lime)");
    track("sala", { accion: "pulso", numero: songNo });
    pickTeam(i);
  });
}
// limpiar: la canción terminó, que la base olvide quién había pulsado
function callarPulsadores(limpiar){
  if(!escuchando && !salaActual()) return;
  escuchando = false;
  cerrarPulsadores(limpiar);
}

// Con amigos: cómo terminó cada canción, con cuántos fragmentos de 1 segundo y
// si hizo falta escucharla sin cortar. Es lo que dice si el juego sale fácil o
// difícil, como solo_respuesta en Un jugador.
// resultado: acierto | robo | erro | todos | algunos | ninguno | salteada
function trackRonda(resultado){
  if(modo!=='grupo') return;
  track("ronda_grupo", { resultado, segundos, sin_cortar: sinCortar, numero: songNo, equipos: teams.length });
}

// saltear la canción (nadie la sabe / punto para nadie): revela y no da puntos
function skipSong(){
  trackRonda("salteada");
  clearSnippetTimer(); continuousMode=false;
  callarPulsadores();
  skipping=true; answeringTeam=-1; phase='answering'; revealed=true;
  revealCover(); mediaResume();
  renderPhase(); renderBoard();
}

// Imagen de la canción: la miniatura del video de YouTube.
// Los audios locales no tienen imagen (devuelve null y se muestra solo el texto).
function songArtUrl(s){
  if(!s || s.local || !s.id) return null;
  if(!/^[\w-]{11}$/.test(s.id)) return null;
  return `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`;
}
// Se precarga apenas se sortea la canción para que al revelar aparezca al instante.
function preloadArt(s){
  const url = songArtUrl(s);
  if(url){ const im = new Image(); im.src = url; }
}

function revealCover(){
  const cover=document.getElementById("cover");
  const art = songArtUrl(currentSong);
  cover.style.background="radial-gradient(circle at 50% 40%, #4a2170, #180b30)";
  // El telón (la tapa de antes) se levanta y lo de abajo entra escalonado:
  // "Era…", el título, el artista y la imagen (los tiempos están en el CSS)
  cover.innerHTML=`
    ${art?`<div class="rev-bg" style="background-image:url('${art}')"></div>`:""}
    <div class="rev-telon" aria-hidden="true"></div>
    <div class="rev">
      <div class="st">Era…</div>
      <div class="rev-t">${esc(currentSong.t)}</div>
      <div class="rev-a">${esc(currentSong.a)}</div>
      ${art?`<img class="rev-img" src="${art}" alt="Imagen de ${esc(currentSong.t)}, de ${esc(currentSong.a)}"
        onerror="this.remove();var b=document.querySelector('.rev-bg');if(b)b.remove()">`:""}
    </div>
    ${sePuedeReportar(currentSong) ? `<button type="button" class="reportar" id="reportar" onclick="abrirReporte()"
      aria-haspopup="true" aria-expanded="false" aria-label="Avisar que esta canción anda mal" title="¿Sonó mal?">⚠️</button>` : ""}`;
}

/* ---- Reportar una canción ----
   Con la canción ya revelada, un botón chico en la esquina de la tapa: se
   elige qué pasó y queda anotado en la base (se miran con `npm run reportes`).
   Solo para las canciones de las playlists: las propias las arregla cada uno. */
const MOTIVOS_REPORTE = [
  ["otra_cancion", "No es esa canción"],
  ["version", "Es otra versión (en vivo, cover…)"],
  ["empieza_mal", "Arranca hablada o en silencio"],
  ["no_suena", "No suena o se corta"],
];
let reportados = new Set();    // videos ya avisados en esta visita
function sePuedeReportar(s){
  return cuentasActivas && s && !s.local && s.yt && s.id===s.yt && !reportados.has(s.id);
}
function abrirReporte(){
  const btn = document.getElementById("reportar");
  if(!btn) return;
  const abierto = document.getElementById("reporte-menu");
  if(abierto){ abierto.remove(); btn.setAttribute("aria-expanded", "false"); return; }
  const menu = document.createElement("div");
  menu.id = "reporte-menu"; menu.className = "reporte-menu"; menu.setAttribute("role", "menu");
  menu.innerHTML = `<div class="eyebrow">¿Qué pasó con esta canción?</div>` + MOTIVOS_REPORTE.map(([id, txt])=>
    `<button type="button" role="menuitem" onclick="reportar('${id}')">${txt}</button>`).join("");
  btn.after(menu);
  btn.setAttribute("aria-expanded", "true");
}
function reportar(motivo){
  const s = currentSong, menu = document.getElementById("reporte-menu"), btn = document.getElementById("reportar");
  if(!s || !menu) return;
  reportados.add(s.id);
  apiSuave("/reporte", { video: s.id, motivo });
  track("cancion_reportada", { motivo, video: s.id, cancion: s.t });
  menu.innerHTML = `<div class="reporte-ok">¡Gracias! Lo reviso 💛</div>`;
  if(btn) btn.remove();
  setTimeout(()=>{ if(menu.isConnected) menu.remove(); }, 1600);
}
function revealAnswer(){
  pararCuenta();
  revealed=true; revealCover();
  mediaResume();   // reanuda para comprobar si la pegó
  renderPhase();
}

// ¿Es la última de la partida? Mismo criterio que newSong usa para terminarla.
function esUltima(){
  if(limite() && songNo >= limite()) return true;
  if(fija) return false;
  return opts.noRepeat && !pool.some(s=> !brokenIds.has(s.id) && !played.includes(s.key));
}
function btnSiguiente(){
  return esUltima()
    ? `<button class="btn mag big" onclick="finishRound()">🏁 Terminar partida</button>`
    : `<button class="btn mag big" onclick="finishRound()">⏭ Siguiente canción</button>`;
}

// fin de la canción actual → siguiente (o fin de partida)
function finishRound(){
  pararCuenta();
  mediaStop();
  songNo++;
  renderBoard();
  setTimeout(newSong, 300);
}
// Con la opción de restar activa, el que arriesgó y erró pierde un punto
// (nunca baja de cero).
function bajar(p){ if(opts.penalty) p.score = Math.max(0, p.score-1); }
function penalize(){
  if(typeof answeringTeam==='number' && teams[answeringTeam]) bajar(teams[answeringTeam]);
}
// Suma el punto al equipo indicado; sin índice, al que arriesgó.
// Si se lo lleva otro equipo, es que el que arriesgó erró.
function scoreTeam(i){
  const idx = (typeof i==='number') ? i : answeringTeam;
  const robo = idx!==answeringTeam;
  trackRonda(robo ? "robo" : "acierto");
  if(robo) penalize();
  if(typeof idx==='number' && idx>=0 && teams[idx]) teams[idx].score++;
  flash(robo ? "var(--amber)" : "var(--ok)"); finishRound();
}
// "Para todos": cantan todos a la vez, así que cada equipo puede pegarla o no.
// Se marcan los que la pegaron (+1); el resto erró y, con la resta activa, pierde uno.
function toggleHit(i){
  allHits.has(i) ? allHits.delete(i) : allHits.add(i);
  renderPhase();
}
function scoreHits(){
  trackRonda(allHits.size===teams.length ? "todos" : allHits.size ? "algunos" : "ninguno");
  teams.forEach((p,i)=>{ if(allHits.has(i)) p.score++; else bajar(p); });
  flash(allHits.size ? "var(--ok)" : "var(--no)"); finishRound();
}
// Atajo para cuando la pegaron todos: no hace falta marcar equipo por equipo.
function scoreAllHit(){
  allHits = new Set(teams.map((_,i)=>i));
  scoreHits();
}
function scoreNone(){ trackRonda("erro"); penalize(); flash("var(--no)"); temblar(laTapa()); finishRound(); }
const laTapa = ()=> document.querySelector("#s-game .stage");

/* ============================================================
   MODO SOLO
   No hay grupo que juzgue: se escribe el título (con autocompletado) y el
   juego lo comprueba. Los puntos dependen de cuántos segundos de canción
   hicieron falta — fragmentos escuchados, no tiempo de reloj: pensar con el
   audio en pausa no resta, y una conexión lenta tampoco. Cada intento repite
   desde el mismo punto un segundo más largo; errar cuenta como pedirlo.
   ============================================================ */
const PUNTOS_SOLO = [10, 7, 5, 3, 2, 1];   // con 1 segundo, con 2, … con 6
const MAX_SEGUNDOS = PUNTOS_SOLO.length;   // errar con el sexto pierde la canción
let soloPuntos = 0;
let soloResultados = [];   // [{ok, seg, pts}], una por canción resuelta
let segundos = 0;          // escalones gastados en la canción actual: fragmentos que sonaron más pistas pedidas
let oidos = 0;             // de esos, cuántos fueron audio (el próximo fragmento dura oidos + 1 segundos)
let pistas = [];           // las pistas pedidas en la canción actual: 'genero' | 'artista' | 'inicial'
let soloInicios = [];      // desde qué segundo sonó cada canción resuelta (para armar un duelo)
let soloVideos = [];       // el video de cada canción resuelta (null si era propia), para las estadísticas
let fallidos = [];         // títulos que probó y no eran
let soloRes = null;        // resultado de la canción actual, una vez resuelta
let nuevoRecord = false;
let recordPrevio = 0;      // el récord que había antes de esta partida (0 si era la primera con esa cantidad)
let puntosVolando = false; // hay un "+10" en camino al marcador: el número se actualiza cuando llega
let catalogo = [];         // títulos para autocompletar [{t, a, nt, na}]
let sugerencias = [], sugSel = 0;

// Lo que vale acertar con lo que ya sonó (antes de sonar nada, lo máximo).
const valeAhora = ()=> PUNTOS_SOLO[Math.max(0, segundos-1)];
const valeConUnoMas = ()=> PUNTOS_SOLO[Math.min(segundos, MAX_SEGUNDOS-1)];
const segSonando = ()=> Math.round(snippetMs/SNIPPET_MS);   // segundos del fragmento que está sonando

function resetSolo(){ soloPuntos = 0; soloResultados = []; soloInicios = []; soloVideos = []; nuevoRecord = false; }

// Se autocompleta con todo el catálogo, no solo con los géneros elegidos: si
// no, jugando con una playlist chica la lista de opciones ya era media pista.
// Encima se suman canciones que la app no tiene (RELLENO), para que figurar en
// la lista no delate que puede sonar. Las que repiten un título del catálogo
// se saltean: se acierta por título y no tienen que contar como acierto.
function armarCatalogo(){
  const vistos = new Set(), titulos = new Set();
  catalogo = [];
  allSongs().forEach(s=>{
    const nt = norm(s.t), na = norm(s.a);
    if(!nt || vistos.has(nt+"|"+na)) return;
    vistos.add(nt+"|"+na); titulos.add(nt);
    catalogo.push({ t:s.t, a:s.a, nt, na });
  });
  RELLENO.forEach(([t,a])=>{
    const nt = norm(t);
    if(!nt || titulos.has(nt)) return;
    titulos.add(nt);
    catalogo.push({ t, a, nt, na:norm(a) });
  });
  // Para el modo artista: cada artista una vez, con la misma forma que una
  // canción (así sirve la misma búsqueda). También salen los del relleno.
  const nombres = new Map();
  catalogo.forEach(s=>{
    if(s.na && s.na !== "archivo local" && !nombres.has(s.na)) nombres.set(s.na, { t:s.a, a:"", nt:s.na, na:s.na });
  });
  listaArtistas = [...nombres.values()];
}
let listaArtistas = [];    // artistas para autocompletar en el modo artista [{t, a:"", nt, na}]
// "Shakira ft. Maluma", "Carlos Vives, Shakira", "Rosalía y J Balvin" → cada uno por separado
const partesArtista = (a)=> String(a).split(/\s*(?:,|&|\bft\.?|\bfeat\.?|\by\b|\bx\b|\bcon\b)\s*/i).map(norm).filter(Boolean);
// ¿Lo elegido es quien canta? Vale el nombre entero, o cualquiera de los que
// la cantan cuando son varios ("Maluma" para una de Shakira ft. Maluma).
function esElArtista(elegido, artista){
  if(norm(elegido) === norm(artista)) return true;
  const de = partesArtista(artista), el = partesArtista(elegido);
  return el.length > 0 && (el.every(p=> de.includes(p)) || de.every(p=> el.includes(p)));
}
const MAX_SUGERENCIAS = 6;
// Hash chico para mezclar el relleno siempre igual para lo mismo escrito.
function hashStr(s){
  let h = 2166136261;
  for(let i=0; i<s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Primero los títulos que empiezan con lo escrito, después los que lo tienen
// al principio de una palabra, en el medio, y al final los que coinciden
// palabra por palabra contando el artista ("persiana soda").
// Si coinciden pocos, se completa la lista con parecidos (del mismo artista,
// con palabras que empiezan igual): con dos letras no tiene que quedar una
// sola opción a la vista. El relleno sale solo de lo escrito, nunca de la
// canción que suena, así que no da pistas.
function buscarTitulos(q){
  const n = norm(q);
  if(n.length < 2) return [];
  const palabras = n.split(" ");
  const hits = [], resto = [];
  for(const s of (modoAdivina()==="artista" ? listaArtistas : catalogo)){
    const rank = s.nt.startsWith(n) ? 0
      : (" "+s.nt).includes(" "+n) ? 1
      : s.nt.includes(n) ? 2
      : palabras.every(p=> (s.nt+" "+s.na).includes(p)) ? 3 : -1;
    (rank >= 0 ? hits : resto).push([rank, s]);
  }
  hits.sort((a,b)=> a[0]-b[0] || a[1].t.localeCompare(b[1].t));
  const lista = hits.slice(0, MAX_SUGERENCIAS).map(h=> h[1]);
  if(!lista.length || lista.length >= MAX_SUGERENCIAS) return lista;
  const artistas = new Set(lista.map(s=> s.na));
  const empiezaCon = (s, pre)=> (" "+s.nt).includes(" "+pre);
  const relleno = resto.map(([, s])=>{
    const rank = artistas.has(s.na) ? 0
      : palabras.some(p=> empiezaCon(s, p.slice(0, 2))) ? 1
      : empiezaCon(s, n[0]) ? 2 : 3;
    return [rank, hashStr(n+"|"+s.nt), s];
  });
  relleno.sort((a,b)=> a[0]-b[0] || a[1]-b[1]);
  return lista.concat(relleno.slice(0, MAX_SUGERENCIAS - lista.length).map(r=> r[2]));
}
function renderSugerencias(q){
  const el = document.getElementById("guess-list");
  if(!el) return;
  if(!sugerencias.length){
    el.innerHTML = norm(q).length >= 2
      ? `<p class="hint sug-nada">No está en la lista: probá con otra palabra${modoAdivina()==="artista" ? "" : " o con el artista"}</p>` : "";
    return;
  }
  // mousedown con preventDefault: en la compu el foco se queda en el campo
  el.innerHTML = sugerencias.map((s,i)=>`
    <button type="button" class="sug ${i===sugSel?'on':''}" role="option" aria-selected="${i===sugSel}"
      onmousedown="event.preventDefault()" onclick="guessSong(${i})">
      <b>${esc(s.t)}</b><span>${esc(s.a)}</span>
    </button>`).join("");
}
function onGuessInput(){
  const q = document.getElementById("guess-in").value;
  sugerencias = buscarTitulos(q); sugSel = 0;
  renderSugerencias(q);
}
function onGuessKey(ev){
  if(ev.key==="ArrowDown" || ev.key==="ArrowUp"){
    if(!sugerencias.length) return;
    ev.preventDefault();
    sugSel = (sugSel + (ev.key==="ArrowDown" ? 1 : -1) + sugerencias.length) % sugerencias.length;
    renderSugerencias(ev.target.value);
  } else if(ev.key==="Enter"){
    ev.preventDefault();
    if(sugerencias.length) guessSong(sugSel);
  }
}
// Cuenta el título, no el artista: la misma canción puede estar cargada con el
// artista escrito distinto en dos playlists.
function guessSong(i){
  const s = sugerencias[i];
  if(!s || modo!=='solo' || phase!=='decide') return;
  const acerto = modoAdivina()==="artista" ? esElArtista(s.t, currentSong.a) : s.nt === norm(currentSong.t);
  if(acerto){ resolverSolo(true); return; }
  fallidos.push(s.t);
  temblar(laTapa());
  if(segundos >= MAX_SEGUNDOS){ resolverSolo(false); return; }
  flash("var(--no)");
  playSnippet();
}
function noSe(){ if(modo==='solo' && phase==='decide') resolverSolo(false); }

/* ---- Pistas ----
   Hasta dos por canción. Cada una baja un escalón, igual que escuchar un
   segundo más o errar, pero sin audio: primero el género y después el artista
   (adivinando el artista, con qué letra empieza). La base las cuenta aparte
   para no pedirle el tiempo de un audio que no sonó. */
const MAX_PISTAS = 2;
const ORDEN_PISTAS = { titulo: ["genero", "artista"], artista: ["genero", "inicial"] };
function hayPista(){
  const s = currentSong;
  return modo==='solo' && phase==='decide' && s && !s.local && s.gid!=="custom"
    && pistas.length < MAX_PISTAS && segundos < MAX_SEGUNDOS;
}
function pedirPista(){
  if(!hayPista()) return;
  const cual = ORDEN_PISTAS[modoAdivina()][pistas.length];
  pistas.push(cual);
  segundos++;
  track("pista", { pista: cual, numero: songNo, segundos });
  renderPhase();
  const nueva = document.querySelector("#controls .pistas span:last-child");
  if(nueva) entrar(nueva, 6, 220);
}
function textoPista(cual){
  const s = currentSong;
  if(cual==="genero") return "🎼 " + nombreGenero(s.gid);
  if(cual==="artista") return "🎤 " + s.a;
  return "🔤 Empieza con " + (norm(s.a)[0] || "?").toUpperCase();
}

function resolverSolo(ok){
  clearSnippetTimer();
  const pts = ok ? valeAhora() : 0;
  soloRes = { ok, seg: segundos, pts, pistas: pistas.length };
  soloInicios.push(Math.max(0, Math.round(inicioClip !== null ? inicioClip : startAt || 0)));
  soloVideos.push(!currentSong.local && currentSong.yt && currentSong.id===currentSong.yt ? currentSong.yt : null);
  // Los puntos salen volando de lo que valía la canción (la escalera, o los
  // botones si en ese celular la escalera está escondida) hasta el marcador,
  // y recién ahí el número cuenta hasta el nuevo total.
  const antes = soloPuntos;
  soloPuntos += pts;
  if(pts){
    const marcador = document.getElementById("solo-pts-n");
    const ahora = document.querySelector("#ladder .now");
    let desde = ahora ? ahora.getBoundingClientRect() : null;
    if(!desde || !desde.width) desde = document.getElementById("controls").getBoundingClientRect();
    puntosVolando = true;
    volar(desde, marcador, "+" + pts, ()=>{
      puntosVolando = false;
      if(pantalla!=="s-game" || modo!=='solo') return;
      contar(marcador, Math.min(antes, soloPuntos), soloPuntos);
      golpe(marcador, "var(--lime)");
    });
  }
  soloResultados.push(soloRes);
  // A la base va lo que tenía que escribir: el título o, en el modo artista, el artista
  soloResolvio(ok ? segundos : 0, ok ? norm(modoAdivina()==="artista" ? currentSong.a : currentSong.t) : null, ok ? pistas.length : 0);
  phase='answering'; revealed=true;
  revealCover(); mediaResume();   // se escucha cómo seguía
  flash(ok ? "var(--ok)" : "var(--no)");
  // En Analytics "resultado" ya es lo que pasó al compartir y "fallidos" los
  // audios que no se pudieron guardar: acá van con otros nombres.
  track("solo_respuesta", {
    respuesta: ok ? "acierto" : (fallidos.length ? "error" : "no_se"),
    segundos, errados: fallidos.length, puntos: pts,
    numero: songNo, pistas: pistas.length, adivina: modoAdivina(),
  });
  renderPhase(); renderBoard();
}
function renderSolo(c, t, sub){
  const pts = (n)=> n + " punto" + (n!==1 ? "s" : "");
  if(phase==='ready'){
    t.textContent="🎧 Escuchá";
    sub.textContent="Si la sacás con 1 segundo, " + pts(PUNTOS_SOLO[0]);
    c.innerHTML=`<button class="btn cyan big" onclick="playSnippet()">▶ Reproducir 1 segundo</button>`;
  } else if(phase==='listening'){
    t.textContent="🎵 Sonando…";
    // Se pinta antes de que playSnippet sume el intento: lo que suena sale del
    // largo del fragmento, no de "segundos" (iba un número atrasado).
    const n = segSonando();
    sub.textContent = n > 1 ? "Desde el mismo punto, " + n + " segundos" : "Escuchá bien…";
    c.innerHTML=`<button class="btn amber big" onclick="stopPlayback()">✋ Cortar ya</button>`;
  } else if(phase==='decide'){
    const artista = modoAdivina()==="artista";
    t.textContent = artista ? "🤔 ¿Quién la canta?" : "🤔 ¿Qué canción es?";
    const ultimo = fallidos[fallidos.length-1];
    sub.textContent = (ultimo ? "No era “" + ultimo + "” · " : "") +
      "Ahora vale " + pts(valeAhora()) + " · intento " + segundos + " de " + MAX_SEGUNDOS;
    const hayMas = segundos < MAX_SEGUNDOS;
    // La lista va arriba del campo: en el celular, abajo la tapa el teclado.
    // Las pistas pedidas quedan a la vista arriba de todo.
    c.innerHTML=`<div class="guess">
        ${pistas.length ? `<div class="pistas" aria-label="Pistas">${pistas.map(p=> `<span>${esc(textoPista(p))}</span>`).join("")}</div>` : ""}
        <div id="guess-list" class="sugs" role="listbox" aria-label="${artista ? "Artistas" : "Canciones"} que coinciden"></div>
        <input type="text" id="guess-in" placeholder="${artista ? "Escribí el artista…" : "Escribí el título…"}" autocomplete="off"
          autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-label="${artista ? "Quién la canta" : "Título de la canción"}"
          oninput="onGuessInput()" onkeydown="onGuessKey(event)">
      </div>
      <div class="solo-acc${hayPista() ? " con-pista" : ""}">
        <button class="btn amber" onclick="playSnippet()" ${hayMas?'':'disabled'}>${hayMas ? '▶ Escuchar '+(oidos+1)+' segundos · vale '+valeConUnoMas() : 'Ya no quedan intentos'}</button>
        <button class="btn ghost" onclick="noSe()">🏳️ No sé · ver cuál era</button>
        ${hayPista() ? `<button class="btn ghost pista-btn" onclick="pedirPista()" aria-label="Pedir una pista: baja a ${valeConUnoMas()} puntos" title="Pista · baja a ${valeConUnoMas()}">💡</button>` : ""}
      </div>`;
    sugerencias = [];
    // En la compu se escribe directo. En el celular no: el teclado taparía
    // "Escuchar 2 segundos" justo cuando quizás lo quiere tocar.
    if(window.matchMedia && matchMedia("(pointer:fine)").matches) document.getElementById("guess-in").focus();
  } else if(phase==='answering' && soloRes){
    if(soloRes.ok){
      t.textContent="✅ ¡La sacaste!";
      const oyo = soloRes.seg - (soloRes.pistas || 0);
      sub.textContent="+" + pts(soloRes.pts) + " · con " + oyo + " segundo" + (oyo!==1?"s":"") +
        (soloRes.pistas ? " y " + plural(soloRes.pistas, "pista", "pistas") : "");
    } else {
      t.textContent="❌ Era esta";
      sub.textContent="0 puntos · escuchá cómo seguía";
    }
    c.innerHTML=btnSiguiente();
  }
}

// Un jugador: los seis valores a la vista, tachados los que ya pasaron y
// resaltado lo que vale acertar ahora.
function renderLadder(){
  const el = document.getElementById("ladder");
  const ver = modo==='solo' && phase!=='answering';
  el.hidden = !ver;
  if(!ver) return;
  // mientras suena, el escalón es el del fragmento más las pistas ya pedidas
  const ahora = phase==='listening' ? segSonando()-1+pistas.length : Math.max(0, segundos-1);
  // el escalón que pasa a valer salta un poco, solo cuando cambia
  const paso = ahora !== escalonVisto && ahora > 0 ? ' paso' : '';
  escalonVisto = ahora;
  el.innerHTML = PUNTOS_SOLO.map((p,i)=>
    `<div class="${i<ahora ? 'used' : i===ahora ? 'now'+paso : ''}"><b>${p}</b><span>${i+1} s</span></div>`).join("");
}
let escalonVisto = 0;

// El título y los botones cambian con cada fase: entran con un fundido corto
// en vez de aparecer. Solo cuando cambia la fase, no al marcar un equipo
// (ahí se repinta lo mismo y parpadearía).
let faseVista = "";
function renderPhase(){
  const c=document.getElementById("controls");
  const t=document.getElementById("phase-title");
  const sub=document.getElementById("phase-sub");
  const tituloAntes = t.textContent;
  renderLadder();
  if(modo==='solo') renderSolo(c, t, sub); else renderGrupo(c, t, sub);
  const fase = [songNo, phase, revealed, answeringTeam, skipping].join("|");
  // los botones, sin desplazarse: están al fondo de la partida y moverlos
  // hacia abajo hacía aparecer la barra de scroll por un instante
  if(fase !== faseVista){ faseVista = fase; entrar(c, 0); }
  if(t.textContent !== tituloAntes) entrar(t.parentElement, 6, 200);
}
function renderGrupo(c, t, sub){
  if(phase==='ready'){
    t.textContent="🎧 Escuchen todos";
    sub.textContent="Suena 1 segundo y se corta. Después, ¿quién arriesga?";
    c.innerHTML=`<button class="btn cyan big" onclick="playSnippet()">▶ Reproducir 1 segundo</button>`;
  } else if(phase==='listening'){
    t.textContent="🎵 Sonando…";
    sub.textContent="Escuchen bien…";
    c.innerHTML=`<button class="btn amber big" onclick="stopPlayback()">✋ Cortar ya</button>`;
  } else if(phase==='continuous'){
    t.textContent="🎵 Sonando sin cortar…";
    sub.textContent="Apretá detener cuando quieran";
    c.innerHTML=`<button class="btn amber big" onclick="stopPlayback()">✋ Detener</button>`;
  } else if(phase==='decide'){
    t.textContent="✋ ¿Quién arriesga?";
    sub.textContent = salaActual()
      ? "Toquen ¡YO! en el celular (sala " + salaActual().codigo + ") — o elijan acá"
      : "Elijan quién canta la que sigue — o escuchen un poco más";
    c.innerHTML=`<div class="teamgrid">`+
      teams.map((p,i)=>`<button class="btn lime" onclick="pickTeam(${i})">${esc(p.name)}</button>`).join("")+
      `</div>
      <div class="row" style="gap:10px">
        <button class="btn cyan" style="flex:1" onclick="pickAll()">🤝 Para todos</button>
        <button class="btn ghost" style="flex:1" onclick="skipSong()">⏭ Nadie · saltear</button>
      </div>
      <div class="row" style="gap:10px">
        <button class="btn amber" style="flex:1" onclick="playSnippet()">▶ 1 segundo más</button>
        <button class="btn ghost" style="flex:1" onclick="playContinuous()">▶▶ Sin cortar</button>
      </div>`;
  } else if(phase==='answering'){
    if(skipping){
      t.textContent="⏭ Nadie la pegó";
      sub.textContent="Punto para nadie · escuchen cómo seguía";
      c.innerHTML=btnSiguiente();
    } else if(answeringTeam==='all'){
      t.textContent="🎤 Cantan TODOS";
      if(!revealed){
        sub.textContent="Que canten la que sigue… después revelá";
        c.innerHTML=`<button class="btn mag big" onclick="revealAnswer()">👀 Revelar y comprobar</button>
          <button class="btn ghost" onclick="backToDecide()">↩ Volver</button>`;
      } else {
        sub.textContent = opts.penalty
          ? "Toquen los equipos que la pegaron · el resto pierde uno"
          : "Toquen los equipos que la pegaron";
        const n = allHits.size;
        const listo = n===0 ? `❌ Nadie la pegó${opts.penalty?' (−1 a todos)':''}`
          : n===teams.length ? "✅ La pegaron todos (+1)"
          : `✔ Listo · +1 a ${n===1?'1 equipo':n+' equipos'}${opts.penalty?', −1 al resto':''}`;
        c.innerHTML=`<div class="teamgrid">`+
          teams.map((p,i)=>`<button class="btn ${allHits.has(i)?'lime':'ghost'}" onclick="toggleHit(${i})">${allHits.has(i)?'✅ ':''}${esc(p.name)}</button>`).join("")+
          `</div>
          <div class="score-mark on" style="${n<teams.length?'':'grid-template-columns:1fr'}">
            ${n<teams.length?`<button class="btn" style="background:var(--ok);color:#fff" onclick="scoreAllHit()">✅ La pegaron todos</button>`:""}
            <button class="btn" style="background:${n?'var(--ok)':'var(--no)'};color:#fff" onclick="scoreHits()">${listo}</button>
          </div>`;
      }
    } else {
      t.textContent="🎤 Canta "+teams[answeringTeam].name;
      if(!revealed){
        sub.textContent = teams.length>1
          ? "Si erra, otro equipo puede tirar otro nombre"
          : "Que cante la que sigue… después revelá para comprobar";
        c.innerHTML=`<button class="btn mag big" onclick="revealAnswer()">👀 Revelar y comprobar</button>
          <button class="btn ghost" onclick="backToDecide()">↩ Elegí otro equipo</button>`;
      } else if(teams.length>1){
        // El punto se define recién acá: arriesgó un equipo, erró, y otro tiró
        // otro nombre. Con la canción a la vista el grupo ve quién la pegó —
        // puede no ser el que arriesgó primero — o si no la pegó nadie.
        // Acertar y robar van separados: arriba el que arriesgó, abajo los que roban.
        const quien = teams[answeringTeam].name;
        sub.textContent = opts.penalty
          ? "¿La pegó? Si no, pierde uno aunque otro robe"
          : "¿La pegó? Si no, otro equipo puede robar";
        c.innerHTML=`<button class="btn big" style="background:var(--ok);color:#fff" onclick="scoreTeam(${answeringTeam})">✅ La pegó ${esc(quien)} (+1)</button>
          <p class="hint" style="margin:6px 0 0;text-align:center">…o se la robó otro equipo:</p>
          <div class="teamgrid">`+
          teams.map((p,i)=> i===answeringTeam ? "" :
            `<button class="btn amber" onclick="scoreTeam(${i})">⚡ Robó ${esc(p.name)} (+1)</button>`).join("")+
          `</div>
          <button class="btn" style="background:var(--no);color:#fff" onclick="scoreNone()">❌ Nadie la pegó${opts.penalty?' (−1 a '+esc(quien)+')':''}</button>`;
      } else {
        sub.textContent="¿La pegó?";
        c.innerHTML=`<div class="score-mark on">
          <button class="btn" style="background:var(--ok);color:#fff" onclick="scoreTeam()">✅ La pegó (+1)</button>
          <button class="btn" style="background:var(--no);color:#fff" onclick="scoreNone()">❌ Erró${opts.penalty?' (−1)':''}</button>
        </div>`;
      }
    }
  }
}

// Cuadrito de una canción de Un jugador (mismos tramos que la imagen final)
function claseCuadrito(r){
  if(!r.ok) return "k";
  return r.seg===1 ? "g" : r.seg<=3 ? "y" : "o";
}
// Arriba de la partida: con amigos, un segmento por canción (las jugadas en
// magenta, la actual en blanco); en un jugador, los cuadritos de las que ya
// salieron y el punteado de la que suena. Sin límite o con más de 30 no hay
// segmentos: no entrarían.
function renderProg(){
  const el = document.getElementById("prog");
  const tot = totalSongs();
  if(modo==='solo'){
    el.className = "prog sqs";
    const hechas = soloResultados.slice(-30);
    const actual = soloResultados.length < songNo ? 1 : 0;
    const faltan = tot && tot <= 30 ? Math.max(0, tot - soloResultados.length - actual) : 0;
    // el cuadrito de la canción recién resuelta se llena con un salto
    const nuevo = soloResultados.length > cuadritosVistos ? hechas.length - 1 : -1;
    cuadritosVistos = soloResultados.length;
    el.innerHTML = hechas.map((r,i)=> `<span class="sq ${claseCuadrito(r)}${i===nuevo ? ' nuevo' : ''}"></span>`).join("") +
      (actual ? `<span class="sq cur"></span>` : "") + `<span class="sq"></span>`.repeat(faltan);
    return;
  }
  el.className = "prog";
  el.innerHTML = tot && tot <= 30
    ? Array.from({length:tot}, (_,i)=> `<span class="${i < songNo-1 ? 'd' : i===songNo-1 ? 'c' : ''}"></span>`).join("")
    : "";
}

let cuadritosVistos = 0;
// Al empezar una partida el marcador se arma de nuevo, sin festejar el paso a cero
function limpiarMarcador(){
  document.getElementById("board").innerHTML = "";
  fijar(document.getElementById("solo-pts-n"), 0);
  puntosVolando = false; cuadritosVistos = 0; escalonVisto = 0; faseVista = "";
}
function renderBoard(){
  renderProg();
  const solo = modo==='solo';
  const board = document.getElementById("board");
  document.getElementById("solo-pts").hidden = !solo;
  if(solo){
    // con puntos en camino, el número lo actualiza la llegada (resolverSolo)
    if(!puntosVolando) fijar(document.getElementById("solo-pts-n"), soloPuntos);
    board.innerHTML = "";
    return;
  }
  // Una ficha por equipo: la del que va ganando en amarillo, la del que canta en verde.
  // Las fichas se arman una vez por partida y después solo se les cambia el
  // contenido: así el número puede saltar cuando cambia, sin que el repintado
  // siguiente le corte la animación.
  const cur = (i)=> answeringTeam==='all' || i===answeringTeam;
  const max = Math.max(...teams.map(p=> p.score));
  const lider = max > 0 && teams.filter(p=> p.score===max).length === 1;
  let chips = board.querySelectorAll(".chip");
  const armar = chips.length !== teams.length;
  if(armar){
    board.innerHTML = teams.map(()=> `<div class="chip"><b></b><span></span></div>`).join("") + `<div class="score-ayuda"></div>`;
    chips = board.querySelectorAll(".chip");
  }
  teams.forEach((p,i)=>{
    const chip = chips[i], num = chip.firstElementChild;
    chip.className = "chip" + (cur(i) ? " cur" : "") + (lider && p.score===max ? " lead" : "");
    chip.lastElementChild.textContent = (cur(i) ? "🎤 " : "") + p.name;
    const antes = Number(num.textContent);
    if(num.textContent !== String(p.score)){
      num.textContent = p.score;
      if(!armar){
        const sumo = p.score > antes;
        golpe(num, sumo ? "var(--lime)" : "var(--no)");
        flotar(num, (sumo ? "+" : "−") + Math.abs(p.score - antes), sumo ? "var(--lime)" : "var(--no)");
      }
    }
  });
  // En la compu el marcador va al costado y abajo sobra lugar: el
  // recordatorio de cómo se anota (el CSS lo muestra solo ahí)
  board.querySelector(".score-ayuda").innerHTML = `
      <div class="eyebrow">Cómo se anota</div>
      <div>✋ El primero que grita <b>¡YO!</b> arriesga</div>
      <div>🎤 Canta <b>la que sigue</b> y después se revela</div>
      <div>⚡ Si erra, otro equipo puede <b>robar</b></div>
      ${opts.penalty ? `<div>➖ Errar <b>resta un punto</b></div>` : ""}`;
}

function endGame(reason){
  pararCuenta(); callarPulsadores(true);
  try{ mediaStop(); }catch(_){}
  if(yt && yt.stopVideo){ try{ yt.stopVideo(); }catch(_){} }
  // canciones que llegaron a terminarse. En solo cuentan las resueltas: si la sacó
  // y tocó Terminar sin pasar a la siguiente, esa también va (está en la tarjeta).
  lastGameSongs = modo==='solo' ? soloResultados.length : Math.max(0, songNo - 1);
  track("partida_terminada", {
    modo_juego: modo,
    motivo: reason || "manual",       // limit = llegó al tope, agotada = se acabó la playlist
    canciones: lastGameSongs,
    equipos: modo==='solo' ? 1 : teams.length,
    puntos_ganador: modo==='solo' ? soloPuntos : Math.max(...teams.map(p=>p.score), 0),
    duracion_seg: duracionPartida(),
  });
  if(lastGameSongs > 0){
    jugado.partidas++; jugado.canciones += lastGameSongs;
    try{ save(LS_JUGADO, jugado); }catch(_){}
  }
  const solo = modo==='solo';
  const desafio = fija && fija.tipo==="desafio", duelo = fija && fija.tipo==="duelo";
  document.getElementById("res-titulo").textContent = desafio ? "¡Desafío de hoy, listo!"
    : duelo ? "¡Duelo jugado!"
    : reason==='agotada' ? "¡Se acabaron las canciones!" : "¡Terminó la partida!";
  document.getElementById("res-sub").textContent =
    (desafio ? "Desafío del día · " + fechaCorta(fija.dia) : duelo ? "Duelo" : solo ? "Un jugador" : "Con amigos")
    + " · " + plural(lastGameSongs, "canción", "canciones");
  // El desafío y los duelos se juegan una sola vez: no hay "otra vez"
  const otra = document.getElementById("rematch-btn");
  otra.hidden = Boolean(fija);
  otra.textContent = solo ? "🔁 Jugar otra vez" : "🔁 Revancha";
  if(solo) finSolo(); else finGrupo();
  finExtras();
  document.getElementById("res-record").hidden = !(solo && nuevoRecord);
  mostrarTarjeta();
  pedirCafecito();
  show("s-results");
  // Papelitos cuando hay algo que festejar: un ganador solo (no un empate) o
  // un récord nuevo en Un jugador
  const tope = Math.max(...teams.map(p=> p.score), 0);
  const festejo = solo ? nuevoRecord : tope > 0 && teams.filter(p=> p.score===tope).length === 1;
  if(festejo && lastGameSongs > 0) papelitos();
}
function duracionPartida(){
  return inicioPartida ? Math.round((Date.now() - inicioPartida) / 1000) : 0;
}
function finGrupo(){
  document.getElementById("share-hint").textContent = "Manda una imagen con el marcador al grupo";
  rankingFinal(null);   // con amigos no hay ranking
  const sorted = [...teams].sort((a,b)=>b.score-a.score);
  const top = sorted[0];
  const winners = sorted.filter(p=>p.score===top.score);
  const wtxt = winners.length>1
    ? `¡Empate! ${winners.map(w=>esc(w.name)).join(" y ")}`
    : `🎉 Ganó <b style="color:var(--lime)">${esc(top.name)}</b>`;
  document.getElementById("winner").innerHTML = `<div style="font-size:22px;font-weight:900">${wtxt}</div><div class="pill" style="margin-top:8px">${top.score} punto${top.score!==1?'s':''}</div>`;
  const medals=["🥇","🥈","🥉"];
  document.getElementById("final-board").innerHTML = sorted.map((p,i)=>`
    <div class="brow">
      <span>${medals[i]||'　'} ${esc(p.name)}</span>
      <span class="pts">${p.score}</span>
    </div>`).join("");
}
// El récord se guarda por cantidad de canciones: 40 puntos en 5 canciones no
// se compara con 40 en 20.
function finSolo(){
  const artista = modoAdivina()==="artista";
  if(fija){
    // El desafío y los duelos no mueven los récords: son otra cosa
    nuevoRecord = false; recordPrevio = 0;
    document.getElementById("share-hint").textContent = fija.tipo==="desafio"
      ? "Mandá tus cuadritos y que te digan cuánto hicieron"
      : "Mandá cómo te fue";
    if(fija.tipo==="desafio" && soloResultados.length){
      guardarDesafioLocal(fija.dia, soloPuntos, soloResultados.map(r=> r.ok ? r.seg : 0));
      track("desafio", { accion: "terminar", puntos: soloPuntos, canciones: soloResultados.length });
    }
  } else {
    // El récord adivinando el artista va aparte ("a10"): es más fácil que el título
    const clave = (artista ? "a" : "") + String(opts.maxSongs);
    const previo = record[clave] || 0;
    recordPrevio = previo;
    nuevoRecord = soloResultados.length > 0 && soloPuntos > previo;
    if(nuevoRecord){
      record[clave] = soloPuntos;
      try{ save(LS_RECORD, record); }catch(_){}
      track("record_nuevo", { puntos: soloPuntos, anterior: previo, canciones_por_partida: opts.maxSongs, adivina: modoAdivina() });
    }
    const mejor = Math.max(previo, soloPuntos);
    const cuantas = (opts.maxSongs ? " con " + opts.maxSongs + " canciones" : "") + (artista ? " adivinando el artista" : "");
    document.getElementById("share-hint").textContent = nuevoRecord
      ? "🏅 ¡Nuevo récord" + cuantas + "! Mandá la imagen y desafiá a alguien"
      : "Tu récord" + cuantas + ": " + mejor + " puntos · mandá la imagen y desafiá a alguien";
  }
  guardarPartidaLocal();
  // Respaldo en texto por si no se puede dibujar la imagen
  const posibles = soloResultados.length * PUNTOS_SOLO[0];
  document.getElementById("winner").innerHTML = `
    <div style="font-size:22px;font-weight:900">🎧 Hiciste <b style="color:var(--lime)">${soloPuntos} punto${soloPuntos!==1?'s':''}</b></div>
    <div class="pill" style="margin-top:8px">de ${posibles} posibles${nuevoRecord ? " · 🏅 ¡nuevo récord!" : ""}</div>`;
  document.getElementById("final-board").innerHTML =
    `<div class="tira-fin">${soloResultados.map(r=> soloTramo(r).emoji).join("")}</div>`;
  // Con cuenta se guarda en el ranking (la base ya fue anotando cada canción)
  rankingFinal(soloResultados.length);
}
// La partida queda también en este navegador: de ahí salen las estadísticas
// y los logros de quien juega sin cuenta.
function guardarPartidaLocal(){
  if(!soloResultados.length) return;
  partidasLocales.unshift({
    canciones: fija ? (fija.tipo==="desafio" ? 10 : fija.opcion) : opts.maxSongs,
    segundos: soloResultados.map(r=> r.ok ? r.seg : 0),
    puntos: soloPuntos,
    jugada: Date.now(),
    videos: soloVideos.slice(),
    genero: datosPartida().genero || null,
    modo: modoAdivina(),
    dia: fija && fija.tipo==="desafio" ? fija.dia : null,
  });
  partidasLocales = partidasLocales.slice(0, MAX_PARTIDAS_LOCALES);
  try{ save(LS_PARTIDAS, partidasLocales); }catch(_){}
}

/* ---- Lo que se suma a la pantalla final ----
   Los logros que destrabó esta partida y, en Un jugador, el duelo: armar uno
   con las canciones que acaban de sonar o, si se estaba respondiendo uno,
   cómo quedó. */
let turnoExtras = 0;
let retoId = null;          // el duelo que ya se armó con esta partida
async function finExtras(){
  const turno = ++turnoExtras;
  retoId = null;
  const logro = document.getElementById("logro-final");
  const box = document.getElementById("duelo-final");
  const nuevos = modo==='solo' && soloResultados.length ? logrosNuevos(partidasLocales) : [];
  logro.innerHTML = logroNuevoHtml(nuevos);
  logro.hidden = !nuevos.length;
  if(nuevos.length) track("logro", { logros: nuevos.map(l=> l.id).join(",") });
  box.hidden = true; box.innerHTML = "";
  if(modo!=='solo' || !soloResultados.length || !cuentasActivas || (fija && fija.tipo==="desafio")) return;

  if(fija && fija.tipo==="duelo"){
    const f = fija, puntos = soloPuntos;
    box.hidden = false;
    box.innerHTML = `<p class="hint" style="margin:0">Anotando tu resultado…</p>`;
    let d = null;
    try{
      const partida = await partidaLista();
      if(partida) d = await anotarDuelo(f.id, partida, puntos, f.nombre);
    }catch(_){}
    if(turno !== turnoExtras) return;
    if(!d){ box.innerHTML = `<p class="hint" style="margin:0">No pudimos anotar tu resultado en el duelo 😕</p>`; return; }
    const v = veredicto(d);
    track("duelo", { accion: "terminar", puntos, gano: v.gano ? "si" : "no", jugaron: d.resultados.length });
    box.innerHTML = `<div class="eyebrow">Duelo</div>
      ${v.txt ? `<div class="duelo-veredicto ${v.gano ? "gano" : ""}">${v.txt}</div>` : ""}
      ${tablaDueloHtml(d)}
      <button type="button" class="btn ghost" onclick="compartirDuelo('${d.id}', this, '🎧 Hice ${puntos} puntos en este duelo de “En una nota”. ¿Me ganás?')">📲 Pasárselo a alguien más</button>`;
    if(v.gano && pantalla==="s-results") papelitos();
    return;
  }
  // Partida común: se puede retar a alguien con estas mismas canciones, si
  // la base la dio por buena (con canciones propias no)
  const partida = await partidaLista().catch(()=> null);
  if(turno !== turnoExtras || !partida || soloResultados.length < 3) return;
  box.hidden = false;
  box.innerHTML = `<button type="button" class="tarjeta reto" onclick="retar(this)">
      <span class="desafio-ic" aria-hidden="true">⚔️</span>
      <span class="grow"><span class="eyebrow">Duelo</span>
        <span class="tarjeta-t">Retá a alguien con estas canciones</span>
        <span class="tarjeta-d">Le llega un link y juega lo mismo que vos</span></span>
      <span class="pill amber">Armar ›</span>
    </button>`;
  entrar(box, 8, 240);
}
// Dos toques a propósito: el primero arma el duelo (hay que esperar a la
// base) y el segundo lo manda. Compartir necesita un toque recién hecho, y
// después de esperar algunos celulares ya no lo dejan.
async function retar(btn){
  const u = usuarioActual();
  const nombre = u ? u.nombre : nombreParaDuelo();
  if(!nombre) return;
  const box = document.getElementById("duelo-final");
  const turno = turnoExtras;
  btn.disabled = true;
  btn.querySelector(".pill").textContent = "Armando…";
  const partida = await partidaLista().catch(()=> null);
  const id = partida ? await crearDuelo(partida, soloInicios, nombre) : null;
  if(turno !== turnoExtras) return;
  if(!id){
    btn.disabled = false;
    btn.querySelector(".pill").textContent = "Armar ›";
    alert("No pudimos armar el duelo. Probá de nuevo en un rato.");
    return;
  }
  retoId = id;
  track("duelo", { accion: "crear", canciones: soloResultados.length });
  const texto = `🎧 Hice ${soloPuntos} ${soloPuntos===1 ? "punto" : "puntos"} en “En una nota”. Te reto: las mismas canciones, desde el mismo segundo. ¿Me ganás?`;
  box.innerHTML = `<div class="eyebrow">Duelo armado</div>
    <div class="tarjeta-t">Mandale el link a quien quieras retar</div>
    <button type="button" class="btn amber big" id="reto-btn">📲 Mandar el duelo</button>
    <span class="tarjeta-d">Cuando lo juegue, abrí el mismo link para ver cómo salió.</span>`;
  document.getElementById("reto-btn").onclick = (ev)=> compartirDuelo(id, ev.currentTarget, texto);
  entrar(box, 6, 220);
}

// El pedido de Cafecito sale al terminar cualquier partida con canciones (el
// cartel fijo al pie casi nadie lo tocaba). La tarjeta entera, solo en los
// momentos altos y con un texto para cada uno: era la misma en todas las
// partidas, cada persona la veía casi cinco veces y la tocaba 1 de cada 100.
// En el resto de las partidas queda solo el botón.
const PARTIDAS_PARA_PEDIR = 1;
const DESCANSO_PEDIDO = 3;   // partidas entre dos tarjetas enteras, salvo que toque un hito
const CON_QR = "(min-width:960px) and (hover:hover) and (pointer:fine)";   // la misma consulta que en styles.css
let momentoPedido = "";      // el del pedido que está en pantalla, para medir el clic
// El equipo que ganó solo: sin empate, con puntos y habiendo a quién ganarle
function ganadorUnico(){
  if(teams.length < 2) return null;
  const tope = Math.max(...teams.map(p=> p.score));
  const arriba = teams.filter(p=> p.score===tope);
  return tope > 0 && arriba.length === 1 ? arriba[0] : null;
}
// primera · hito (3, 5, 10 y cada 10 partidas) · record (pasó uno que ya
// tenía: el de la primera partida no cuenta) · gano · "" si no toca
function momentoCafecito(){
  if(!lastGameSongs) return "";
  const p = jugado.partidas;
  if(p === 1) return "primera";
  const hito = p===3 || p===5 || p%10===0;
  if(hito || p - (jugado.pedido || 0) >= DESCANSO_PEDIDO){
    if(modo==='solo'){ if(nuevoRecord && recordPrevio > 0) return "record"; }
    else if(ganadorUnico()) return "gano";
  }
  return hito ? "hito" : "";
}
function pedirCafecito(){
  const caja = document.getElementById("cafecito-final");
  const mostrar = jugado.partidas >= PARTIDAS_PARA_PEDIR;
  caja.hidden = !mostrar;
  if(!mostrar) return;
  const p = jugado.partidas, c = jugado.canciones;
  // jugado suma las partidas de los dos modos; el texto le habla a quien jugó esta
  const solo = modo==='solo';
  const momento = momentoCafecito();
  momentoPedido = momento || "chico";
  caja.classList.toggle("chico", !momento);
  let titulo = "Bancá el proyecto", texto = "";
  if(momento === "primera"){
    titulo = solo ? "¿Te gustó?" : "¿Les gustó?";
    texto = `Ya ${solo ? "jugaste" : "jugaron"} <b>1 partida</b> con <b>${plural(c, "canción", "canciones")}</b>. ` +
      `Lo hago solo, en mis ratos libres: si ${solo ? "te divirtió" : "les sacó unas risas"}, un cafecito paga las canciones nuevas 💛`;
  } else if(momento === "hito"){
    titulo = `¡Ya van ${p} partidas!`;
    texto = `<b>${p} partidas</b> y <b>${c} canciones</b>: ya ${solo ? "sos" : "son"} de la casa. ` +
      `Lo hago solo, en mis ratos libres, y un cafecito es lo que lo mantiene vivo 💛`;
  } else if(momento === "record"){
    titulo = "¡Rompiste tu récord!";
    texto = `De <b>${recordPrevio}</b> a <b>${soloPuntos} puntos</b>. ` +
      `Si el juego ya te viene acompañando, un cafecito paga las canciones nuevas 💛`;
  } else if(momento === "gano"){
    titulo = "El que pierde, invita";
    texto = `Ganó <b>${esc(ganadorUnico().name)}</b>. ¿Y si los que perdieron invitan el cafecito? ` +
      `Con eso se suman canciones nuevas 💛`;
  }
  document.getElementById("cafe-final").textContent = titulo;
  document.getElementById("cafecito-txt").innerHTML = texto;
  document.getElementById("cafe-qr-txt").innerHTML = `<b>¿Más fácil desde el celu?</b>` +
    (solo ? "Escanealo con la cámara." : "Cualquiera de la juntada lo escanea con la cámara.");
  if(momento){
    jugado.pedido = p;
    try{ save(LS_JUGADO, jugado); }catch(_){}
  }
  // Contra los clics en "cafecito" da la conversión del pedido, momento por momento.
  const conQr = !!momento && !!window.matchMedia && matchMedia(CON_QR).matches;
  track("cafecito_visto", { partidas: p, canciones: c, momento: momentoPedido, qr: conQr ? "si" : "no" });
}

// La imagen que se comparte se muestra ya armada en la pantalla final: antes
// había que tocar "Compartir" para verla, y casi nadie compartía. Reemplaza al
// marcador en texto, que dice lo mismo; si el canvas falla, queda el texto.
function dibujarTarjeta(){
  if(modo!=='solo') return drawCard(teams, lastGameSongs);
  // El pie dice qué fue: el desafío de un día, un duelo o adivinando el artista
  const n = soloResultados.length;
  const pie = fija && fija.tipo==="desafio" ? "Desafío del día · " + fechaCorta(fija.dia)
    : fija ? "Duelo · " + plural(n, "canción", "canciones")
    : modoAdivina()==="artista" ? plural(n, "canción", "canciones") + " · adivinando el artista" : "";
  return drawSoloCard(soloPuntos, n * PUNTOS_SOLO[0], soloResultados, nuevoRecord, pie);
}
function mostrarTarjeta(){
  const box = document.getElementById("result-img");
  let ok = false;
  try{
    box.querySelector("img").src = dibujarTarjeta().toDataURL("image/jpeg", 0.85);
    ok = true;
  }catch(e){}
  box.hidden = !ok;
  document.getElementById("winner").hidden = ok;
  document.getElementById("final-board").hidden = ok;
  document.querySelector("#s-results .medal").hidden = ok;
}

function rematch(){
  if(fija){ goHome(); return; }      // el desafío y los duelos no se repiten
  track("revancha", { canciones: lastGameSongs, modo_juego: modo });
  teams.forEach(p=>p.score=0);
  resetSolo();
  limpiarMarcador();
  played=[]; brokenIds=new Set(); songNo=1;
  inicioPartida = Date.now();
  if(modo==='solo') soloEmpezar(opts.maxSongs, datosPartida());
  show("s-game"); newSong();
}

// Volver al menú sin recargar la página: así los equipos (y sus nombres) siguen ahí.
function goHome(){
  pararCuenta(); callarPulsadores(true);
  try{ mediaStop(); }catch(_){}
  if(yt && yt.stopVideo){ try{ yt.stopVideo(); }catch(_){} }
  teams.forEach(p=>p.score=0);
  resetSolo();
  played=[]; brokenIds=new Set(); songNo=1;
  currentSong=null; phase='ready'; answeringTeam=-1; revealed=false;
  turnoExtras++;
  // Después del desafío, la tarjeta del inicio tiene que mostrar el puesto nuevo
  const eraDesafio = fija && fija.tipo==="desafio";
  soltarFija();
  show("s-inicio");
  if(eraDesafio) traerDesafio(true).then(()=>{ if(pantalla==="s-inicio") renderDesafioCard(); });
}

/* ============================================================
   COMPARTIR
   El link del juego (shareGame) está en share.js, que también usa la página
   de Cómo se juega.
   ============================================================ */

// Comparte una imagen con el resultado de la partida que acaban de jugar.
// Es distinto de shareGame(): eso manda un aviso del juego, esto manda lo que
// les pasó a ellos — que es lo que la gente realmente reenvía al grupo.
let sharingResult = false;
// desde: 'imagen' (tocaron la tarjeta) o 'boton' (el botón de abajo)
async function shareResult(btn, desde){
  if(sharingResult) return;              // doble toque mientras genera la imagen
  sharingResult = true;
  const previo = btn ? btn.textContent : null;
  if(btn){ btn.textContent = "🖼️ Armando la imagen…"; btn.disabled = true; }
  try{
    let texto;
    if(modo==='solo'){
      // Los cuadritos también van en el texto, como Wordle: se ven aunque no se abra la imagen
      const tira = soloResultados.slice(0, 30).map(r=> soloTramo(r).emoji).join("");
      const pts = `${soloPuntos} punto${soloPuntos!==1?"s":""}`;
      texto = fija && fija.tipo==="desafio"
        ? `🗓️ Desafío del día (${fechaCorta(fija.dia)}) en “En una nota”: ${pts}
${tira}
¿Cuánto hacés vos?`
        : `🎧 Hice ${pts} adivinando ${modoAdivina()==="artista" ? "artistas" : "canciones"} en “En una nota”
${tira}
¿Me superás?`;
    } else {
      const orden = [...teams].sort((a,b)=> b.score - a.score);
      const campeon = orden[0];
      const empate = campeon && orden.filter(t=>t.score===campeon.score).length > 1;
      texto = campeon && !empate
        ? `🏆 Ganó ${campeon.name} con ${campeon.score} punto${campeon.score!==1?"s":""} en “En una nota”. ¿Se animan?`
        : "🎤 Así quedó nuestra partida de “En una nota”. ¿Se animan?";
    }
    // En un duelo el link es el del duelo: el que lo recibe juega lo mismo
    const link = modo==='solo' && fija && fija.tipo==="duelo" ? LINK_DUELO + fija.id : SHARE_URL;
    const r = await shareCard(dibujarTarjeta(), texto, link);
    track("compartir", { que: "resultado", resultado: r, canciones: lastGameSongs, desde: desde || "boton", modo_juego: modo });
    if(r === "descargado") alert("Guardamos la imagen del resultado y copiamos el link 🎶 Mandala al grupo.");
    else if(r === "error") alert("No pudimos compartir desde acá. Probá con el botón “Compartir el juego”.");
  }catch(e){
    alert("No pudimos armar la imagen. Probá con el botón “Compartir el juego”.");
  }finally{
    if(btn){ btn.textContent = previo; btn.disabled = false; }
    sharingResult = false;
  }
}

/* ============================================================
   COMENTARIOS
   El formulario lo recibe Netlify Forms (el markup está en index.html). Se
   manda por fetch para no recargar la página ni sacar a nadie del juego; si la
   respuesta falla — pasa al abrirlo con npm run dev, donde Netlify no existe —
   el texto queda escrito para volver a intentar. No hay otro canal de contacto.
   ============================================================ */

async function sendFeedback(ev){
  ev.preventDefault();
  const form  = ev.target;
  const btn   = document.getElementById("fb-send");
  const state = document.getElementById("fb-state");
  const datos = new FormData(form);
  if(!String(datos.get("mensaje") || "").trim()) return;
  if(datos.get("bot-field")) return;            // lo llenó un bot: no mandamos nada
  state.className = "feedback-state";
  state.textContent = "Enviando…";
  if(btn){ btn.disabled = true; }
  try{
    const r = await fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(datos).toString(),
    });
    if(!r.ok) throw new Error("HTTP " + r.status);
    form.reset();
    state.className = "feedback-state ok";
    state.textContent = "¡Gracias! Tu comentario ya me llegó 💛";
    track("comentario", { estado: "enviado" });
  }catch(e){
    state.className = "feedback-state err";
    state.textContent = "No pudimos enviarlo. Revisá tu conexión y probá de nuevo en un rato: lo que escribiste sigue ahí.";
    track("comentario", { estado: "error" });
  }finally{
    if(btn){ btn.disabled = false; }
  }
}

/* ============================================================
   INIT + wiring
   Los onclick/oninput del HTML llaman funciones globales,
   así que exponemos los handlers en window.
   ============================================================ */
Object.assign(window, {
  show, irA, volver, elegirModo, repetirUltima, toggleTodos, setMaxSongs, setPenalty,
  toggleGenre, setModo, addTeam, removeTeam, setTeamName, setLink,
  addCustomSong, removeCustom, onAudioFiles, removeLocal,
  startGame, playSnippet, playContinuous, stopPlayback,
  pickTeam, pickAll, backToDecide, skipSong, revealAnswer,
  scoreTeam, toggleHit, scoreHits, scoreAllHit, scoreNone, finishRound, endGame, rematch, goHome,
  onYouTubeIframeAPIReady, resetHistory, shareGame, shareResult, sendFeedback,
  onGuessInput, onGuessKey, guessSong, noSe,
  // desafío del día, duelos, décadas, pistas, tiempo, pulsadores, reportes y listas
  jugarDesafio, jugarDuelo, compartirDuelo, retar, toggleDecada, todasLasDecadas,
  setAdivina, setTiempo, setPulsadores, pedirPista, abrirReporte, reportar, compartirLista,
});

// Clics en Cafecito. Analytics ya cuenta los clics a otros sitios, pero no
// distingue cuál de los dos botones fue ni si fue antes o después de jugar.
document.addEventListener("click", (ev)=>{
  const a = ev.target.closest && ev.target.closest("a[data-cafecito]");
  if(!a) return;
  const pantalla = document.querySelector(".screen.on");
  track("cafecito", {
    desde: a.dataset.cafecito,
    pantalla: pantalla ? pantalla.id.replace("s-","") : "",
    partidas: jugado.partidas,
    // en la pantalla final, qué pedido había a la vista (primera, hito, record, gano o chico)
    ...(a.dataset.cafecito === "final" ? { momento: momentoPedido } : {}),
  });
});

// Cerrar la pestaña (o la app) en plena partida no pasa por endGame: sin esto
// esas partidas no figuran en ningún lado y parece que todas llegan al final.
addEventListener("pagehide", ()=>{
  if(pantalla!=="s-game") return;
  trackAlSalir("partida_abandonada", {
    modo_juego: modo,
    numero: songNo,                          // en qué canción la dejaron
    canciones_por_partida: opts.maxSongs,
    duracion_seg: duracionPartida(),
  });
});

function boot(){
  // Si es la primera vez (o se borraron los datos), arranca con dos equipos.
  if(teams.length === 0){ addTeam("Equipo 1"); addTeam("Equipo 2"); }
  else renderTeams();
  setModo(modo);
  wireAudio();
  renderLocalList();
  // Las canciones propias de YouTube ahora van con la ficha "Mis canciones".
  // A quien ya las tenía y venía jugando con ellas mezcladas, se le deja
  // elegida esa ficha en su última partida (una sola vez).
  if(!load(LS_PROPIAS, false)){
    if(countLinked() && ultima && Array.isArray(ultima.generos) && !ultima.generos.includes("local")){
      ultima.generos.push("local");
      try{ save(LS_ULTIMA, ultima); }catch(_){}
    }
    try{ save(LS_PROPIAS, true); }catch(_){}
  }
  show("s-inicio");
  // Links que abren algo: ?sala= (el pulsador de un celular), ?duelo=, ?lista=
  // y ?liga= (la toma cuenta.js cuando hay sesión). Se sacan de la barra.
  codigoDelLink();
  const sala = salaDelLink();
  const q = new URLSearchParams(location.search);
  const duelo = q.get("duelo"), lista = q.get("lista");
  if(q.has("duelo") || q.has("lista")){
    q.delete("duelo"); q.delete("lista");
    const resto = q.toString();
    history.replaceState(history.state, "", location.pathname + (resto ? "?" + resto : "") + location.hash);
  }
  if(sala !== null){ show("s-pulsador"); entrarASala(sala); }
  else if(duelo && /^[a-z0-9]{8}$/.test(duelo)) abrirDuelo(duelo);
  else if(lista && /^[a-z0-9]{8}$/.test(lista)) importarLista(lista);
  // La entrada escalonada del inicio ya terminó: que no se repita al volver
  setTimeout(()=> document.body.classList.remove("estreno"), 1500);
  // Al entrar o salir de la cuenta cambian el saludo, el récord con su puesto
  // y lo que muestra Mi cuenta
  iniciarCuentas({ show, alCambiar: ()=>{
    if(pantalla==="s-inicio") renderInicio();
    if(pantalla==="s-cuenta") renderCuentaLocal();
  }});
  // Las páginas de ayuda enlazan a ../#ranking, ../#cuenta y ../#comentarios:
  // se abre esa sección y el #… se saca de la barra (no queda en un link compartido)
  const hash = location.hash;
  const desde = { "#ranking":"ranking", "#cuenta":"cuenta", "#comentarios":"cuenta" }[hash];
  if(desde){
    history.replaceState(history.state, "", location.pathname + location.search);
    irA(desde);
  }
  // El formulario está en Mi cuenta: se abre y se baja hasta él después del
  // scroll arriba que hace show()
  if(hash === "#comentarios"){
    document.getElementById("comentarios").open = true;
    requestAnimationFrame(()=> requestAnimationFrame(()=>
      document.getElementById("comentarios").scrollIntoView({ block:"start" })));
  }
}
boot();

// Cargar la API de YouTube (dispara window.onYouTubeIframeAPIReady al terminar)
(function loadYouTubeApi(){
  if(window.YT && window.YT.Player){ onYouTubeIframeAPIReady(); return; }
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
})();
