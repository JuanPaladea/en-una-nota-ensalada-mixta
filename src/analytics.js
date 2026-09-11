// Medición de uso con Google Analytics 4.
//
// Search Console cuenta cuánta gente nos encuentra en Google; esto cuenta qué
// hace después: cuántos arrancan una partida, cuántas canciones escuchan,
// cuántos llegan al final y cuántos comparten. Sin ID configurado no se carga
// ni un byte de Google.
//
// El ID sale de la propiedad en analytics.google.com (Administrar → Flujos de
// datos → Web). Vaciarlo acá apaga la medición por completo.
const GA_ID = "G-HM46QH4KBQ";

// En desarrollo no se mide: si no, las pruebas propias ensucian los números.
const enDesarrollo = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const activo = Boolean(GA_ID) && !enDesarrollo;

// Las partidas propias en el sitio publicado tampoco tienen que contar. Entrando
// una vez con ?interno=1 este navegador queda marcado (con ?interno=0 se
// desmarca) y sus eventos viajan con traffic_type=internal, que el filtro
// "Internal Traffic" de la propiedad descarta. Va por navegador y no por IP
// porque la IP de casa cambia y la del celular también.
const MARCA_INTERNO = "enunanota_interno";
function esInterno(){
  try{
    const q = new URLSearchParams(location.search).get("interno");
    if(q === "1") localStorage.setItem(MARCA_INTERNO, "1");
    if(q === "0") localStorage.removeItem(MARCA_INTERNO);
    return localStorage.getItem(MARCA_INTERNO) === "1";
  }catch(_){ return false; }
}

if(activo){
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID, esInterno() ? { traffic_type: "internal" } : {});
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?" + new URLSearchParams({ id: GA_ID });
  document.head.appendChild(s);
}

// Registra un evento. Si la medición está apagada — desarrollo, sin ID, o un
// bloqueador de anuncios que se comió el script — no hace nada: medir nunca
// puede romper el juego.
export function track(evento, props){
  // En desarrollo se ven por consola, así se puede comprobar que disparan.
  if(enDesarrollo){ console.debug("[analytics]", evento, props || {}); return; }
  if(!activo || typeof window.gtag !== "function") return;
  try{ window.gtag("event", evento, props || {}); }catch(_){}
}
