// Una llamada a /api (netlify/functions/api.mjs). Sin cuerpo es un GET; con
// cuerpo, un POST de JSON. Cualquier respuesta que no sea 2xx tira un error con
// su .status; si no hubo respuesta (sin red, o pasaron los 12 segundos) el
// error va sin .status. La usan las cuentas y todo lo que guarda algo fuera
// del navegador.
const API_ESPERA_MS = 12000;
export async function api(ruta, cuerpo){
  const corte = new AbortController();
  const reloj = setTimeout(()=> corte.abort(), API_ESPERA_MS);
  try{
    const r = await fetch("/api" + ruta, cuerpo === undefined
      ? { credentials: "same-origin", signal: corte.signal }
      : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpo), signal: corte.signal });
    if(!r.ok) throw Object.assign(new Error(ruta + ": " + r.status), { status: r.status });
    return await r.json();
  }finally{ clearTimeout(reloj); }
}

// Lo mismo, pero si se cortó la red o el servidor falló (5xx) prueba dos veces
// más. Solo para lo que se puede repetir sin cambiar nada (ver solo_sonar y
// solo_resolver en db/esquema.sql: el mismo paso dos veces vale por uno).
const espera = (ms)=> new Promise(ok=> setTimeout(ok, ms));
export async function apiInsistente(ruta, cuerpo){
  for(let intento = 0; ; intento++){
    try{ return await api(ruta, cuerpo); }
    catch(e){
      if(intento >= 2 || (e.status && e.status < 500)) throw e;
      await espera(700 * (intento + 1));
    }
  }
}

// Lo mismo que api(), pero si falla (sin red, sin base, con `npm run dev`)
// devuelve `siFalla` en vez de tirar: para lo que es un extra y no tiene que
// romper nada.
export async function apiSuave(ruta, cuerpo, siFalla = null){
  try{ return await api(ruta, cuerpo); }catch(_){ return siFalla; }
}
