// Autocompletado de títulos del modo un jugador: armar la lista, buscar en
// ella y decidir si lo elegido es la canción que suena. Sin DOM ni estado,
// así se prueba con `npm test`.
import { norm } from "./utils.js";

export const MAX_SUGERENCIAS = 6;

// Se autocompleta con todo el catálogo, no solo con los géneros elegidos: si
// no, jugando con una playlist chica la lista de opciones ya era media pista.
// Encima se suman canciones que la app no tiene (relleno), para que figurar en
// la lista no delate que puede sonar. Las que repiten un título del catálogo
// se saltean: se acierta por título y no tienen que contar como acierto.
//
// canciones: [{t, a, yt}] (las de allSongs) · relleno: [[título, artista]]
// Devuelve [{t, a, nt, na, amb}]. amb: ese título lo comparten dos canciones
// distintas de las playlists ("Vete" de Ráfaga y de Bad Bunny).
export function armarCatalogo(canciones, relleno){
  const vistos = new Set(), titulos = new Set(), videos = new Map();
  const catalogo = [];
  canciones.forEach(s=>{
    const nt = norm(s.t), na = norm(s.a);
    if(!nt) return;
    if(s.yt){
      if(!videos.has(nt)) videos.set(nt, new Set());
      videos.get(nt).add(s.yt);
    }
    if(vistos.has(nt+"|"+na)) return;
    vistos.add(nt+"|"+na); titulos.add(nt);
    catalogo.push({ t:s.t, a:s.a, nt, na, amb:false });
  });
  relleno.forEach(([t,a])=>{
    const nt = norm(t);
    if(!nt || titulos.has(nt)) return;
    titulos.add(nt);
    catalogo.push({ t, a, nt, na:norm(a), amb:false });
  });
  catalogo.forEach(c=>{ c.amb = (videos.get(c.nt) || { size:0 }).size > 1; });
  return catalogo;
}

// Cuenta el título, no el artista: la misma canción puede estar cargada con el
// artista escrito distinto. Salvo que el título lo compartan dos canciones
// distintas: ahí hay que elegir la del artista que suena.
export function esLaCancion(elegida, cancion){
  if(!elegida || !cancion || elegida.nt !== norm(cancion.t)) return false;
  return !elegida.amb || elegida.na === norm(cancion.a);
}

// Hash chico para mezclar el relleno siempre igual para lo mismo escrito.
function hashStr(s){
  let h = 2166136261;
  for(let i=0; i<s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Primero los títulos que empiezan con lo escrito, después los que lo tienen
// al principio de una palabra, en el medio, y al final los que coinciden
// palabra por palabra contando el artista ("persiana soda").
// Si coinciden pocos, se completa la lista con parecidos (del mismo artista,
// con palabras que empiezan igual): con dos letras no tiene que quedar una
// sola opción a la vista. El relleno sale solo de lo escrito, nunca de la
// canción que suena, así que no da pistas.
export function buscarTitulos(catalogo, q){
  const n = norm(q);
  if(n.length < 2) return [];
  const palabras = n.split(" ");
  const hits = [], resto = [];
  for(const s of catalogo){
    const rank = s.nt.startsWith(n) ? 0
      : (" "+s.nt).includes(" "+n) ? 1
      : s.nt.includes(n) ? 2
      : palabras.every(p=> (s.nt+" "+s.na).includes(p)) ? 3 : -1;
    (rank >= 0 ? hits : resto).push([rank, s]);
  }
  hits.sort((a,b)=> a[0]-b[0] || a[1].t.localeCompare(b[1].t));
  const lista = hits.slice(0, MAX_SUGERENCIAS).map(h=> h[1]);
  if(!lista.length || lista.length >= MAX_SUGERENCIAS) return lista;
  const artistas = new Set(lista.map(s=> s.na));
  const empiezaCon = (s, pre)=> (" "+s.nt).includes(" "+pre);
  const relleno = resto.map(([, s])=>{
    const rank = artistas.has(s.na) ? 0
      : palabras.some(p=> empiezaCon(s, p.slice(0, 2))) ? 1
      : empiezaCon(s, n[0]) ? 2 : 3;
    return [rank, hashStr(n+"|"+s.nt), s];
  });
  relleno.sort((a,b)=> a[0]-b[0] || a[1]-b[1]);
  return lista.concat(relleno.slice(0, MAX_SUGERENCIAS - lista.length).map(r=> r[2]));
}
