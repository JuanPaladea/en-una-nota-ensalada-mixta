// Arma db/catalogo_solo.sql: las canciones de src/data.js como las
// compara la base para el ranking (video de YouTube + título pasado por norm()).
// Después de tocar data.js, correr `npm run catalogo` y subirlo con
// `npm run catalogo:subir`. Si no, las partidas con canciones nuevas se descartan.
//
// Con --verificar no escribe nada: comprueba que el archivo esté al día y, si
// no, termina con error. Lo corre `npm run build` (prebuild), así un deploy con
// canciones nuevas y el catálogo viejo no sale.
import { readFileSync, writeFileSync } from "node:fs";
import { GENRES } from "../src/data.js";
import { norm } from "../src/utils.js";

const filas = new Set();
GENRES.forEach(g=> g.songs.forEach(([t, , yt])=>{ if(yt) filas.add(`('${yt}', '${norm(t)}')`); }));

const sql = `-- Generado por scripts/catalogo-solo.mjs: no editar a mano.
begin;
delete from public.catalogo_solo;
insert into public.catalogo_solo (video, titulo) values
${[...filas].join(",\n")};
commit;
`;
const archivo = new URL("../db/catalogo_solo.sql", import.meta.url);

if(process.argv.includes("--verificar")){
  let actual = "";
  try{ actual = readFileSync(archivo, "utf8").replace(/\r\n/g, "\n"); }catch(_){}
  if(actual !== sql){
    console.error("db/catalogo_solo.sql no coincide con src/data.js.\n"
      + "Corré `npm run catalogo` y después `npm run catalogo:subir` (si no, el ranking descarta las canciones nuevas).");
    process.exit(1);
  }
  console.log(`db/catalogo_solo.sql: al día (${filas.size} canciones)`);
}else{
  writeFileSync(archivo, sql);
  console.log(`db/catalogo_solo.sql: ${filas.size} canciones`);
}
