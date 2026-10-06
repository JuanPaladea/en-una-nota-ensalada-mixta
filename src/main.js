import "./styles.css";
import { GENRES } from "./data.js";
import { load, save, songKey, esc, extractVideoId, norm } from "./utils.js";
import { idbPut, idbGet, idbDel } from "./idb.js";
import { shareCard, drawCard, drawSoloCard, soloTramo } from "./sharecard.js";
import { track } from "./analytics.js";
import { SHARE_URL, shareGame } from "./share.js";

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
let links = load(LS_LINKS, {});          // { songKey: videoId }
let customSongs = load(LS_CUSTOM, []);    // [{t,a,gid}]
let localTracks = load(LS_LOCAL, []);     // [{id,t,a}] audio guardado en IndexedDB
let playedHistory = load(LS_HISTORY, []); // keys ya sonadas en partidas anteriores (persiste entre partidas)
let jugado = load(LS_JUGADO, { partidas: 0, canciones: 0 }); // lo jugado en este navegador, para el pedido de Cafecito
const localUrls = {};                     // id -> objectURL (cache de sesión)
const memBlobs = {};                      // id -> File (respaldo en memoria si IndexedDB no está disponible)
let selectedGenres = new Set();
// Equipos: los nombres se guardan en localStorage y sobreviven a la revancha,
// al volver al menú principal y a recargar la página (los puntos no).
let teams = loadTeams();                  // [{name, score}]
let opts = { noRepeat:true, maxSongs:10, penalty:false }; // penalty: el que arriesga y erra pierde un punto
// 'grupo' = equipos, el grupo juzga · 'solo' = se escribe el título y el juego lo comprueba
let modo = load(LS_MODO, "grupo") === "solo" ? "solo" : "grupo";
let record = load(LS_RECORD, {});         // modo solo: { "10": mejor puntaje con 10 canciones, ... }

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
  GENRES.forEach(g=> g.songs.forEach(([t,a,yt])=> base.push({t,a,gid:g.id,yt:yt||null})));
  customSongs.forEach(s=> base.push({t:s.t,a:s.a,gid:s.gid||"custom",yt:null}));
  localTracks.forEach(s=> base.push({t:s.t,a:s.a||"Archivo local",gid:"local",yt:null,local:true,id:s.id}));
  return base;
}
// ID efectivo: el que puso el usuario (localStorage) manda sobre el precargado
function effId(gid, t, yt){ return links[songKey(gid,t)] || yt || null; }
function countLinked(){
  let n=0;
  GENRES.forEach(g=> g.songs.forEach(([t,a,yt])=>{ if(effId(g.id,t,yt)) n++; }));
  customSongs.forEach(s=>{ if(effId(s.gid||"custom", s.t, null)) n++; });
  return n;
}

/* ============================================================
   NAVEGACIÓN / UTILIDADES DE UI
   ============================================================ */
function show(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("on"));
  document.getElementById(id).classList.add("on");
  // El CSS usa esta clase para sacar de la pantalla de juego lo que no se juega:
  // los comentarios y el pie. El logo se queda.
  document.body.classList.toggle("playing", id==="s-game");
  scrollTop();
  if(id==="s-armar") renderSongList();
}
// El menú es largo y abajo de todo están los comentarios: si no volvemos
// arriba a mano, al apretar "¡A jugar!" la pantalla se queda donde estaba y lo
// primero que se ve es esa sección, con el juego fuera de cuadro. Va sin
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
function flash(color){
  const f=document.getElementById("flash");
  f.style.background=color; f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}

/* ============================================================
   SETUP: géneros y jugadores
   ============================================================ */
