// Utilidades puras (sin estado ni DOM).

// localStorage con manejo de errores
export function load(k, def){ try{ return JSON.parse(localStorage.getItem(k)) ?? def; }catch(e){ return def; } }
// Guardar nunca tira: con el almacenamiento lleno o bloqueado (modo privado,
// cookies apagadas) el juego sigue, solo que no recuerda. Devuelve si pudo.
export function save(k, v){
  try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; }
}

// clave única de una canción dentro de un género
export function songKey(gid, t){ return gid + "::" + t; }

// escapar texto para insertar en HTML
export function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

// extraer el ID de 11 caracteres de un link (o un ID pelado) de YouTube
export function extractVideoId(url){
  if(!url) return null;
  url = url.trim();
  if(/^[\w-]{11}$/.test(url)) return url;               // ya es un ID
  const m = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// Para comparar y buscar títulos: sin mayúsculas, acentos ni signos.
// "¿Qué ves?" y "que ves" quedan iguales.
export function norm(s){
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
