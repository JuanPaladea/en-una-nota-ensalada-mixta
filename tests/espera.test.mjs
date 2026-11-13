import test from "node:test";
import assert from "node:assert/strict";
import { vigia, DEMORA_MS, FALLA_MS } from "../src/espera.js";

// Un vigía con los relojes de mentira y la lista de lo que avisó
function armar(t){
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const avisos = [];
  const v = vigia({ alDemorar: ()=> avisos.push("demora"), alFallar: ()=> avisos.push("falla") });
  return { v, avisos, pasar: (ms)=> t.mock.timers.tick(ms) };
}

test("si el audio llega enseguida, no avisa nada", (t)=>{
  const { v, avisos, pasar } = armar(t);
  v.esperar();
  pasar(400);
  assert.equal(v.sono(), 400);
  pasar(FALLA_MS * 2);
  assert.deepEqual(avisos, []);
});

test("si tarda, avisa que está cargando; si no llega, que falló", (t)=>{
  const { v, avisos, pasar } = armar(t);
  v.esperar();
  pasar(DEMORA_MS - 1);
  assert.deepEqual(avisos, []);
  pasar(1);
  assert.deepEqual(avisos, ["demora"]);
  pasar(FALLA_MS - DEMORA_MS);
  assert.deepEqual(avisos, ["demora", "falla"]);
  pasar(FALLA_MS * 3);
  assert.deepEqual(avisos, ["demora", "falla"], "cada aviso sale una sola vez");
});

test("si suena después de la demora, ya no avisa que falló", (t)=>{
  const { v, avisos, pasar } = armar(t);
  v.esperar();
  pasar(DEMORA_MS + 1000);
  assert.equal(v.sono(), DEMORA_MS + 1000);
  pasar(FALLA_MS);
  assert.deepEqual(avisos, ["demora"]);
});

test("parar corta la espera: se cortó la canción o cambió", (t)=>{
  const { v, avisos, pasar } = armar(t);
  v.esperar();
  pasar(1000);
  v.parar();
  pasar(FALLA_MS * 2);
  assert.deepEqual(avisos, []);
  assert.equal(v.sono(), null, "sin nadie esperando, sonar no mide nada");
});

test("volver a esperar empieza la cuenta de nuevo", (t)=>{
  const { v, avisos, pasar } = armar(t);
  v.esperar();
  pasar(DEMORA_MS - 100);
  v.esperar();                 // probar de nuevo
  pasar(DEMORA_MS - 100);
  assert.deepEqual(avisos, []);
  pasar(100);
  assert.deepEqual(avisos, ["demora"]);
});
