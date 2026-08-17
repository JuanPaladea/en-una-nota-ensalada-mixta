import "./styles.css";
import { GENRES } from "./data.js";
import { load, save, songKey, esc, extractVideoId } from "./utils.js";
import { idbPut, idbGet, idbDel } from "./idb.js";
import { shareCard } from "./sharecard.js";

/* ============================================================
   ESTADO
   ============================================================ */
const LS_LINKS = "eun_links_v1";
const LS_CUSTOM = "eun_custom_v1";
const LS_LOCAL = "eun_local_v1";
const LS_HISTORY = "eun_played_hist_v1";
const LS_TEAMS = "eun_teams_v1";
let links = load(LS_LINKS, {});          // { songKey: videoId }
let customSongs = load(LS_CUSTOM, []);    // [{t,a,gid}]
let localTracks = load(LS_LOCAL, []);     // [{id,t,a}] audio guardado en IndexedDB
let playedHistory = load(LS_HISTORY, []); // keys ya sonadas en partidas anteriores (persiste entre partidas)
const localUrls = {};                     // id -> objectURL (cache de sesión)
const memBlobs = {};                      // id -> File (respaldo en memoria si IndexedDB no está disponible)
let selectedGenres = new Set();
// Equipos: los nombres se guardan en localStorage y sobreviven a la revancha,
// al volver al menú principal y a recargar la página (los puntos no).
let teams = loadTeams();                  // [{name, score}]
let opts = { randomStart:true, noRepeat:true, maxSongs:10 };

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
  // el bloque de Cafecito y el pie. El logo se queda.
  document.body.classList.toggle("playing", id==="s-game");
  scrollTop();
  if(id==="s-armar") renderSongList();
}
// El menú es largo y abajo de todo está la sección de Cafecito: si no volvemos
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
let mediaKind=null;   // 'yt' | 'local' — qué medio usa la canción actual
const localAudioEl = () => document.getElementById("localaudio");

// Precarga: la canción se deja cargada y buscada apenas se sortea, mientras el
// grupo todavía está leyendo la pantalla. Sin esto, "Reproducir 1 segundo"
// arrancaba recién después de bufferear (en datos móviles, varios segundos de
// silencio incómodo antes de un fragmento que dura uno).
let preparedFor=null;   // key de la canción que ya está lista en el reproductor
let startAt=0;          // segundo desde el que arranca la canción actual
let prebuffering=false; // true mientras bufferea en silencio (muteado y tapado)

// Reproducción por segundos
const SNIPPET_MS = 1000;      // cuánto suena cada "1 segundo"
let snippetTimer=null;        // timeout que corta el fragmento
let pauseAfterSnippet=false;  // true = frenar automáticamente al cumplir SNIPPET_MS
let mediaStarted=false;       // la canción actual ya arrancó (para reanudar vs cargar)
let continuousMode=false;     // true = suena sin cortar hasta apretar detener
function clearSnippetTimer(){ if(snippetTimer){ clearTimeout(snippetTimer); snippetTimer=null; } }
// Al empezar a sonar (evento del medio), si estamos en modo fragmento, programa el corte.
function armSnippet(){
  if(!pauseAfterSnippet) return;
  clearSnippetTimer();
  snippetTimer = setTimeout(snippetPause, SNIPPET_MS);
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
        if(prebuffering) yt.seekTo(startAt, true);
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
  currentSong = alt; seekedThisRound=false; mediaStarted=false;
  if(continuousMode) playContinuous(); else playSnippet();
}

