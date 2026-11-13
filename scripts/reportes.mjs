// Lista las canciones que la gente reportó desde la partida ("esta canción
// anda mal"), de la más reportada a la menos, con qué dijeron de cada una.
//
//   npm run reportes            los de los últimos 90 días
//   npm run reportes -- 30      los de los últimos 30
//
// Usa DATABASE_URL del .env, como scripts/db.mjs.
import pg from "pg";
import { GENRES } from "../src/data.js";

if(!process.env.DATABASE_URL){ console.error("Falta DATABASE_URL (copiá .env.example a .env y completalo)."); process.exit(1); }
const dias = Math.max(1, Math.trunc(Number(process.argv[2])) || 90);

const MOTIVOS = {
  otra_cancion: "no es esa canción", version: "otra versión", empieza_mal: "arranca hablada o en silencio",
  no_suena: "no suena o se corta", otro: "otro",
};
const porVideo = new Map();
GENRES.forEach(g=> g.songs.forEach(([t, a, yt])=>{ if(yt && !porVideo.has(yt)) porVideo.set(yt, `[${g.id}] ${t} — ${a}`); }));

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cliente.connect();
try{
  const { rows } = await cliente.query(
    `select video, motivo, count(*)::int as veces, max(creado) as ultimo
     from public.reportes where creado > now() - make_interval(days => $1)
     group by video, motivo order by video`, [dias]);
  if(!rows.length){ console.log(`Sin reportes en los últimos ${dias} días.`); }
  else {
    const videos = new Map();
    rows.forEach(r=>{
      const v = videos.get(r.video) || { total: 0, motivos: [], ultimo: r.ultimo };
      v.total += r.veces;
      v.motivos.push(`${MOTIVOS[r.motivo] || r.motivo} ×${r.veces}`);
      if(r.ultimo > v.ultimo) v.ultimo = r.ultimo;
      videos.set(r.video, v);
    });
    console.log(`Reportes de los últimos ${dias} días (${videos.size} canciones):\n`);
    [...videos.entries()].sort((a, b)=> b[1].total - a[1].total).forEach(([video, v])=>{
      console.log(`  ${String(v.total).padStart(3)}  ${porVideo.get(video) || "(ya no está en data.js)"}`);
      console.log(`       https://youtu.be/${video} · ${v.motivos.join(", ")} · último: ${v.ultimo.toISOString().slice(0, 10)}`);
    });
  }
}finally{
  await cliente.end();
}
