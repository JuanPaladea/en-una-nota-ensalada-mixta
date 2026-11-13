// Que las playlists estén sanas: son más de mil filas cargadas a mano.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GENRES } from "../src/data.js";
import { RELLENO } from "../src/relleno.js";
import { norm } from "../src/utils.js";

const todas = [];
GENRES.forEach(g=> g.songs.forEach(([t, a, yt])=> todas.push({ g:g.id, t, a, yt })));

test("cada género tiene id, nombre, emoji y canciones", ()=>{
  const ids = GENRES.map(g=> g.id);
  assert.equal(new Set(ids).size, ids.length, "hay ids de género repetidos");
  GENRES.forEach(g=>{
    assert.match(g.id, /^[a-z0-9]+$/, g.id);
    assert.ok(g.name && g.em && g.songs.length > 0, g.id);
  });
});

test("cada canción tiene título, artista y un id de YouTube bien formado", ()=>{
  todas.forEach(s=>{
    assert.ok(typeof s.t === "string" && s.t.trim(), `${s.g}: canción sin título`);
    assert.ok(typeof s.a === "string" && s.a.trim(), `${s.g}: ${s.t} sin artista`);
    assert.match(String(s.yt), /^[A-Za-z0-9_-]{11}$/, `${s.g}: ${s.t}`);
  });
});

test("el título se puede escribir: no queda vacío al normalizarlo", ()=>{
  todas.forEach(s=> assert.ok(norm(s.t).length >= 2, `${s.g}: “${s.t}” no se puede buscar`));
});

test("ningún video está dos veces (el ranking descarta la partida si se repite)", ()=>{
  const vistos = new Map();
  todas.forEach(s=>{
    assert.ok(!vistos.has(s.yt), `${s.yt}: “${s.t}” (${s.g}) y “${vistos.get(s.yt)}”`);
    vistos.set(s.yt, `${s.t} (${s.g})`);
  });
});

test("dentro de un género no se repite un título (es la clave del historial)", ()=>{
  GENRES.forEach(g=>{
    const titulos = g.songs.map(([t])=> t);
    assert.equal(new Set(titulos).size, titulos.length, g.id);
  });
});

test("db/catalogo_solo.sql está al día con data.js", ()=>{
  const sql = readFileSync(new URL("../db/catalogo_solo.sql", import.meta.url), "utf8");
  // una fila por video y playlist: video, título, artista y género
  const enSql = new Set([...sql.matchAll(/\('([A-Za-z0-9_-]{11})', '([^']*)', '([^']*)', '([^']*)'\)/g)].map(m=> m.slice(1).join("|")));
  const enData = new Set(todas.map(s=> [s.yt, norm(s.t), norm(s.a), s.g].join("|")));
  assert.ok(enSql.size > 0, "no se pudo leer ninguna fila del .sql");
  assert.deepEqual([...enData].filter(x=> !enSql.has(x)), [], "faltan en el .sql: correr npm run catalogo");
  assert.deepEqual([...enSql].filter(x=> !enData.has(x)), [], "sobran en el .sql: correr npm run catalogo");
});

test("el relleno tiene título y artista", ()=>{
  RELLENO.forEach(([t, a])=> assert.ok(norm(t) && typeof a === "string", String(t)));
});
