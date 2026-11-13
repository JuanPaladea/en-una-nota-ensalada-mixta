// Una llamada a /api (netlify/functions/api.mjs). Sin cuerpo es un GET; con
// cuerpo, un POST de JSON. Cualquier respuesta que no sea 2xx tira un error.
// La usan las cuentas y todo lo que guarda algo fuera del navegador.
export async function api(ruta, cuerpo){
  const r = await fetch("/api" + ruta, cuerpo === undefined
    ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  if(!r.ok) throw new Error(ruta + ": " + r.status);
  return r.json();
}

// Lo mismo, pero si falla (sin red, sin base, con `npm run dev`) devuelve
// `siFalla` en vez de tirar: para lo que es un extra y no tiene que romper nada.
export async function apiSuave(ruta, cuerpo, siFalla = null){
  try{ return await api(ruta, cuerpo); }catch(_){ return siFalla; }
}
