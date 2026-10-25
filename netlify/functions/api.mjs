// La API de las cuentas y el ranking del modo un jugador (/api/*).
//
// Hace de intermediario entre el navegador y la base (Postgres en Neon, ver
// db/esquema.sql): verifica el token de Google, mantiene la sesión en una
// cookie y llama a las funciones de la base pasándoles quién es. La lógica que
// cuida el ranking (que el video sea del catálogo, los tiempos…) está en la
// base; acá solo se validan los formatos y se pone la identidad.
//
// Variables de entorno (Netlify → Site configuration → Environment variables):
//   DATABASE_URL     la conexión de Neon
//   SESSION_SECRET   un texto largo al azar, para firmar la cookie de sesión
//   GOOGLE_CLIENT_ID (opcional) el ID de cliente OAuth de Google Cloud; es
//                    público y el mismo que usa src/cuenta.js
import { neon } from "@neondatabase/serverless";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { createHash } from "node:crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || "790742708415-p6r2dinuf89fa51ket66imcct7vd02db.apps.googleusercontent.com";
const GOOGLE_CERTS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const COOKIE_SESION = "eun_s";
const COOKIE_NONCE = "eun_n";
const SESION_SEG = 60 * 60 * 24 * 30;      // la sesión dura 30 días…
const RENOVAR_SEG = 60 * 60 * 24 * 7;      // …y se renueva si pasaron más de 7 desde que se firmó
const CANCIONES = [0, 5, 10, 15, 20, 30];  // las mismas que el select de Opciones; 0 = sin límite
const PERIODOS = ["semana", "mes", "siempre"];

export const config = { path: "/api/*" };

let _sql = null;
const sql = ()=> _sql || (_sql = neon(process.env.DATABASE_URL));

/* ============================================================
   UTILIDADES
   ============================================================ */
const json = (datos, status = 200, extra = [])=>{
  const h = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  extra.forEach(c=> h.append("Set-Cookie", c));
  return new Response(JSON.stringify(datos), { status, headers: h });
};
const redirigir = (destino, cookies = [])=>{
  const h = new Headers({ Location: destino, "Cache-Control": "no-store" });
  cookies.forEach(c=> h.append("Set-Cookie", c));
  return new Response(null, { status: 303, headers: h });
};

const clave = ()=> new TextEncoder().encode(process.env.SESSION_SECRET || "");
const sha256 = (texto)=> createHash("sha256").update(texto).digest("hex");

