// Estadísticas y logros de Un jugador.
//
// Todo sale de las partidas, que guardan qué video sonó y con cuántos segundos
// salió cada uno (0 = no salió): con cuenta, las de la base (cuenta.js); sin
// cuenta, las que quedaron en este navegador (main.js). No se guarda nada más:
// los logros se calculan cada vez.
//
// partidas: [{ canciones, segundos:[…], puntos, jugada, videos:[…]|null, genero, modo, dia }]
import { GENRES } from "./data.js";
import { esc, load, save } from "./utils.js";
import { nombreGenero } from "./favoritos.js";

const LS_VISTOS = "eun_logros_v1";   // ids de los logros que ya se festejaron en este navegador

// De qué canción y de qué playlist es cada video (el primero, si está en dos)
let porVideo = null;
export function cancionDeVideo(video){
  if(!porVideo){
    porVideo = new Map();
    GENRES.forEach(g=> g.songs.forEach(([t, a, yt])=>{ if(yt && !porVideo.has(yt)) porVideo.set(yt, { t, a, gid: g.id, yt }); }));
  }
  return porVideo.get(video) || null;
}

// "2026-11-13" en la hora de este dispositivo
const diaLocal = (d)=>{
  const f = new Date(d);
  return f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0") + "-" + String(f.getDate()).padStart(2, "0");
};
const diaAntes = (dia)=>{
  const [a, m, d] = dia.split("-").map(Number);
  return diaLocal(new Date(a, m - 1, d - 1));
};

// Días seguidos jugando. actual: la racha que sigue viva (jugó hoy o ayer) ·
// mejor: la más larga que tuvo.
export function rachas(dias, hoy = diaLocal(Date.now())){
  const set = new Set(dias);
  let actual = 0;
  let d = set.has(hoy) ? hoy : diaAntes(hoy);
  while(set.has(d)){ actual++; d = diaAntes(d); }
  let mejor = 0;
  set.forEach(dia=>{
    if(set.has(diaAntes(dia))) return;        // no es el primer día de una racha
    let n = 0, x = dia;
    // se avanza de a un día hasta que se corta
    while(set.has(x)){ n++; const [a, m, dd] = x.split("-").map(Number); x = diaLocal(new Date(a, m - 1, dd + 1)); }
    mejor = Math.max(mejor, n);
  });
  return { actual, mejor };
}

/* ============================================================
   RESUMEN
   ============================================================ */
// Todo lo que se muestra, calculado de una vez.
export function resumen(partidas){
  const generos = {};      // gid → { sonaron, salieron, seg }
  const canciones = {};    // video → { veces, salio }
  let salieron = 0, seguidasMax = 0, perfectas = 0, mejor10 = 0, desafios = 0;
  partidas.forEach(p=>{
    const seg = p.segundos || [];
    if(p.dia) desafios++;
    if(p.canciones === 10 && seg.length === 10){
      if(seg.every(s=> s > 0)) perfectas++;
      if((p.modo || "titulo") === "titulo") mejor10 = Math.max(mejor10, p.puntos || 0);
    }
    let seguidas = 0;
    seg.forEach((s, i)=>{
      if(s > 0) salieron++;
      seguidas = s === 1 ? seguidas + 1 : 0;
      seguidasMax = Math.max(seguidasMax, seguidas);
      const c = p.videos && cancionDeVideo(p.videos[i]);
      if(!c) return;
      const g = generos[c.gid] || (generos[c.gid] = { sonaron: 0, salieron: 0, seg: 0 });
      g.sonaron++;
      if(s > 0){ g.salieron++; g.seg += s; }
      const k = canciones[c.yt] || (canciones[c.yt] = { c, veces: 0, salio: false });
      k.veces++;
      if(s > 0) k.salio = true;
    });
  });
  const dias = partidas.map(p=> diaLocal(p.jugada));
  return {
    partidas: partidas.length, salieron, seguidasMax, perfectas, mejor10, desafios,
    generos, generosAcertados: Object.values(generos).filter(g=> g.salieron > 0).length,
    pendientes: Object.values(canciones).filter(k=> !k.salio).sort((a, b)=> b.veces - a.veces),
    racha: rachas(dias),
  };
}

/* ============================================================
   LOGROS
   cuenta: cuánto lleva · meta: cuánto hace falta
   ============================================================ */
const LOGROS = [
  { id: "primera",     em: "🎵", nombre: "Primera nota",     que: "Terminar una partida",                  meta: 1,   cuenta: r=> r.partidas },
  { id: "oido",        em: "⚡", nombre: "Oído absoluto",    que: "5 seguidas con 1 segundo",             meta: 5,   cuenta: r=> r.seguidasMax },
  { id: "perfecta",    em: "💯", nombre: "Partida perfecta", que: "Sacar las 10 de una partida",          meta: 1,   cuenta: r=> r.perfectas },
  { id: "setenta",     em: "🔥", nombre: "Afinado",          que: "70 puntos con 10 canciones",           meta: 70,  cuenta: r=> r.mejor10 },
  { id: "noventa",     em: "👑", nombre: "Imbatible",        que: "90 puntos con 10 canciones",           meta: 90,  cuenta: r=> r.mejor10 },
  { id: "cien",        em: "🎧", nombre: "Rocola",           que: "Sacar 100 canciones",                  meta: 100, cuenta: r=> r.salieron },
  { id: "quinientas",  em: "📻", nombre: "Radio humana",     que: "Sacar 500 canciones",                  meta: 500, cuenta: r=> r.salieron },
  { id: "todoterreno", em: "🥗", nombre: "Ensalada mixta",   que: "Sacar canciones de 8 géneros",         meta: 8,   cuenta: r=> r.generosAcertados },
  { id: "racha3",      em: "📆", nombre: "Tres al hilo",     que: "Jugar 3 días seguidos",                meta: 3,   cuenta: r=> r.racha.mejor },
  { id: "racha7",      em: "🗓️", nombre: "Semana completa",  que: "Jugar 7 días seguidos",                meta: 7,   cuenta: r=> r.racha.mejor },
  { id: "desafio7",    em: "🏁", nombre: "Habitué",          que: "Jugar 7 desafíos del día",             meta: 7,   cuenta: r=> r.desafios },
];
export function logrosDe(r){
  return LOGROS.map(l=>{
    const lleva = Math.min(l.meta, l.cuenta(r) || 0);
    return { ...l, lleva, hecho: lleva >= l.meta };
  });
}

