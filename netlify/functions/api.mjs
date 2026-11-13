// La API del juego (/api/*): cuentas, partidas de un jugador y ranking, y
// además el desafío del día, los duelos por link, las ligas privadas, los
// reportes de canciones, las listas compartidas y las salas de pulsadores.
//
// Hace de intermediario entre el navegador y la base (Postgres en Neon, ver
// db/esquema.sql): verifica el token de Google, mantiene la sesión en una
// cookie y llama a las funciones de la base pasándoles quién es. La lógica que
// cuida el ranking (que el video sea del catálogo, que el título sea el suyo…)
// está en la base; acá solo se validan los formatos y se pone la identidad.
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
const PERIODOS = ["hoy", "semana", "mes", "siempre"];   // hoy = el desafío del día
const MODOS = ["titulo", "artista"];
const MOTIVOS = ["no_suena", "otra_cancion", "version", "empieza_mal", "otro"];   // los de public.reportes
// Lo que se puede escribir sin cuenta (reportes, listas, salas) tiene un tope
// por hora entre todos: frena a un script, no a la gente.
const TOPE_HORA = { reportes: 300, listas: 200, salas: 500 };
const MAX_LISTA = 150;                     // canciones de una lista compartida

// rateLimit: hasta 120 pedidos por minuto por IP; pasado eso Netlify responde
// 429 sin llegar a ejecutar la función (ni a la base). Una partida de 10
// canciones son unos 25 pedidos. Si la regla quedara mal escrita el deploy no
// falla: se ve en el log del deploy.
export const config = {
  path: "/api/*",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

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
const GENERO = /^[a-z0-9]{2,20}$/;         // el id de una playlist de src/data.js
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CODIGO8 = /^[a-z0-9]{8}$/;           // duelos y listas
const CODIGO_LIGA = /^[A-Za-z0-9]{6}$/;
const CODIGO_SALA = /^[A-Z]{4}$/;

// Un texto corto escrito por alguien: sin espacios de más y con tope.
const texto = (v, max)=> typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
// Los nombres de los equipos de una sala: de 1 a 12, de hasta 20 letras.
function equiposValidos(v){
  if(!Array.isArray(v) || v.length < 1 || v.length > 12) return null;
  return v.map((n, i)=> texto(n, 20) || "Equipo " + (i + 1));
}
// Enteros para un smallint[] de la base ("{1,2,3}"), o null si alguno no lo es.
function enteros(v, min, max, tope){
  if(!Array.isArray(v) || v.length > tope) return null;
  if(!v.every(n=> Number.isInteger(n) && n >= min && n <= max)) return null;
  return "{" + v.join(",") + "}";
}
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

  // Borrar la cuenta: se van con ella todas sus partidas y sus ligas (on
  // delete cascade) y deja de figurar en el ranking. No se puede deshacer.
  "POST /yo/borrar": async ({ req, url })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    // Los resultados de duelos llevan el nombre escrito: se van también. Y las
    // ligas que quedan sin nadie.
    await sql()`delete from public.duelo_resultados where usuario = ${s.id}`;
    await sql()`delete from public.usuarios where id = ${s.id}`;
    await sql()`delete from public.ligas l where not exists (select 1 from public.liga_miembros m where m.liga = l.id)`;
    return json({ ok: true }, 200, [borrarSesion(url)]);
  },

  // El historial propio
  "GET /partidas": async ({ req })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    const filas = await sql()`
      select canciones, segundos, puntos, jugada, videos, genero, modo, dia::text as dia, duelo
      from public.partidas_solo
      where usuario = ${s.id} order by jugada desc limit 500`;
    return json(filas);
  },

  // periodo: hoy (el desafío del día) | semana | mes | siempre · genero: solo
  // las partidas de esa playlist · liga: solo las cuentas de esa liga (hay que
  // ser parte). Con periodo=hoy no se miran ni canciones ni genero.
  "GET /ranking": async ({ req, url })=>{
    const canciones = Number(url.searchParams.get("canciones"));
    const limite = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("limite"))) || 20, 1), 100);
    const periodo = url.searchParams.get("periodo") || "siempre";
    const genero = url.searchParams.get("genero") || null;
    const liga = url.searchParams.get("liga") || null;
    if(!CANCIONES.includes(canciones) || !PERIODOS.includes(periodo)
       || (genero && !GENERO.test(genero)) || (liga && !UUID.test(liga))) return json({ error: "parámetros" }, 400);
    const s = await leerSesion(req);
    if(liga){
      if(!s) return json({ error: "sin sesión" }, 401);
      const soy = await sql()`select 1 from public.liga_miembros where liga = ${liga}::uuid and usuario = ${s.id}::uuid`;
      if(!soy.length) return json({ error: "liga" }, 403);
    }
    const yo = s ? s.id : null;
    const filas = periodo === "hoy"
      ? await sql()`select * from public.ranking_desafio(public.hoy_ar(), ${limite}::int, ${yo}::uuid, ${liga}::uuid)`
      : await sql()`select * from public.ranking_solo(${canciones}::smallint, ${limite}::int, ${periodo}::text, ${yo}::uuid, ${genero}::text, ${liga}::uuid)`;
    return json(filas.map(f=> ({ ...f, puesto: Number(f.puesto) })));
  },

  /* ============================================================
     DESAFÍO DEL DÍA
     ============================================================ */
  // Las canciones de hoy (10 más 3 suplentes) y desde dónde suena cada una,
  // cuántas cuentas ya lo jugaron y, con sesión, cómo te fue.
  "GET /desafio": async ({ req })=>{
    const d = (await sql()`select dia::text as dia, videos, inicios from public.desafio_del_dia()`)[0];
    if(!d || !d.dia) return json({ dia: null });
    const s = await leerSesion(req);
    const cuantos = await sql()`select count(*)::int as n from public.partidas_solo where dia = ${d.dia}::date`;
    let mio = null;
    if(s){
      const f = (await sql()`select * from public.ranking_desafio(${d.dia}::date, 1, ${s.id}::uuid)`).find(x=> x.es_mio);
      if(f) mio = { puesto: Number(f.puesto), puntos: f.puntos, segundos: f.segundos };
    }
    return json({ ...d, jugaron: cuantos[0].n, mio });
  },

  /* La partida, paso a paso. Cada uno devuelve lo que la función de la base. */
  // genero: la playlist, si se juega con una sola · modo: titulo | artista ·
  // dia: el desafío de esa fecha · duelo: el que se va a responder
  "POST /solo/empezar": async ({ req })=>{
    const { canciones, genero = null, modo = "titulo", dia = null, duelo = null } = await cuerpo(req);
    if(!CANCIONES.includes(canciones)) return json({ error: "canciones" }, 400);
    if((genero !== null && !GENERO.test(genero)) || !MODOS.includes(modo)
       || (dia !== null && !FECHA.test(dia)) || (duelo !== null && !CODIGO8.test(duelo))) return json(null);
    const f = await sql()`select public.solo_empezar(${canciones}::smallint, ${genero}::text, ${modo}::text, ${dia}::date, ${duelo}::text) as r`;
    return json(f[0].r);
  },
  "POST /solo/sonar": async ({ req })=>{
    const { partida, video } = await cuerpo(req);
    if(!UUID.test(partida) || !VIDEO.test(video)) return json(false);
    const f = await sql()`select public.solo_sonar(${partida}::uuid, ${video}::text) as r`;
    return json(f[0].r);
  },
  // titulo: lo que eligió (en el modo artista, el artista) · pistas: cuántos de
  // los segundos fueron pistas y no audio
  "POST /solo/resolver": async ({ req })=>{
    const { partida, segundos, titulo, pistas = 0 } = await cuerpo(req);
    if(!UUID.test(partida) || !Number.isInteger(segundos) || segundos < 0 || segundos > 6
       || !Number.isInteger(pistas) || pistas < 0 || pistas > 2
       || typeof titulo !== "string" && titulo !== null) return json(false);
    const f = await sql()`select public.solo_resolver(${partida}::uuid, ${segundos}::smallint, ${titulo === null ? null : titulo.slice(0, 200)}::text, ${pistas}::smallint) as r`;
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

  /* ============================================================
     DUELOS POR LINK
     Las canciones de una partida, para que otro juegue lo mismo. Se puede
     sin cuenta: ahí el nombre es el que escriba cada uno.
     ============================================================ */
  // Arma el duelo con la partida recién jugada. inicios: desde qué segundo
  // sonó cada canción. Devuelve { id } (null si no se pudo).
  "POST /duelo/crear": async ({ req })=>{
    const { partida, inicios, nombre } = await cuerpo(req);
    const lista = enteros(inicios, 0, 36000, 600);
    if(!UUID.test(partida) || lista === null) return json({ id: null });
    const quien = await quienJuega(req, nombre);
    if(!quien.nombre) return json({ id: null });
    const f = await sql()`select public.duelo_crear(${partida}::uuid, ${lista}::smallint[], ${quien.nombre}::text, ${quien.id}::uuid) as r`;
    return json({ id: f[0].r });
  },
  // Anota el resultado de la partida en el duelo que respondía y devuelve la tabla.
  "POST /duelo/anotar": async ({ req })=>{
    const { partida, nombre } = await cuerpo(req);
    if(!UUID.test(partida)) return json(null);
    const quien = await quienJuega(req, nombre);
    if(!quien.nombre) return json(null);
    const f = await sql()`select public.duelo_anotar(${partida}::uuid, ${quien.nombre}::text, ${quien.id}::uuid) as r`;
    return json(f[0].r ? await verDuelo(f[0].r, quien.id, partida) : null);
  },
  // El duelo de un link: qué suena y cómo le fue a cada uno. partida (opcional)
  // marca cuál fila es la de este navegador cuando se jugó sin cuenta.
  "GET /duelo": async ({ req, url })=>{
    const id = url.searchParams.get("id") || "";
    const partida = url.searchParams.get("partida");
    if(!CODIGO8.test(id) || (partida && !UUID.test(partida))) return json(null);
    const s = await leerSesion(req);
    return json(await verDuelo(id, s ? s.id : null, partida || null));
  },

  /* ============================================================
     LIGAS PRIVADAS
     ============================================================ */
  "GET /ligas": async ({ req })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    const filas = await sql()`
      select l.id, l.codigo, l.nombre, l.creador is not distinct from ${s.id}::uuid as es_creador,
             (select count(*)::int from public.liga_miembros x where x.liga = l.id) as miembros
      from public.ligas l join public.liga_miembros m on m.liga = l.id
      where m.usuario = ${s.id}::uuid order by m.desde`;
    return json(filas);
  },
  "POST /ligas/crear": async ({ req })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    const nombre = texto((await cuerpo(req)).nombre, 40);
    if(!nombre) return json({ error: "nombre" }, 400);
    const f = await sql()`select public.liga_crear(${s.id}::uuid, ${nombre}::text) as r`;
    return json({ codigo: f[0].r });
  },
  // Devuelve { liga, nombre }; liga null si el código no existe o no hay lugar.
  "POST /ligas/unirse": async ({ req })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    const codigo = texto((await cuerpo(req)).codigo, 6);
    if(!CODIGO_LIGA.test(codigo)) return json({ liga: null });
    const f = await sql()`select public.liga_unirse(${s.id}::uuid, ${codigo}::text) as r`;
    if(!f[0].r) return json({ liga: null });
    const l = await sql()`select nombre from public.ligas where id = ${f[0].r}::uuid`;
    return json({ liga: f[0].r, nombre: l.length ? l[0].nombre : "" });
  },
  "POST /ligas/salir": async ({ req })=>{
    const s = await leerSesion(req);
    if(!s) return json({ error: "sin sesión" }, 401);
    const { liga } = await cuerpo(req);
    if(!UUID.test(liga)) return json(false);
    const f = await sql()`select public.liga_salir(${s.id}::uuid, ${liga}::uuid) as r`;
    return json(f[0].r);
  },

  /* ============================================================
     REPORTES · LISTAS COMPARTIDAS
     ============================================================ */
  // "Esta canción anda mal". Solo de videos del catálogo.
  "POST /reporte": async ({ req })=>{
    const { video, motivo } = await cuerpo(req);
    if(!VIDEO.test(video) || !MOTIVOS.includes(motivo)) return json(false);
    const s = await leerSesion(req);
    const f = await sql()`
      insert into public.reportes (video, motivo, usuario)
      select ${video}::text, ${motivo}::text, ${s ? s.id : null}::uuid
      where exists (select 1 from public.catalogo_solo c where c.video = ${video}::text)
        and (select count(*) from public.reportes r where r.creado > now() - interval '1 hour') < ${TOPE_HORA.reportes}
      returning id`;
    return json(f.length > 0);
  },
  // Guarda las canciones propias de YouTube de alguien y devuelve el código del link.
  "POST /lista": async ({ req })=>{
    const { nombre, canciones } = await cuerpo(req);
    const titulo = texto(nombre, 40) || "Mis canciones";
    if(!Array.isArray(canciones) || !canciones.length || canciones.length > MAX_LISTA) return json({ codigo: null });
    const limpias = [];
    for(const c of canciones){
      if(!Array.isArray(c) || !VIDEO.test(c[2])) return json({ codigo: null });
      const t = texto(c[0], 80);
      if(!t) return json({ codigo: null });
      limpias.push([t, texto(c[1], 80), c[2]]);
    }
    const s = await leerSesion(req);
    const f = await sql()`
      insert into public.listas (codigo, nombre, canciones, usuario)
      select substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), ${titulo}::text, ${JSON.stringify(limpias)}::jsonb, ${s ? s.id : null}::uuid
      where (select count(*) from public.listas l where l.creada > now() - interval '1 hour') < ${TOPE_HORA.listas}
      returning codigo`;
    return json({ codigo: f.length ? f[0].codigo : null });
  },
  "GET /lista": async ({ url })=>{
    const codigo = url.searchParams.get("codigo") || "";
    if(!CODIGO8.test(codigo)) return json(null);
    const f = await sql()`select nombre, canciones from public.listas where codigo = ${codigo}`;
    return json(f.length ? f[0] : null);
  },

  /* ============================================================
     SALAS (PULSADORES)
     Con amigos: el que maneja la partida abre una sala, los demás entran con
     el código y tocan "¡YO!" en su celular. La base dice quién llegó primero.
     ============================================================ */
  // Devuelve { codigo, clave }: la clave queda en el navegador que maneja la partida.
  "POST /sala/crear": async ({ req })=>{
    const equipos = equiposValidos((await cuerpo(req)).equipos);
    if(!equipos) return json(null);
    const hay = await sql()`select count(*)::int as n from public.salas where creada > now() - interval '1 hour'`;
    if(hay[0].n >= TOPE_HORA.salas) return json(null);
    const f = await sql()`select public.sala_crear(array(select jsonb_array_elements_text(${JSON.stringify(equipos)}::jsonb))) as r`;
    return json(f[0].r);
  },
  // Abre o cierra los pulsadores. excluidos: equipos que ya erraron esta
  // canción · equipos (opcional): los nombres, si cambiaron · limpiar: al
  // cerrar, olvidar también quién había pulsado (la canción ya terminó).
  "POST /sala/ronda": async ({ req })=>{
    const { codigo, clave, abierta, excluidos = [], equipos, limpiar } = await cuerpo(req);
    const fuera = enteros(excluidos, 0, 11, 12);
    const nombres = equipos === undefined ? null : equiposValidos(equipos);
    if(!CODIGO_SALA.test(codigo) || !UUID.test(clave) || fuera === null || (equipos !== undefined && !nombres)) return json(false);
    const f = nombres
      ? await sql()`select public.sala_ronda(${codigo}::text, ${clave}::uuid, ${abierta === true}::boolean, ${fuera}::smallint[],
          array(select jsonb_array_elements_text(${JSON.stringify(nombres)}::jsonb)), ${limpiar === true}::boolean) as r`
      : await sql()`select public.sala_ronda(${codigo}::text, ${clave}::uuid, ${abierta === true}::boolean, ${fuera}::smallint[],
          null::text[], ${limpiar === true}::boolean) as r`;
    return json(f[0].r);
  },
  // Lo que mira el que maneja la partida mientras suena: si ya pulsó alguien.
  // Va por POST para que la clave no viaje en la dirección.
  "POST /sala/estado": async ({ req })=>{
    const { codigo, clave } = await cuerpo(req);
    if(!CODIGO_SALA.test(codigo) || !UUID.test(clave)) return json(null);
    const f = await sql()`select abierta, primero from public.salas where codigo = ${codigo} and clave = ${clave}::uuid`;
    return json(f.length ? f[0] : null);
  },
  // Para el celular que se suma: los equipos de la sala (null si no existe).
  "GET /sala": async ({ url })=>{
    const codigo = (url.searchParams.get("codigo") || "").toUpperCase();
    if(!CODIGO_SALA.test(codigo)) return json(null);
    const f = await sql()`select codigo, equipos from public.salas where codigo = ${codigo}`;
    return json(f.length ? f[0] : null);
  },
  // Un equipo tocó "¡YO!". Devuelve { estado, primero, equipos }.
  "POST /sala/yo": async ({ req })=>{
    const { codigo, equipo } = await cuerpo(req);
    if(!CODIGO_SALA.test(codigo) || !Number.isInteger(equipo) || equipo < 0 || equipo > 11) return json({ estado: "no" });
    const f = await sql()`select public.sala_pulsar(${codigo}::text, ${equipo}::smallint) as r`;
    return json(f[0].r);
  },
};

