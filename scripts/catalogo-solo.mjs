// Arma db/catalogo_solo.sql: las canciones de src/data.js como las compara la
// base (video de YouTube, título y artista pasados por norm(), y la playlist).
// Un video que está en dos playlists sale dos veces, una por playlist: así la
// base sabe de qué género es cada partida y puede sortear el desafío del día.
// Después de tocar data.js, correr `npm run catalogo` y subirlo con
// `npm run catalogo:subir`. Si no, las partidas con canciones nuevas se descartan.
import { writeFileSync } from "node:fs";
import { GENRES } from "../src/data.js";
import { norm } from "../src/utils.js";

const filas = new Map();   // "video|playlist" → fila
const videos = new Set();
GENRES.forEach(g=> g.songs.forEach(([t, a, yt])=>{
  if(!yt) return;
  videos.add(yt);
  const clave = yt + "|" + g.id;
  if(!filas.has(clave)) filas.set(clave, `('${yt}', '${norm(t)}', '${norm(a)}', '${g.id}')`);
}));

const sql = `-- Generado por scripts/catalogo-solo.mjs: no editar a mano.
begin;
delete from public.catalogo_solo;
insert into public.catalogo_solo (video, titulo, artista, genero) values
${[...filas.values()].join(",\n")};
commit;
`;
writeFileSync(new URL("../db/catalogo_solo.sql", import.meta.url), sql);
console.log(`db/catalogo_solo.sql: ${videos.size} canciones en ${filas.size} filas`);
