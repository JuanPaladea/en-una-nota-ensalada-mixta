import test from "node:test";
import assert from "node:assert/strict";
import { norm, esc, extractVideoId, songKey } from "../src/utils.js";

test("norm: sin mayúsculas, acentos ni signos", ()=>{
  assert.equal(norm("¿Qué ves?"), "que ves");
  assert.equal(norm("  Ji Ji Ji  "), "ji ji ji");
  assert.equal(norm("Muchacha (ojos de papel)"), "muchacha ojos de papel");
  assert.equal(norm("Corazón Ñandú"), "corazon nandu");
  assert.equal(norm("¡¿?!"), "");
});

test("esc: escapa lo que rompe HTML y atributos, comillas simples incluidas", ()=>{
  assert.equal(esc(`<b a="1">Don't & co</b>`), "&lt;b a=&quot;1&quot;&gt;Don&#39;t &amp; co&lt;/b&gt;");
  assert.equal(esc(7), "7");
});

test("extractVideoId: links y ids de YouTube", ()=>{
  const id = "T_FkEw27XJ0";
  assert.equal(extractVideoId(id), id);
  assert.equal(extractVideoId("https://youtu.be/" + id), id);
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=" + id + "&t=10s"), id);
  assert.equal(extractVideoId("https://www.youtube.com/embed/" + id), id);
  assert.equal(extractVideoId("https://www.youtube.com/shorts/" + id), id);
  assert.equal(extractVideoId("  " + id + "  "), id);
  assert.equal(extractVideoId("https://example.com/"), null);
  assert.equal(extractVideoId(""), null);
  assert.equal(extractVideoId(null), null);
});

test("songKey: género::título", ()=>{
  assert.equal(songKey("rock", "Flaca"), "rock::Flaca");
});