// Los logros que se consiguieron desde la última vez que se miró en este
// navegador. La primera vez (alguien que ya venía jugando) no festeja nada:
// se anotan todos como vistos.
export function logrosNuevos(partidas){
  const hechos = logrosDe(resumen(partidas)).filter(l=> l.hecho);
  const vistos = load(LS_VISTOS, null);
  try{ save(LS_VISTOS, hechos.map(l=> l.id)); }catch(_){}
  if(!Array.isArray(vistos)) return partidas.length <= 1 ? hechos : [];
  return hechos.filter(l=> !vistos.includes(l.id));
}

/* ============================================================
   HTML (Mi cuenta)
   ============================================================ */
const MIN_POR_GENERO = 3;    // con menos canciones el porcentaje no dice nada
const PENDIENTES = 5;

// Las filas entran escalonadas (extras.css): --i es el orden de cada una.
// Va cada bloque por separado ("" si no hay nada que mostrar): Mi cuenta los
// reparte en zonas, que en la compu son columnas (ver .cz en styles.css).
export function estadisticas(partidas){
  if(!partidas || !partidas.length) return { racha: "", porGenero: "", pendientes: "", logros: "" };
  const r = resumen(partidas);
  const filas = Object.entries(r.generos).filter(([, g])=> g.sonaron >= MIN_POR_GENERO)
    .map(([gid, g])=> ({ gid, pct: Math.round(g.salieron * 100 / g.sonaron), seg: g.salieron ? g.seg / g.salieron : 0, n: g.sonaron }))
    .sort((a, b)=> b.pct - a.pct || a.seg - b.seg);
  const emoji = (gid)=> (GENRES.find(g=> g.id === gid) || {}).em || "🎵";
  const logros = logrosDe(r);
  const hechos = logros.filter(l=> l.hecho).length;

  const racha = `<div class="lbl">Tu racha</div>
    <div class="tiles">
      <div class="tile"><b>${r.racha.actual || "—"}</b><span>${r.racha.actual === 1 ? "día seguido" : "días seguidos"}</span></div>
      <div class="tile"><b>${r.racha.mejor}</b><span>mejor racha</span></div>
      <div class="tile"><b>${r.salieron}</b><span>canciones sacadas</span></div>
    </div>`;

  const porGenero = filas.length ? `<div class="lbl">Cómo te va por género</div>
    <div class="gen-stats">${filas.map((f, i)=> `<div class="gen-row" style="--i:${i}">
        <span class="em" aria-hidden="true">${emoji(f.gid)}</span>
        <span class="gn">${esc(nombreGenero(f.gid))}<small>${f.n} canciones${f.seg ? " · " + f.seg.toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " s en promedio" : ""}</small></span>
        <b>${f.pct}%</b>
        <span class="fav-bar" aria-hidden="true"><span style="width:${f.pct}%"></span></span>
      </div>`).join("")}</div>` : "";

  const pendientes = r.pendientes.length ? `<div class="lbl">Las que todavía no sacaste</div>
    <div class="hist">${r.pendientes.slice(0, PENDIENTES).map(k=> `<div class="hist-row pend">
        <span>${esc(k.c.t)}<small>${esc(k.c.a)}</small></span>
        <small>${k.veces === 1 ? "sonó 1 vez" : "sonó " + k.veces + " veces"}</small></div>`).join("")}</div>` : "";

  const medallas = `<div class="lbl"><span>Logros <span class="lbl-info">${hechos} de ${logros.length}</span></span></div>
    <div class="logros">${logros.map((l, i)=> `<div class="logro ${l.hecho ? "hecho" : ""}" style="--i:${i}">
        <span class="em" aria-hidden="true">${l.em}</span>
        <span class="ln">${l.nombre}<small>${l.que}</small></span>
        ${l.hecho ? `<span class="ok" aria-label="Conseguido">✓</span>` : `<span class="va">${l.lleva}/${l.meta}</span>`}
      </div>`).join("")}</div>`;

  return { racha, porGenero, pendientes, logros: medallas };
}

// El cartel de la pantalla final cuando la partida destrabó algún logro
export function logroNuevoHtml(nuevos){
  if(!nuevos.length) return "";
  return nuevos.slice(0, 3).map(l=> `<div class="logro hecho nuevo">
      <span class="em" aria-hidden="true">${l.em}</span>
      <span class="ln"><small>Logro nuevo</small>${l.nombre}</span>
      <span class="ok" aria-hidden="true">✓</span>
    </div>`).join("");
}