/* ---- Capa de medios: unifica audio local (<audio>) y YouTube ---- */
function eqPlaying(){ const eq=document.getElementById("eq"); if(eq) eq.classList.remove("paused"); }
function eqPaused(){ const eq=document.getElementById("eq"); if(eq) eq.classList.add("paused"); }
function wireAudio(){
  const a=localAudioEl(); if(!a) return;
  a.addEventListener("loadedmetadata", ()=>{
    seekedThisRound=true;
    if(opts.randomStart){
      const d=a.duration||0;
      const st=(d && d>40) ? (d*0.12 + Math.random()*d*0.5) : Math.min(15,(d||0)*0.25);
      try{ a.currentTime=st; }catch(_){}
    }
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
  currentSong = alt; seekedThisRound=false; mediaStarted=false;
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
  startAt = opts.randomStart ? Math.floor(15 + Math.random()*45) : 0;
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
  const start = opts.randomStart ? Math.floor(15 + Math.random()*45) : 0;
  try{ yt.unMute(); yt.setVolume(100); yt.loadVideoById({videoId:s.id, startSeconds:start}); }
  catch(e){ onPlayerError({data:5}); }
  return true;
}
function mediaPause(){
  clearSnippetTimer();
  if(mediaKind==='local'){ try{ localAudioEl().pause(); }catch(_){} }
  else if(yt && yt.pauseVideo){ yt.pauseVideo(); }
  eqPaused();
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
let revealed=false;
let skipping=false;     // true cuando se saltea la canción sin puntos
let songNo=1;
let lastGameSongs=0;    // canciones de la última partida (para la tarjeta que se comparte)

function startGame(){
  if(selectedGenres.size===0){ alert("Elegí al menos un género."); return; }
  buildPool();
  if(pool.length===0){ alert("No hay canciones para jugar. Entrá a 🔗 Armar canciones y agregá algunos links."); return; }
  teams.forEach((p,i)=>{ if(!p.name.trim()) p.name="Equipo "+(i+1); p.score=0; });
  if(teams.length===0){ teams=[{name:"Equipo 1",score:0}]; }
  saveTeams();   // los nombres quedan guardados para la próxima partida
  opts.randomStart = document.getElementById("opt-randomstart").checked;
  opts.noRepeat = true;   // siempre: no se repiten canciones en una partida
  const ms = document.getElementById("opt-maxsongs");
  opts.maxSongs = ms ? parseInt(ms.value,10) : 0;
  played=[]; brokenIds=new Set(); songNo=1;
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
  mediaStarted=false; continuousMode=false; pauseAfterSnippet=false; clearSnippetTimer();
  phase='ready';
  prepareMedia(s);   // se carga mientras leen la pantalla, no cuando aprietan play
  const tot = totalSongs();
  document.getElementById("round-pill").textContent = tot ? ("Canción "+songNo+" / "+tot) : ("Canción "+songNo);
  setCover("Listo para sonar 🎧", true);
  renderPhase(); renderBoard();
}

// Reproduce un fragmento de 1 segundo y frena (el corazón del juego).
function playSnippet(){
  clearSnippetTimer();
  continuousMode=false;
  pauseAfterSnippet=true;
  phase='listening';
  setCover("🎵 Sonando…");
  renderPhase();
  if(!mediaStarted){
    if(mediaStart()) mediaStarted=true;
    else { pauseAfterSnippet=false; phase='ready'; renderPhase(); }
  } else mediaResume();
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
    if(mediaStart()) mediaStarted=true;
    else { continuousMode=false; phase='decide'; renderPhase(); }
  } else mediaResume();
}
// Corta: fin automático del fragmento, o botón "detener".
function snippetPause(){
  clearSnippetTimer();
  pauseAfterSnippet=false;
  mediaPause();
  phase='decide';
  setCover("✋ ¿Quién arriesga?", true);
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
// Suma el punto al equipo indicado; sin índice, al que arriesgó.
function scoreTeam(i){
  const idx = (typeof i==='number') ? i : answeringTeam;
  if(typeof idx==='number' && idx>=0 && teams[idx]) teams[idx].score++;
  flash("var(--ok)"); finishRound();
}
function scoreAll(){ teams.forEach(p=>p.score++); flash("var(--ok)"); finishRound(); }
function scoreNone(){ flash("var(--no)"); finishRound(); }

function renderPhase(){
  const c=document.getElementById("controls");
  const t=document.getElementById("phase-title");
  const sub=document.getElementById("phase-sub");
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
        sub.textContent="¿La pegaron?";
        c.innerHTML=`<div class="score-mark on">
          <button class="btn" style="background:var(--ok);color:#fff" onclick="scoreAll()">✅ +1 a todos</button>
          <button class="btn" style="background:var(--no);color:#fff" onclick="scoreNone()">❌ Nadie</button>
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
        sub.textContent="¿Quién se lleva el punto?";
        c.innerHTML=`<div class="teamgrid">`+
          teams.map((p,i)=>`<button class="btn lime" onclick="scoreTeam(${i})">${i===answeringTeam?'🎤 ':''}${esc(p.name)} +1</button>`).join("")+
          `</div>
          <button class="btn" style="background:var(--no);color:#fff" onclick="scoreNone()">❌ Nadie la pegó</button>`;
      } else {
        sub.textContent="¿La pegó?";
        c.innerHTML=`<div class="score-mark on">
          <button class="btn" style="background:var(--ok);color:#fff" onclick="scoreTeam()">✅ La pegó (+1)</button>
          <button class="btn" style="background:var(--no);color:#fff" onclick="scoreNone()">❌ Erró</button>
        </div>`;
      }
    }
  }
}

function renderBoard(){
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
  lastGameSongs = Math.max(0, songNo - 1);   // canciones que llegaron a terminarse
  const head = document.querySelector("#s-results h2");
  if(head) head.textContent = reason==='agotada' ? "¡Se acabaron las canciones!" : "¡Terminó la partida!";
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
  show("s-results");
}

function rematch(){
  teams.forEach(p=>p.score=0);
  played=[]; brokenIds=new Set(); songNo=1;
  show("s-game"); newSong();
}

// Volver al menú sin recargar la página: así los equipos (y sus nombres) siguen ahí.
function goHome(){
  try{ mediaStop(); }catch(_){}
  if(yt && yt.stopVideo){ try{ yt.stopVideo(); }catch(_){} }
  teams.forEach(p=>p.score=0);
  played=[]; brokenIds=new Set(); songNo=1;
  currentSong=null; phase='ready'; answeringTeam=-1; revealed=false;
  renderTeams(); renderGenres(); updatePoolWarn();
  show("s-setup");
}

/* ============================================================
   COMPARTIR
   ============================================================ */
const SHARE_URL = "https://enunanota.com.ar/";
const SHARE_TEXT = "🎤 En una nota · Ensalada mixta: suena 1 segundo de una canción y tenés que seguir cantando la que sigue. Gratis, sin instalar nada:";
async function shareGame(){
  if(navigator.share){
    try{ await navigator.share({ title:"En una nota · Ensalada mixta", text:SHARE_TEXT, url:SHARE_URL }); return; }
    catch(e){ if(e && e.name === "AbortError") return; }
  }
  try{
    await navigator.clipboard.writeText(SHARE_TEXT + " " + SHARE_URL);
    alert("¡Link copiado! Pegalo en el grupo y jueguen todos 🎶");
  }catch(e){
    prompt("Copiá el link y compartilo:", SHARE_URL);
  }
}

// Comparte una imagen con el resultado de la partida que acaban de jugar.
// Es distinto de shareGame(): eso manda un aviso del juego, esto manda lo que
// les pasó a ellos — que es lo que la gente realmente reenvía al grupo.
let sharingResult = false;
async function shareResult(btn){
  if(sharingResult) return;              // doble toque mientras genera la imagen
  sharingResult = true;
  const previo = btn ? btn.textContent : null;
  if(btn){ btn.textContent = "🖼️ Armando la imagen…"; btn.disabled = true; }
  try{
    const orden = [...teams].sort((a,b)=> b.score - a.score);
    const campeon = orden[0];
    const empate = campeon && orden.filter(t=>t.score===campeon.score).length > 1;
    const texto = campeon && !empate
      ? `🏆 Ganó ${campeon.name} con ${campeon.score} punto${campeon.score!==1?"s":""} en “En una nota”. ¿Se animan?`
      : "🎤 Así quedó nuestra partida de “En una nota”. ¿Se animan?";
    const r = await shareCard(teams, lastGameSongs, texto, SHARE_URL);
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
   INIT + wiring
   Los onclick/oninput del HTML llaman funciones globales,
   así que exponemos los handlers en window.
   ============================================================ */
Object.assign(window, {
  show, toggleGenre, addTeam, removeTeam, setTeamName, setLink,
  addCustomSong, removeCustom, onAudioFiles, removeLocal,
  startGame, playSnippet, playContinuous, stopPlayback,
  pickTeam, pickAll, backToDecide, skipSong, revealAnswer,
  scoreTeam, scoreAll, scoreNone, finishRound, endGame, rematch, goHome,
  onYouTubeIframeAPIReady, resetHistory, shareGame, shareResult,
});

function boot(){
  // Si es la primera vez (o se borraron los datos), arranca con dos equipos.
  if(teams.length === 0){ addTeam("Equipo 1"); addTeam("Equipo 2"); }
  else renderTeams();
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
