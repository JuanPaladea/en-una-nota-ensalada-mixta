// Utilidades puras (sin estado ni DOM).

// localStorage con manejo de errores
export function load(k, def){ try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch(e){ return def; } }
export function save(k, v){ localStorage.setItem(k, JSON.stringify(v)); }

// clave única de una canción dentro de un género
export function songKey(gid, t){ return gid + "::" + t; }

// escapar texto para insertar en HTML
export function esc(s){
  return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
}

// extraer el ID de 11 caracteres de un link (o un ID pelado) de YouTube
export function extractVideoId(url){
  if(!url) return null;
  url = url.trim();
  if(/^[\w-]{11}$/.test(url)) return url;               // ya es un ID
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}
