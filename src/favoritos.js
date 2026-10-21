// Géneros favoritos: salen de lo que cada uno juega, no se eligen.
//
// Se cuentan las canciones que sonaron de cada género. Sin cuenta, las de este
// navegador en los dos modos (main.js las va sumando); con cuenta, las de sus
// partidas de Un jugador, que guardan qué videos sonaron (cuenta.js).
import { GENRES } from "./data.js";
import { esc } from "./utils.js";

const MINIMO = 5;      // con menos canciones todavía no hay favoritos que valgan
const MOSTRAR = 3;

// "Rock Nacional 🇦🇷" → "Rock Nacional": en una línea corta los emojis sobran
export function nombreGenero(id){
  if(id==="local") return "Mis canciones";
  const g = GENRES.find(x=> x.id===id);
  return g ? g.name.replace(/[^\p{L}\p{N})]+$/u, "") : id;
}

// De qué género es cada video. Si uno está en dos playlists, cuenta para la primera.
let generoDeVideo = null;
export function contarVideos(videos){
  if(!generoDeVideo){
    generoDeVideo = new Map();
    GENRES.forEach(g=> g.songs.forEach(([, , yt])=>{ if(yt && !generoDeVideo.has(yt)) generoDeVideo.set(yt, g.id); }));
  }
  const conteo = {};
  videos.forEach(v=>{
    const gid = generoDeVideo.get(v);
    if(gid) conteo[gid] = (conteo[gid] || 0) + 1;
  });
  return conteo;
}

// conteo: { idGénero: canciones } · de: "tus partidas de Un jugador", etc.
export function favoritosHtml(conteo, de){
  const validos = new Set(GENRES.map(g=> g.id));
  const filas = Object.entries(conteo || {}).filter(([id, n])=> validos.has(id) && n > 0)
    .sort((a, b)=> b[1] - a[1]);
  const total = filas.reduce((s, [, n])=> s + n, 0);
  const lbl = `<div class="lbl">Tus géneros favoritos</div>`;
  if(total < MINIMO){
    return lbl + `<p class="hint fav-hint">Jugá unas partidas y acá van a aparecer los géneros que más te gustan.</p>`;
  }
  return lbl + `<div class="favs">${filas.slice(0, MOSTRAR).map(([id, n])=>{
      const g = GENRES.find(x=> x.id===id);
      const pct = Math.round(n * 100 / total);
      return `<div class="fav-row">
        <span class="em" aria-hidden="true">${g.em}</span>
        <span class="gn">${esc(nombreGenero(id))}</span><b>${pct}%</b>
        <span class="fav-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
      </div>`;
    }).join("")}</div>
    <p class="hint fav-hint">De las ${total} canciones que sonaron en ${de}.</p>`;
}