function leerCookies(req){
  const salida = {};
  (req.headers.get("cookie") || "").split(";").forEach(par=>{
    const i = par.indexOf("=");
    if(i > 0) salida[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  });
  return salida;
}
// Las dos cookies son HttpOnly: el navegador las manda pero la página no las lee.
// La del nonce viaja en el POST que Google hace desde su dominio, por eso
// SameSite=None (solo con https); la de sesión alcanza con Lax.
function cookie(nombre, valor, { seg, https, cruzada = false }){
  return `${nombre}=${valor}; Path=/; Max-Age=${seg}; HttpOnly; SameSite=${cruzada && https ? "None" : "Lax"}${https ? "; Secure" : ""}`;
}
const esHttps = (url)=> url.protocol === "https:";

async function firmarSesion(id){
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" })
    .setSubject(id).setIssuedAt().setExpirationTime(SESION_SEG + "s").sign(clave());
}
// { id, iat } de la cookie de sesión, o null
async function leerSesion(req){
  const c = leerCookies(req)[COOKIE_SESION];
  if(!c || !process.env.SESSION_SECRET) return null;
  try{
    const { payload } = await jwtVerify(c, clave(), { algorithms: ["HS256"] });
    return payload.sub ? { id: payload.sub, iat: payload.iat || 0 } : null;
  }catch(_){ return null; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
// Una ruta de este mismo sitio: nada de "//otro.com" ni "https://…"
const rutaLocal = (v)=> typeof v === "string" && /^\/(?!\/)[^\s\\]*$/.test(v) ? v : "/";

/* ============================================================
   GOOGLE
   ============================================================ */
// "Ana García" → "Ana G."; sin nombre en Google, "Jugador".
function nombreCorto(completo){
  const partes = String(completo || "").trim().split(/\s+/).filter(Boolean);
  const corto = partes.length > 1 ? partes[0] + " " + partes[partes.length - 1][0] + "." : (partes[0] || "Jugador");
  return corto.slice(0, 30);
}

// Comprueba el token de Google (firma, emisor, destinatario, vencimiento y que
// sea el de este intento: Google devuelve el SHA-256 del nonce que recibió).
async function verificarGoogle(credencial, nonce){
  if(typeof credencial !== "string" || typeof nonce !== "string" || !nonce) throw new Error("falta el token");
  const { payload } = await jwtVerify(credencial, GOOGLE_CERTS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: GOOGLE_CLIENT_ID,
  });
  if(payload.nonce !== sha256(nonce)) throw new Error("nonce");
  if(!payload.sub) throw new Error("sin sub");
  return payload;
}

// La cuenta de ese Google; se crea la primera vez. No se guarda el mail ni la foto.
async function cuentaDe(payload){
  const filas = await sql()`
    insert into public.usuarios (google_sub, nombre) values (${payload.sub}, ${nombreCorto(payload.name)})
    on conflict (google_sub) do update set google_sub = excluded.google_sub
    returning id, nombre`;
  return filas[0];
}

/* ============================================================
   RUTAS
   ============================================================ */
const RUTAS = {
  // Quién es el de la cookie (o null). Renueva la sesión si ya tiene unos días.
  "GET /yo": async ({ req, url })=>{
    const s = await leerSesion(req);
    if(!s) return json({ usuario: null }, 200, leerCookies(req)[COOKIE_SESION] ? [borrarSesion(url)] : []);
    const filas = await sql()`select id, nombre from public.usuarios where id = ${s.id}`;
    if(!filas.length) return json({ usuario: null }, 200, [borrarSesion(url)]);
    const renovar = Date.now() / 1000 - s.iat > RENOVAR_SEG;
    return json({ usuario: filas[0] }, 200,
      renovar ? [cookie(COOKIE_SESION, await firmarSesion(s.id), { seg: SESION_SEG, https: esHttps(url) })] : []);
  },

  // El botón de Google que abre la ventanita: manda el token y el nonce.
  "POST /auth/google": async ({ req, url })=>{
    const { credential, nonce } = await cuerpo(req);
    let usuario;
    try{ usuario = await cuentaDe(await verificarGoogle(credential, nonce)); }
    catch(e){ console.warn("[api] google:", e.message); return json({ error: "token" }, 401); }
    return json({ usuario }, 200, [cookie(COOKIE_SESION, await firmarSesion(usuario.id), { seg: SESION_SEG, https: esHttps(url) })]);
  },

  // Entrar por redirección, de respaldo si el botón de Google no carga: se va a
  // Google con un nonce que queda en una cookie, y Google vuelve con un POST a
  // /auth/google-vuelta.
  "GET /auth/entrar": async ({ url })=>{
    const nonce = crypto.randomUUID() + crypto.randomUUID();
    const vuelta = rutaLocal(url.searchParams.get("vuelta"));
    const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    google.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: url.origin + "/api/auth/google-vuelta",
      response_type: "id_token",
      response_mode: "form_post",
      scope: "openid profile",
      nonce: sha256(nonce),
      state: vuelta,
      prompt: "select_account",
    }).toString();
    return redirigir(google.toString(), [cookie(COOKIE_NONCE, nonce, { seg: 600, https: esHttps(url), cruzada: true })]);
  },

  "POST /auth/google-vuelta": async ({ req, url })=>{
    const form = await req.formData().catch(()=> new FormData());
    const vuelta = rutaLocal(form.get("state"));
    const destino = (ok)=> url.origin + vuelta + (vuelta.includes("?") ? "&" : "?") + "entro=" + (ok ? "1" : "0");
    const borrarNonce = cookie(COOKIE_NONCE, "", { seg: 0, https: esHttps(url), cruzada: true });
    try{
      const nonce = leerCookies(req)[COOKIE_NONCE];
      const usuario = await cuentaDe(await verificarGoogle(form.get("id_token"), nonce));
      return redirigir(destino(true), [borrarNonce, cookie(COOKIE_SESION, await firmarSesion(usuario.id), { seg: SESION_SEG, https: esHttps(url) })]);
    }catch(e){
      console.warn("[api] google-vuelta:", e.message);
      return redirigir(destino(false), [borrarNonce]);
    }
  },

  "POST /auth/salir": async ({ url })=> json({ ok: true }, 200, [borrarSesion(url)]),

  // El nombre del ranking
  "POST /yo/nombre": async ({ req })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    const { nombre } = await cuerpo(req);
    const limpio = typeof nombre === "string" ? nombre.trim().slice(0, 30) : "";
    if(!limpio) return json({ error: "nombre" }, 400);
    const filas = await sql()`update public.usuarios set nombre = ${limpio} where id = ${s.id} returning nombre`;
    return json({ nombre: filas.length ? filas[0].nombre : null });
  },

  // El historial propio
  "GET /partidas": async ({ req })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    const filas = await sql()`
      select canciones, segundos, puntos, jugada, videos from public.partidas_solo
      where usuario = ${s.id} order by jugada desc limit 500`;
    return json(filas);
  },

  "GET /ranking": async ({ req, url })=>{
    const canciones = Number(url.searchParams.get("canciones"));
    const limite = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("limite"))) || 20, 1), 100);
    const periodo = url.searchParams.get("periodo") || "siempre";
    if(!CANCIONES.includes(canciones) || !PERIODOS.includes(periodo)) return json({ error: "parámetros" }, 400);
    const s = await leerSesion(req);
    const filas = await sql()`
      select * from public.ranking_solo(${canciones}::smallint, ${limite}::int, ${periodo}::text, ${s ? s.id : null}::uuid)`;
    return json(filas.map(f=> ({ ...f, puesto: Number(f.puesto) })));
  },

  /* La partida, paso a paso. Cada uno devuelve lo que la función de la base. */
  "POST /solo/empezar": async ({ req })=>{
    const { canciones } = await cuerpo(req);
    if(!CANCIONES.includes(canciones)) return json({ error: "canciones" }, 400);
    const f = await sql()`select public.solo_empezar(${canciones}::smallint) as r`;
    return json(f[0].r);
  },
  "POST /solo/sonar": async ({ req })=>{
    const { partida, video } = await cuerpo(req);
    if(!UUID.test(partida) || !VIDEO.test(video)) return json(false);
    const f = await sql()`select public.solo_sonar(${partida}::uuid, ${video}::text) as r`;
    return json(f[0].r);
  },
  "POST /solo/resolver": async ({ req })=>{
    const { partida, segundos, titulo } = await cuerpo(req);
    if(!UUID.test(partida) || !Number.isInteger(segundos) || typeof titulo !== "string" && titulo !== null) return json(false);
    const f = await sql()`select public.solo_resolver(${partida}::uuid, ${segundos}::smallint, ${titulo === null ? null : titulo.slice(0, 200)}::text) as r`;
    return json(f[0].r);
  },
  "POST /solo/terminar": async ({ req })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    const { partida } = await cuerpo(req);
    if(!UUID.test(partida)) return json(null);
    const f = await sql()`select public.solo_terminar(${partida}::uuid, ${s.id}::uuid) as r`;
    return json(f[0].r);
  },
};

const borrarSesion = (url)=> cookie(COOKIE_SESION, "", { seg: 0, https: esHttps(url) });
const cuerpo = (req)=> req.json().then(d=> d && typeof d === "object" ? d : {}).catch(()=> ({}));

export default async (req)=>{
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const manejador = RUTAS[req.method + " " + ruta];
  if(!manejador) return json({ error: "no existe" }, 404);
  // Lo que cambia algo solo se acepta desde el propio sitio (el POST de Google
  // llega desde su dominio y se defiende con el nonce de la cookie).
  if(req.method === "POST" && ruta !== "/auth/google-vuelta"){
    const origen = req.headers.get("origin");
    if(!origen || new URL(origen).host !== url.host) return json({ error: "origen" }, 403);
  }
  try{
    return await manejador({ req, url });
  }catch(e){
    console.error("[api]", req.method, ruta, e);
    return json({ error: "error" }, 500);
  }
};