function renderGenres(){
  const el = document.getElementById("genres");
  let html = GENRES.map(g=>{
    const sel = selectedGenres.has(g.id) ? "sel":"";
    return `<div class="genre ${sel}" onclick="toggleGenre('${g.id}')">
      <div class="tick">✓</div>
      <div class="em">${g.em}</div>
      <div class="gn">${esc(g.name)}</div>
    </div>`;
  }).join("");
  // Playlist de audios locales (siempre visible; destaca porque suena seguro)
  const selL = selectedGenres.has("local") ? "sel":"";
  html += `<div class="genre ${selL}" onclick="toggleGenre('local')" style="border-color:var(--lime)">
      <div class="tick">✓</div>
      <div class="em">🎵</div>
      <div class="gn">Mis canciones</div>
      <div class="gc">${localTracks.length} archivo${localTracks.length!==1?'s':''} · <b style="color:var(--lime)">suena seguro</b></div>
    </div>`;
  el.innerHTML = html;
}
function toggleGenre(id){
  selectedGenres.has(id) ? selectedGenres.delete(id) : selectedGenres.add(id);
  renderGenres(); updatePoolWarn();
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
  if(modo !== antes) track("modo_elegido", { modo });
  const solo = modo === "solo";
  document.getElementById("modo-grupo").setAttribute("aria-pressed", String(!solo));
  document.getElementById("modo-solo").setAttribute("aria-pressed", String(solo));
  document.getElementById("teams-box").hidden = solo;
  document.getElementById("solo-box").hidden = !solo;
  document.getElementById("opt-penalty-box").hidden = solo;
}
function setTeamName(i, val){ if(teams[i]){ teams[i].name = val; saveTeams(); } }
function removeTeam(i){ teams.splice(i,1); saveTeams(); renderTeams(); }

function buildPool(){
  pool = [];
  allSongs().forEach(s=>{
    const inSel = selectedGenres.has(s.gid) || s.gid==="custom";
    if(!inSel) return;
    const key = songKey(s.gid, s.t);
    if(s.local){ pool.push({...s, key}); return; }   // audio local: ya trae id
    const id = links[key] || s.yt;                    // usuario o precargado
    if(id) pool.push({...s, id, key});
  });
}
function updatePoolWarn(){
  buildPool();
  const el=document.getElementById("pool-warn");
  if(selectedGenres.size===0){ el.innerHTML=""; return; }
  if(pool.length===0){
    const onlyLocal = selectedGenres.has("local") && selectedGenres.size===1;
    el.innerHTML=`<div class="card" style="border-color:var(--no)">
      <b>⚠️ No hay canciones para jugar</b> en lo que elegiste.
      Entrá a <a href="#" onclick="show('s-armar');return false">🔗 Armar canciones</a> y ${onlyLocal?'cargá tus archivos de audio':'cargá tus audios o pegá links de YouTube'} para poder jugar.</div>`;
  } else {
    el.innerHTML=`<div class="pill" style="display:block;text-align:center">🎶 Playlist lista para sortear</div><div style="height:12px"></div>`;
  }
}

/* ============================================================
   ARMAR PLAYLIST
   ============================================================ */
