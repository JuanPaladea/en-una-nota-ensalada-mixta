// Service worker: guarda la app para que abra sin internet (y se pueda jugar
// con los audios propios, que ya viven en el navegador).
//
// La regla es que nunca deje a nadie con una versión vieja teniendo conexión:
//   · Las páginas se piden primero a la red; la copia guardada es solo para
//     cuando no hay conexión.
//   · Lo de /assets lleva un hash en el nombre (si cambia el contenido, cambia
//     el nombre): se sirve de la copia sin preguntar.
//   · El resto (íconos, manifest) sale de la copia y se actualiza por detrás.
//   · /api y todo lo que no es de este sitio (YouTube, Google) no se toca.
// Lo registra src/main.js, solo en el sitio publicado.
const CACHE = "eun-v1";

self.addEventListener("install", ()=> self.skipWaiting());

self.addEventListener("activate", (ev)=>{
  ev.waitUntil((async ()=>{
    const claves = await caches.keys();
    await Promise.all(claves.filter(k=> k !== CACHE).map(k=> caches.delete(k)));
    await self.clients.claim();
  })());
});

// Las respuestas que llegaron por una redirección no se guardan: Safari no
// deja servirlas después como página.
const guardable = (res)=> res && res.ok && res.type === "basic" && !res.redirected;
const propia = (url)=> url.origin === self.location.origin && !url.pathname.startsWith("/api/");
// Se busca solo por la dirección. Sin esto, una respuesta guardada con
// "Vary: Origin" no coincidía con el pedido del <script type="module"> y la
// app no abría sin conexión.
const SOLO_URL = { ignoreVary: true };

// La página avisa qué archivos ya bajó antes de que este service worker
// estuviera activo (la primera visita): se guardan acá.
self.addEventListener("message", (ev)=>{
  const d = ev.data;
  if(!d || d.tipo !== "guardar" || !Array.isArray(d.urls)) return;
  ev.waitUntil((async ()=>{
    const cache = await caches.open(CACHE);
    await Promise.all(d.urls.slice(0, 80).map(async (u)=>{
      try{
        const url = new URL(u, self.location.origin);
        if(!propia(url) || await cache.match(url.href, SOLO_URL)) return;
        const res = await fetch(url.href);
        if(guardable(res)) await cache.put(url.href, res);
      }catch(_){}
    }));
  })());
});

async function deLaRed(req){
  const cache = await caches.open(CACHE);
  // Se guarda por la ruta sola: /?entro=1 y /?interno=1 son la misma página
  const ruta = new URL(req.url).pathname;
  try{
    const res = await fetch(req);
    if(guardable(res)) cache.put(ruta, res.clone());
    return res;
  }catch(e){
    // sin conexión: la página guardada o, si esa no está, el inicio
    const copia = await cache.match(ruta, SOLO_URL) || await cache.match("/", SOLO_URL);
    if(copia) return copia;
    throw e;
  }
}
async function deLaCopia(req, actualizar){
  const cache = await caches.open(CACHE);
  const copia = await cache.match(req, SOLO_URL);
  const red = (!copia || actualizar)
    ? fetch(req).then(res=>{ if(guardable(res)) cache.put(req, res.clone()); return res; })
    : null;
  if(copia){ if(red) red.catch(()=>{}); return copia; }
  return red;
}

self.addEventListener("fetch", (ev)=>{
  const req = ev.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if((url.protocol !== "http:" && url.protocol !== "https:") || !propia(url)) return;
  if(req.mode === "navigate"){ ev.respondWith(deLaRed(req)); return; }
  ev.respondWith(deLaCopia(req, !url.pathname.startsWith("/assets/")));
});
