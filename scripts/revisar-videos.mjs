// Revisa qué videos de src/data.js ya no se pueden reproducir: borrados,
// privados o con la inserción desactivada. No usa clave ni la base: le pregunta
// a YouTube por cada video (oEmbed) y lista los que fallan.
//
//   npm run revisar             todas las playlists
//   npm run revisar -- rock     solo una (el id de la playlist)
//
// No detecta los bloqueos por país (un video puede andar acá y no en Chile):
// para eso están los reportes (`npm run reportes`) y el evento error_youtube.
import { GENRES } from "../src/data.js";

const solo = process.argv[2];
const canciones = [];
GENRES.filter(g=> !solo || g.id === solo).forEach(g=>
  g.songs.forEach(([t, a, yt])=>{ if(yt) canciones.push({ t, a, yt, playlist: g.id }); }));
if(!canciones.length){ console.error(`No hay canciones${solo ? ` en la playlist "${solo}"` : ""}.`); process.exit(1); }

const MOTIVOS = { 401: "no se puede insertar", 403: "privado o bloqueado", 404: "no existe" };
async function revisar(c){
  const url = "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + c.yt);
  for(let intento = 0; intento < 3; intento++){
    try{
      const r = await fetch(url);
      if(r.ok) return null;
      if(r.status === 429 || r.status >= 500){ await new Promise(ok=> setTimeout(ok, 1500 * (intento + 1))); continue; }
      return MOTIVOS[r.status] || "HTTP " + r.status;
    }catch(_){ await new Promise(ok=> setTimeout(ok, 1000)); }
  }
  return "sin respuesta (probar de nuevo)";
}

// De a 6 a la vez: rápido sin que YouTube lo tome por un abuso
const rotos = [];
let hechos = 0;
const cola = canciones.slice();
await Promise.all(Array.from({ length: 6 }, async ()=>{
  while(cola.length){
    const c = cola.shift();
    const motivo = await revisar(c);
    if(motivo) rotos.push({ ...c, motivo });
    if(++hechos % 100 === 0) console.error(`${hechos} de ${canciones.length}…`);
  }
}));

if(!rotos.length){ console.log(`Los ${canciones.length} videos andan.`); process.exit(0); }
console.log(`${rotos.length} de ${canciones.length} videos con problemas:\n`);
rotos.sort((a, b)=> a.playlist.localeCompare(b.playlist) || a.t.localeCompare(b.t))
  .forEach(c=> console.log(`  [${c.playlist}] ${c.t} — ${c.a}  (${c.yt}): ${c.motivo}`));
console.log("\nReemplazá el id en src/data.js y después corré `npm run catalogo` y `npm run catalogo:subir`.");
process.exitCode = 1;
