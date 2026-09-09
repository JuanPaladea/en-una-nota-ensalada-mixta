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

if(activo){
  window.dataLayer = window.dataLayer || [];
  window.gtag = function(){ window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID);
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