// Con sesión, la cuenta y su nombre; sin sesión, el nombre que escribió.
async function quienJuega(req, nombre){
  const s = await leerSesion(req);
  if(s){
    const f = await sql()`select nombre from public.usuarios where id = ${s.id}::uuid`;
    if(f.length) return { id: s.id, nombre: f[0].nombre };
  }
  return { id: null, nombre: texto(nombre, 30) };
}

// El duelo con su tabla (mejor puntaje arriba; a igual puntaje, el que jugó
// antes), o null si no existe. es_mio: la fila de esa cuenta o de esa partida.
async function verDuelo(id, usuario, partida){
  const d = await sql()`select id, canciones, modo, videos, inicios from public.duelos where id = ${id}`;
  if(!d.length) return null;
  const resultados = await sql()`
    select nombre, puntos, segundos,
           (usuario is not null and usuario is not distinct from ${usuario}::uuid)
             or partida is not distinct from ${partida}::uuid as es_mio
    from public.duelo_resultados where duelo = ${id}
    order by puntos desc, jugada asc limit 50`;
  return { ...d[0], resultados };
}

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
    // Un Origin que no es una dirección ("null", de un iframe aislado) tampoco pasa
    let host = null;
    try{ host = new URL(req.headers.get("origin") || "").host; }catch(_){}
    if(host !== url.host) return json({ error: "origen" }, 403);
  }
  try{
    return await manejador({ req, url });
  }catch(e){
    console.error("[api]", req.method, ruta, e);
    return json({ error: "error" }, 500);
  }
};