function songRow(s){
  const key = songKey(s.gid, s.t);
  const override = links[key];              // link propio del usuario
  const id = override || s.yt;              // efectivo
  const preloaded = !override && s.yt;      // usa el precargado, sin tocar
  const q = encodeURIComponent(s.t + " " + s.a);
  const badgeTxt = override ? "✔ tu link" : (s.yt ? "✔ precargada" : "sin link");
  return `<div class="song">
    <div class="top">
      <div>
        <div class="tt">${esc(s.t)}</div>
        <div class="aa">${esc(s.a)}</div>
      </div>
      <span class="badge ${id?'linked':'empty'}">${badgeTxt}</span>
    </div>
    <div class="link-row">
      <a class="btn amber mini" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">🔎 Buscar</a>
      <input type="url" placeholder="${preloaded?'Precargada · pegá otro link para cambiarla':'Pegá el link de YouTube…'}"
        value="${override?('https://youtu.be/'+override):''}"
        oninput="setLink('${key}', this.value, this, '${s.yt||''}')">
      ${s.custom!==undefined?`<button class="x" onclick="removeCustom(${s.custom})">✕</button>`:""}
    </div>
  </div>`;
}
function renderSongList(){
  let html = "";
  let linkedCount = 0;
  GENRES.forEach(g=>{
    const rows = g.songs.map(([t,a,yt])=>{
      if(effId(g.id,t,yt)) linkedCount++;
      return songRow({t,a,yt:yt||null,gid:g.id});
    }).join("");
    html += `<details class="gsec" open>
      <summary><span class="gsum-name">${g.em} ${esc(g.name)}</span></summary>
      <div class="gbody">${rows}</div>
    </details>`;
  });
  if(customSongs.length){
    const rows = customSongs.map((s,idx)=>{
      if(effId(s.gid||"custom", s.t, null)) linkedCount++;
      return songRow({t:s.t,a:s.a,yt:null,gid:s.gid||"custom",custom:idx});
    }).join("");
    html += `<details class="gsec" open>
      <summary><span class="gsum-name">➕ Propias (YouTube)</span><span class="gcount">${customSongs.length}</span></summary>
      <div class="gbody">${rows}</div>
    </details>`;
  }
  document.getElementById("songlist").innerHTML = html;
  document.getElementById("link-count").textContent = linkedCount + " con audio";
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
  if(added) track("audio_propio_cargado", { cantidad: added, fallidos: failed });
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
  renderLocalList(); renderGenres(); updatePoolWarn();
}
function setLink(key, val, inputEl, builtinYt){
  const id = extractVideoId(val);
  if(id){ links[key]=id; inputEl.style.borderColor="var(--ok)"; }
  else if(val.trim()===""){ delete links[key]; inputEl.style.borderColor=""; }
  else { inputEl.style.borderColor="var(--no)"; return; }
  save(LS_LINKS, links);
  document.getElementById("link-count").textContent = countLinked() + " vinculadas";
  const eff = id || builtinYt || null;
  const badge = inputEl.closest(".song").querySelector(".badge");
  badge.className = "badge " + (eff ? "linked" : "empty");
  badge.textContent = id ? "✔ tu link" : (builtinYt ? "✔ precargada" : "sin link");
}
function addCustomSong(){
  const t = prompt("Título de la canción:");
  if(!t) return;
  const a = prompt("Artista:") || "";
  customSongs.push({t:t.trim(), a:a.trim(), gid:"custom"});
  save(LS_CUSTOM, customSongs);
  renderSongList();
}
function removeCustom(idx){
  const s = customSongs[idx];
  if(s) delete links[songKey(s.gid||"custom", s.t)];
  customSongs.splice(idx,1);
  save(LS_CUSTOM, customSongs); save(LS_LINKS, links);
  renderSongList();
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
function clearSnippetTimer(){ if(snippetTimer){ clearTimeout(snippetTimer); snippetTimer=null; } }
// Al empezar a sonar (evento del medio), si estamos en modo fragmento, programa el corte.
function armSnippet(){
  if(!pauseAfterSnippet) return;
  if(inicioClip===null) inicioClip = mediaTime();   // de acá vuelve a arrancar cada intento
  clearSnippetTimer();
  snippetTimer = setTimeout(snippetPause, snippetMs);
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
  const eq=document.getElementById("eq");
  if(e.data===YT.PlayerState.PLAYING){
    // En 'ready' todavía nadie apretó play: lo que está sonando es la precarga
    // (o un rebote del seek). Se frena y se mantiene muteado — que se escuche
    // acá sería revelar la canción antes de tiempo, así que nunca se desmutea
    // en esta fase. El seek al punto de arranque se hace una sola vez.
    if(phase==='ready'){
      try{
        yt.pauseVideo();
        if(prebuffering){
          startAt = fitStart(startAt, yt.getDuration());
          yt.seekTo(startAt, true);
        }
      }catch(_){}
      prebuffering=false;
      return;
    }
    try{ yt.unMute(); yt.setVolume(100); }catch(_){}
    if(eq) eq.classList.remove("paused");
    armSnippet();   // si es fragmento de 1s, programa el corte
  } else if(e.data===YT.PlayerState.PAUSED){
    if(eq) eq.classList.add("paused");
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
  currentSong = alt; seekedThisRound=false; mediaStarted=false; segundos=0; fallidos=[]; inicioClip=null;
  if(continuousMode) playContinuous(); else playSnippet();
}

/* ---- Capa de medios: unifica audio local (<audio>) y YouTube ---- */
function eqPlaying(){ const eq=document.getElementById("eq"); if(eq) eq.classList.remove("paused"); }
function eqPaused(){ const eq=document.getElementById("eq"); if(eq) eq.classList.add("paused"); }
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
  currentSong = alt; seekedThisRound=false; mediaStarted=false; segundos=0; fallidos=[]; inicioClip=null;
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
  startAt = randomStart();
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
  try{ yt.unMute(); yt.setVolume(100); yt.loadVideoById({videoId:s.id, startSeconds:randomStart()}); }
  catch(e){ onPlayerError({data:5}); }
  return true;
}
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

function startGame(){
  if(selectedGenres.size===0){ alert("Elegí al menos un género."); return; }
  buildPool();
  if(pool.length===0){ alert("No hay canciones para jugar. Entrá a 🔗 Armar canciones y agregá algunos links."); return; }
  if(modo==='solo'){
    armarCatalogo();
    resetSolo();
  } else {
    teams.forEach((p,i)=>{ if(!p.name.trim()) p.name="Equipo "+(i+1); p.score=0; });
    if(teams.length===0){ teams=[{name:"Equipo 1",score:0}]; }
    saveTeams();   // los nombres quedan guardados para la próxima partida
  }
  opts.noRepeat = true;   // siempre: no se repiten canciones en una partida
  const ms = document.getElementById("opt-maxsongs");
  opts.maxSongs = ms ? parseInt(ms.value,10) : 0;
  const pen = document.getElementById("opt-penalty");
  opts.penalty = !!(pen && pen.checked);
  played=[]; brokenIds=new Set(); songNo=1;
  track("partida_iniciada", {
    modo,
    generos: [...selectedGenres].join(","),
    cantidad_generos: selectedGenres.size,
    equipos: modo==='solo' ? 1 : teams.length,
    canciones_por_partida: opts.maxSongs,
    resta_puntos: modo==='grupo' && opts.penalty,
    canciones_disponibles: pool.length,
  });
  show("s-game");
  newSong();
}
// total de canciones que durará la partida (para el contador "X / Y")
function totalSongs(){
  if(opts.maxSongs) return opts.noRepeat ? Math.min(opts.maxSongs, pool.length) : opts.maxSongs;
  return opts.noRepeat ? pool.length : 0;   // 0 = ilimitado
}

// Devuelve una canción nueva, o null si se agotaron (con "no repetir" activo).
// force=true: solo lo usa el auto-salto de errores, permite repetir para no trabarse.
// Además de no repetir dentro de la partida, evita (mientras sea posible) canciones
// que ya sonaron en partidas anteriores — ese historial se guarda en localStorage.
function pickSong(force){
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
function resetHistory(){
  playedHistory = [];
  save(LS_HISTORY, playedHistory);
  alert("Listo, se reinició el historial. Las canciones ya escuchadas pueden volver a salir desde la próxima partida.");
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
  if(opts.maxSongs && songNo > opts.maxSongs){ endGame('limit'); return; }
  const s = pickSong();
  if(!s){ endGame('agotada'); return; }
  currentSong = s;
  preloadArt(s);
  seekedThisRound=false; revealed=false; answeringTeam=-1; skipping=false; skipTries=0;
  segundos=0; fallidos=[]; inicioClip=null; soloRes=null; sugerencias=[];
  mediaStarted=false; continuousMode=false; pauseAfterSnippet=false; clearSnippetTimer();
  phase='ready';
  prepareMedia(s);   // se carga mientras leen la pantalla, no cuando aprietan play
  const tot = totalSongs();
  document.getElementById("round-pill").textContent = tot ? ("Canción "+songNo+" / "+tot) : ("Canción "+songNo);
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
  snippetMs = modo==='solo' ? (segundos+1)*SNIPPET_MS : SNIPPET_MS;
  continuousMode=false;
  pauseAfterSnippet=true;
  phase='listening';
  setCover("🎵 Sonando…");
  renderPhase();
  if(!mediaStarted){
    if(mediaStart()){ mediaStarted=true; segundos++; trackCancion("corte"); }
    else { pauseAfterSnippet=false; phase='ready'; renderPhase(); }
  } else {
    if(modo==='solo' && inicioClip!==null) mediaSeek(inicioClip);
    mediaResume(); segundos++;
  }
}
// Reproduce sin cortar hasta que aprieten detener.
function playContinuous(){
  clearSnippetTimer();
  pauseAfterSnippet=false;
  continuousMode=true;
  phase='continuous';
  setCover("🎵 Sonando… ¡hasta que corten!");
  renderPhase();
  if(!mediaStarted){
    if(mediaStart()){ mediaStarted=true; trackCancion("continuo"); }
    else { continuousMode=false; phase='decide'; renderPhase(); }
  } else mediaResume();
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
  answeringTeam=i; skipping=false; phase='answering'; revealed=false;
  renderPhase(); renderBoard();
}
function pickAll(){
  clearSnippetTimer(); continuousMode=false;
  answeringTeam='all'; skipping=false; phase='answering'; revealed=false;
  allHits=new Set();
  renderPhase(); renderBoard();
}
function backToDecide(){
  clearSnippetTimer(); continuousMode=false;
  phase='decide'; answeringTeam=-1;
  setCover("✋ ¿Quién arriesga?", true);
  renderPhase(); renderBoard();
}

// saltear la canción (nadie la sabe / punto para nadie): revela y no da puntos
function skipSong(){
  clearSnippetTimer(); continuousMode=false;
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
  cover.innerHTML=`
    ${art?`<div class="rev-bg" style="background-image:url('${art}')"></div>`:""}
    <div class="rev">
      <div class="st">Era…</div>
      <div class="rev-t">${esc(currentSong.t)}</div>
      <div class="rev-a">${esc(currentSong.a)}</div>
      ${art?`<img class="rev-img" src="${art}" alt="Imagen de ${esc(currentSong.t)}, de ${esc(currentSong.a)}"
        onerror="this.remove();var b=document.querySelector('.rev-bg');if(b)b.remove()">`:""}
    </div>`;
}
function revealAnswer(){
  revealed=true; revealCover();
  mediaResume();   // reanuda para comprobar si la pegó
  renderPhase();
}

// fin de la canción actual → siguiente (o fin de partida)
function finishRound(){
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
  teams.forEach((p,i)=>{ if(allHits.has(i)) p.score++; else bajar(p); });
  flash(allHits.size ? "var(--ok)" : "var(--no)"); finishRound();
}
// Atajo para cuando la pegaron todos: no hace falta marcar equipo por equipo.
function scoreAllHit(){
  allHits = new Set(teams.map((_,i)=>i));
  scoreHits();
}
function scoreNone(){ penalize(); flash("var(--no)"); finishRound(); }

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
let segundos = 0;          // fragmentos que sonaron de la canción actual
let fallidos = [];         // títulos que probó y no eran
let soloRes = null;        // resultado de la canción actual, una vez resuelta
let nuevoRecord = false;
let catalogo = [];         // títulos para autocompletar [{t, a, nt, na}]
let sugerencias = [], sugSel = 0;

// Lo que vale acertar con lo que ya sonó (antes de sonar nada, lo máximo).
const valeAhora = ()=> PUNTOS_SOLO[Math.max(0, segundos-1)];
const valeConUnoMas = ()=> PUNTOS_SOLO[Math.min(segundos, MAX_SEGUNDOS-1)];

function resetSolo(){ soloPuntos = 0; soloResultados = []; nuevoRecord = false; }

// Se autocompleta con todo el catálogo, no solo con los géneros elegidos: si
// no, jugando con una playlist chica la lista de opciones ya era media pista.
function armarCatalogo(){
  const vistos = new Set();
  catalogo = [];
  allSongs().forEach(s=>{
    const nt = norm(s.t), na = norm(s.a);
    if(!nt || vistos.has(nt+"|"+na)) return;
    vistos.add(nt+"|"+na);
    catalogo.push({ t:s.t, a:s.a, nt, na });
  });
}
// Primero los títulos que empiezan con lo escrito, después los que lo tienen
// al principio de una palabra, en el medio, y al final los que coinciden
// palabra por palabra contando el artista ("persiana soda").
function buscarTitulos(q){
  const n = norm(q);
  if(n.length < 2) return [];
  const palabras = n.split(" ");
  const hits = [];
  for(const s of catalogo){
    const rank = s.nt.startsWith(n) ? 0
      : (" "+s.nt).includes(" "+n) ? 1
      : s.nt.includes(n) ? 2
      : palabras.every(p=> (s.nt+" "+s.na).includes(p)) ? 3 : -1;
    if(rank >= 0) hits.push([rank, s]);
  }
  hits.sort((a,b)=> a[0]-b[0] || a[1].t.localeCompare(b[1].t));
  return hits.slice(0, 4).map(h=> h[1]);
}
function renderSugerencias(q){
  const el = document.getElementById("guess-list");
  if(!el) return;
  if(!sugerencias.length){
    el.innerHTML = norm(q).length >= 2
      ? `<p class="hint sug-nada">No está en la lista: probá con otra palabra o con el artista</p>` : "";
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
  if(s.nt === norm(currentSong.t)){ resolverSolo(true); return; }
  fallidos.push(s.t);
  if(segundos >= MAX_SEGUNDOS){ resolverSolo(false); return; }
  flash("var(--no)");
  playSnippet();
}
function noSe(){ if(modo==='solo' && phase==='decide') resolverSolo(false); }
function resolverSolo(ok){
  clearSnippetTimer();
  const pts = ok ? valeAhora() : 0;
  soloRes = { ok, seg: segundos, pts };
  soloPuntos += pts;
  soloResultados.push(soloRes);
  phase='answering'; revealed=true;
  revealCover(); mediaResume();   // se escucha cómo seguía
  flash(ok ? "var(--ok)" : "var(--no)");
  track("solo_respuesta", {
    resultado: ok ? "acierto" : (fallidos.length ? "error" : "no_se"),
    segundos, fallidos: fallidos.length, puntos: pts,
    numero: songNo,
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
    sub.textContent = segundos > 1 ? "Desde el mismo punto, " + segundos + " segundos" : "Escuchá bien…";
    c.innerHTML=`<button class="btn amber big" onclick="stopPlayback()">✋ Cortar ya</button>`;
  } else if(phase==='decide'){
    t.textContent="🤔 ¿Qué canción es?";
    const ultimo = fallidos[fallidos.length-1];
    sub.textContent = (ultimo ? "No era “" + ultimo + "” · " : "") +
      "Ahora vale " + pts(valeAhora()) + " · intento " + segundos + " de " + MAX_SEGUNDOS;
    const hayMas = segundos < MAX_SEGUNDOS;
    // La lista va arriba del campo: en el celular, abajo la tapa el teclado.
    c.innerHTML=`<div class="guess">
        <div id="guess-list" class="sugs" role="listbox" aria-label="Canciones que coinciden"></div>
        <input type="text" id="guess-in" placeholder="Escribí el título…" autocomplete="off"
          autocapitalize="off" spellcheck="false" enterkeyhint="go" aria-label="Título de la canción"
          oninput="onGuessInput()" onkeydown="onGuessKey(event)">
      </div>
      <div class="solo-acc">
        <button class="btn amber" onclick="playSnippet()" ${hayMas?'':'disabled'}>${hayMas ? '▶ Escuchar '+(segundos+1)+' segundos · vale '+valeConUnoMas() : 'Ya no quedan intentos'}</button>
        <button class="btn ghost" onclick="noSe()">🏳️ No sé · ver cuál era</button>
      </div>`;
    sugerencias = [];
    // En la compu se escribe directo. En el celular no: el teclado taparía
    // "Escuchar 2 segundos" justo cuando quizás lo quiere tocar.
    if(window.matchMedia && matchMedia("(pointer:fine)").matches) document.getElementById("guess-in").focus();
  } else if(phase==='answering' && soloRes){
    if(soloRes.ok){
      t.textContent="✅ ¡La sacaste!";
      sub.textContent="+" + pts(soloRes.pts) + " · con " + soloRes.seg + " segundo" + (soloRes.seg!==1?"s":"");
    } else {
      t.textContent="❌ Era esta";
      sub.textContent="0 puntos · escuchá cómo seguía";
    }
    c.innerHTML=`<button class="btn mag big" onclick="finishRound()">⏭ Siguiente canción</button>`;
  }
}

function renderPhase(){
  const c=document.getElementById("controls");
  const t=document.getElementById("phase-title");
  const sub=document.getElementById("phase-sub");
  if(modo==='solo'){ renderSolo(c, t, sub); return; }
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
    sub.textContent="Elijan quién canta la que sigue — o escuchen un poco más";
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
      c.innerHTML=`<button class="btn mag big" onclick="finishRound()">⏭ Siguiente canción</button>`;
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

function renderBoard(){
  if(modo==='solo'){
    // las últimas canciones como cuadritos de color, para ver cómo viene
    const tira = soloResultados.slice(-8).map(r=> soloTramo(r).emoji).join("");
    document.getElementById("board").innerHTML = `
      <div class="brow">
        <span>🎧 Tus puntos ${tira ? `<span class="tira">${tira}</span>` : ""}</span>
        <span class="pts">${soloPuntos}</span>
      </div>`;
    return;
  }
  const cur = (i)=> answeringTeam==='all' || i===answeringTeam;
  const board = teams.map((p,i)=>`
    <div class="brow ${cur(i)?'cur':''}">
      <span>${cur(i)?'🎤 ':''}${esc(p.name)}</span>
      <span class="pts">${p.score}</span>
    </div>`).join("");
  document.getElementById("board").innerHTML = board;
}

function endGame(reason){
  try{ mediaStop(); }catch(_){}
  if(yt && yt.stopVideo){ try{ yt.stopVideo(); }catch(_){} }
  // canciones que llegaron a terminarse. En solo cuentan las resueltas: si la sacó
  // y tocó Terminar sin pasar a la siguiente, esa también va (está en la tarjeta).
  lastGameSongs = modo==='solo' ? soloResultados.length : Math.max(0, songNo - 1);
  track("partida_terminada", {
    modo,
    motivo: reason || "manual",       // limit = llegó al tope, agotada = se acabó la playlist
    canciones: lastGameSongs,
    equipos: modo==='solo' ? 1 : teams.length,
    puntos_ganador: modo==='solo' ? soloPuntos : Math.max(...teams.map(p=>p.score), 0),
  });
  if(lastGameSongs > 0){
    jugado.partidas++; jugado.canciones += lastGameSongs;
    try{ save(LS_JUGADO, jugado); }catch(_){}
  }
  const head = document.querySelector("#s-results h2");
  if(head) head.textContent = reason==='agotada' ? "¡Se acabaron las canciones!" : "¡Terminó la partida!";
  const solo = modo==='solo';
  document.getElementById("rematch-btn").textContent = solo ? "🔁 Jugar otra vez" : "🔁 Revancha (mismos equipos)";
  if(solo) finSolo(); else finGrupo();
  mostrarTarjeta();
  pedirCafecito();
  show("s-results");
}
function finGrupo(){
  document.getElementById("share-hint").textContent = "Manda una imagen con el marcador al grupo";
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
  const clave = String(opts.maxSongs);
  const previo = record[clave] || 0;
  nuevoRecord = soloResultados.length > 0 && soloPuntos > previo;
  if(nuevoRecord){
    record[clave] = soloPuntos;
    try{ save(LS_RECORD, record); }catch(_){}
    track("record_nuevo", { puntos: soloPuntos, anterior: previo, canciones_por_partida: opts.maxSongs });
  }
  const mejor = Math.max(previo, soloPuntos);
  const cuantas = opts.maxSongs ? " con " + opts.maxSongs + " canciones" : "";
  document.getElementById("share-hint").textContent = nuevoRecord
    ? "🏅 ¡Nuevo récord" + cuantas + "! Mandá la imagen y desafiá a alguien"
    : "Tu récord" + cuantas + ": " + mejor + " puntos · mandá la imagen y desafiá a alguien";
  // Respaldo en texto por si no se puede dibujar la imagen
  const posibles = soloResultados.length * PUNTOS_SOLO[0];
  document.getElementById("winner").innerHTML = `
    <div style="font-size:22px;font-weight:900">🎧 Hiciste <b style="color:var(--lime)">${soloPuntos} punto${soloPuntos!==1?'s':''}</b></div>
    <div class="pill" style="margin-top:8px">de ${posibles} posibles${nuevoRecord ? " · 🏅 ¡nuevo récord!" : ""}</div>`;
  document.getElementById("final-board").innerHTML =
    `<div class="tira-fin">${soloResultados.map(r=> soloTramo(r).emoji).join("")}</div>`;
}

// El pedido de Cafecito sale al terminar cualquier partida con canciones (el
// cartel fijo al pie casi nadie lo tocaba). Se pide con lo que ya jugaron, que
// es lo que lo vuelve concreto.
const PARTIDAS_PARA_PEDIR = 1;
function pedirCafecito(){
  const mostrar = jugado.partidas >= PARTIDAS_PARA_PEDIR;
  document.getElementById("cafecito-final").hidden = !mostrar;
  if(!mostrar) return;
  const p = jugado.partidas, c = jugado.canciones;
  // jugado suma las partidas de los dos modos; el texto le habla a quien jugó esta
  const solo = modo==='solo';
  const lleva = p === 1
    ? `Ya ${solo ? "jugaste" : "jugaron"} <b>1 partida</b> con <b>${c} ${c===1 ? "canción" : "canciones"}</b>. `
    : `Ya van <b>${p} partidas</b> y <b>${c} canciones</b>${solo ? "" : " cantadas"}. `;
  document.getElementById("cafecito-txt").innerHTML = lleva +
    `El juego es gratis y sin anuncios: si ${solo ? "te divirtió" : "les sacó unas risas"}, un cafecito paga las canciones nuevas 💛`;
  // Contra los clics en "cafecito" da la conversión del pedido.
  track("cafecito_visto", { partidas: jugado.partidas, canciones: jugado.canciones });
}

// La imagen que se comparte se muestra ya armada en la pantalla final: antes
// había que tocar "Compartir" para verla, y casi nadie compartía. Reemplaza al
// marcador en texto, que dice lo mismo; si el canvas falla, queda el texto.
function dibujarTarjeta(){
  return modo==='solo'
    ? drawSoloCard(soloPuntos, soloResultados.length * PUNTOS_SOLO[0], soloResultados, nuevoRecord)
    : drawCard(teams, lastGameSongs);
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
  track("revancha", { canciones: lastGameSongs, modo });
  teams.forEach(p=>p.score=0);
  resetSolo();
  played=[]; brokenIds=new Set(); songNo=1;
  show("s-game"); newSong();
}

// Volver al menú sin recargar la página: así los equipos (y sus nombres) siguen ahí.
function goHome(){
  try{ mediaStop(); }catch(_){}
  if(yt && yt.stopVideo){ try{ yt.stopVideo(); }catch(_){} }
  teams.forEach(p=>p.score=0);
  resetSolo();
  played=[]; brokenIds=new Set(); songNo=1;
  currentSong=null; phase='ready'; answeringTeam=-1; revealed=false;
  renderTeams(); renderGenres(); updatePoolWarn();
  show("s-setup");
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
      texto = `🎧 Hice ${soloPuntos} punto${soloPuntos!==1?"s":""} adivinando canciones en “En una nota”
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
    const r = await shareCard(dibujarTarjeta(), texto, SHARE_URL);
    track("compartir", { que: "resultado", resultado: r, canciones: lastGameSongs, desde: desde || "boton", modo });
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
   se ofrece el mismo comentario armado como mail.
   ============================================================ */
const MAIL_CONTACTO = "juanpaladea5@gmail.com";

function mailtoComentario(datos){
  const nombre = String(datos.get("nombre") || "").trim();
  const email  = String(datos.get("email")  || "").trim();
  const cuerpo = [
    String(datos.get("mensaje") || "").trim(), "",
    nombre && ("Nombre: " + nombre),
    email  && ("Mail: "   + email),
  ].filter(Boolean).join("\n");
  return "mailto:" + MAIL_CONTACTO
    + "?subject=" + encodeURIComponent("Comentario · En una nota")
    + "&body="    + encodeURIComponent(cuerpo);
}

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
    state.textContent = "No pudimos enviarlo desde acá. Mandámelo por mail a ";
    const a = document.createElement("a");
    a.href = mailtoComentario(datos);
    a.textContent = MAIL_CONTACTO;
    state.appendChild(a);
    state.appendChild(document.createTextNode(" y lo leo igual."));
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
  show, toggleGenre, setModo, addTeam, removeTeam, setTeamName, setLink,
  addCustomSong, removeCustom, onAudioFiles, removeLocal,
  startGame, playSnippet, playContinuous, stopPlayback,
  pickTeam, pickAll, backToDecide, skipSong, revealAnswer,
  scoreTeam, toggleHit, scoreHits, scoreAllHit, scoreNone, finishRound, endGame, rematch, goHome,
  onYouTubeIframeAPIReady, resetHistory, shareGame, shareResult, sendFeedback,
  onGuessInput, onGuessKey, guessSong, noSe,
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
  });
});

function boot(){
  // Si es la primera vez (o se borraron los datos), arranca con dos equipos.
  if(teams.length === 0){ addTeam("Equipo 1"); addTeam("Equipo 2"); }
  else renderTeams();
  setModo(modo);
  wireAudio();
  renderGenres();
  renderLocalList();
  updatePoolWarn();
}
boot();

// Cargar la API de YouTube (dispara window.onYouTubeIframeAPIReady al terminar)
(function loadYouTubeApi(){
  if(window.YT && window.YT.Player){ onYouTubeIframeAPIReady(); return; }
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
})();
