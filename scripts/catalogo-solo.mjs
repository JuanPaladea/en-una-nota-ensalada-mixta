// Arma supabase/catalogo_solo.sql: las canciones de src/data.js como las
// compara la base para el ranking (video de YouTube + título pasado por norm()).
// Después de tocar data.js, correr `npm run catalogo` y ejecutar ese archivo en
// el SQL Editor de Supabase. Si no, las partidas con canciones nuevas se descartan.
import { writeFileSync } from "node:fs";
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
writeFileSync(new URL("../supabase/catalogo_solo.sql", import.meta.url), sql);
console.log(`supabase/catalogo_solo.sql: ${filas.size} canciones`);
