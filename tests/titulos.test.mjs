import test from "node:test";
import assert from "node:assert/strict";
import { armarCatalogo, armarArtistas, buscarTitulos, esLaCancion, esElArtista, MAX_SUGERENCIAS } from "../src/titulos.js";
import { GENRES } from "../src/data.js";
import { RELLENO } from "../src/relleno.js";

const canciones = [];
GENRES.forEach(g=> g.songs.forEach(([t, a, yt])=> canciones.push({ t, a, gid:g.id, yt })));
const catalogo = armarCatalogo(canciones, RELLENO);
const de = (titulo, artista)=> canciones.find(s=> s.t === titulo && (!artista || s.a === artista));

test("armarCatalogo: todas las canciones están, sin repetir título y artista", ()=>{
  const claves = catalogo.map(c=> c.nt + "|" + c.na);
  assert.equal(new Set(claves).size, claves.length);
  canciones.forEach(s=> assert.ok(catalogo.some(c=> esLaCancion(c, s)), "falta " + s.t));
});

test("armarCatalogo: el relleno nunca repite un título del catálogo", ()=>{
  const propias = new Set(catalogo.slice(0, canciones.length).map(c=> c.nt));
  const titulos = catalogo.map(c=> c.nt);
  // un título aparece dos veces solo si son dos canciones distintas de las playlists
  titulos.forEach((t, i)=>{ if(titulos.indexOf(t) !== i) assert.ok(propias.has(t) && catalogo[i].amb, t); });
});

test("buscarTitulos: con menos de dos letras no sugiere nada", ()=>{
  assert.deepEqual(buscarTitulos(catalogo, ""), []);
  assert.deepEqual(buscarTitulos(catalogo, "p"), []);
  assert.deepEqual(buscarTitulos(catalogo, " ¿ "), []);
});

test("buscarTitulos: encuentra sin acentos ni signos, y primero lo que empieza igual", ()=>{
  const r = buscarTitulos(catalogo, "que ves");
  assert.equal(r[0].t, "¿Qué ves?");
  assert.ok(buscarTitulos(catalogo, "PERSIANA")[0].nt.startsWith("persiana"));
});

test("buscarTitulos: palabras sueltas contando el artista", ()=>{
  const r = buscarTitulos(catalogo, "persiana soda");
  assert.equal(r[0].t, "Persiana americana");
});

test("buscarTitulos: nunca más de MAX_SUGERENCIAS, y si algo coincide rellena con parecidos", ()=>{
  for(const q of ["la", "de musica", "persiana americana", "zzzz"]){
    assert.ok(buscarTitulos(catalogo, q).length <= MAX_SUGERENCIAS, q);
  }
  // con el título entero no tiene que quedar una sola opción a la vista
  assert.equal(buscarTitulos(catalogo, "persiana americana").length, MAX_SUGERENCIAS);
  assert.deepEqual(buscarTitulos(catalogo, "zzzzqqq"), []);
});

test("buscarTitulos: lo mismo escrito da siempre la misma lista", ()=>{
  assert.deepEqual(buscarTitulos(catalogo, "mariposa"), buscarTitulos(catalogo, "mariposa"));
});

test("esLaCancion: cuenta el título, no el artista", ()=>{
  const flaca = de("Flaca");
  assert.ok(esLaCancion({ nt:"flaca", na:"otro artista", amb:false }, flaca));
  assert.ok(!esLaCancion({ nt:"mil horas", na:"andres calamaro", amb:false }, flaca));
  assert.ok(!esLaCancion(null, flaca));
});

test("esLaCancion: un título que comparten dos canciones pide el artista que suena", ()=>{
  const vetes = catalogo.filter(c=> c.nt === "vete");
  assert.equal(vetes.length, 2);
  assert.ok(vetes.every(c=> c.amb));
  const rafaga = de("Vete", "Ráfaga");
  assert.ok(rafaga, "Vete de Ráfaga ya no está en data.js: actualizar esta prueba");
  const [bien, mal] = vetes[0].na === "rafaga" ? vetes : [vetes[1], vetes[0]];
  assert.ok(esLaCancion(bien, rafaga));
  assert.ok(!esLaCancion(mal, rafaga));
});

test("armarArtistas: cada artista una vez, y se busca igual que un título", ()=>{
  const artistas = armarArtistas(catalogo);
  const nombres = artistas.map(a=> a.nt);
  assert.equal(new Set(nombres).size, nombres.length);
  assert.ok(artistas.length > 0 && artistas.every(a=> a.t && a.nt === a.na));
  assert.ok(buscarTitulos(artistas, "soda")[0].nt.startsWith("soda"));
});

test("esElArtista: vale el nombre entero o cualquiera de los que la cantan", ()=>{
  assert.ok(esElArtista("Soda Stereo", "Soda Stereo"));
  assert.ok(esElArtista("soda stereo", "Soda Stéreo"));
  assert.ok(esElArtista("Maluma", "Shakira ft. Maluma"));
  assert.ok(esElArtista("Shakira", "Carlos Vives, Shakira"));
  assert.ok(esElArtista("Shakira ft. Maluma", "Shakira"));
  assert.ok(!esElArtista("Ricky Martin", "Shakira ft. Maluma"));
  assert.ok(!esElArtista("", "Shakira"));
});
