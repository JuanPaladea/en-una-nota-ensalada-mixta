-- Base de datos de las cuentas, el ranking y el resto de lo que se guarda fuera
-- del navegador (Postgres en Neon).
--
-- Se puede volver a ejecutar sin romper nada: `npm run db -- db/esquema.sql`.
-- Después de ejecutarlo hay que subir el catálogo (`npm run catalogo:subir`).
-- A la base solo entra la función de netlify/functions/api.mjs, con un único
-- usuario de la base: no hay reglas por fila ni permisos por rol. Quién es
-- quién lo decide la función (cookie de sesión) y se lo pasa a estas funciones
-- en p_usuario.
--
-- Cada cuenta tiene un nombre que se muestra en el ranking (solo nombre e
-- inicial del apellido: el mail y la foto de Google no se guardan). Cada
-- partida guarda los segundos que hicieron falta en cada canción, y los puntos
-- los calcula la base con la misma tabla que el juego: el navegador no manda
-- un puntaje que haya que creerle.
--
-- Qué hay acá:
--   cuentas · partidas de Un jugador · catálogo · partidas en curso
--   desafío del día · duelos por link · ranking (general, por género, por liga)
--   ligas privadas · reportes de canciones · listas compartidas · salas (pulsadores)

-- ===================== AJUSTES =====================
-- sal_desafio: con ella se sortean las canciones de cada día. Se genera sola la
-- primera vez y no está en el repo: sin ella no se puede saber de antemano qué
-- va a sonar mañana.
create table if not exists public.ajustes (
  clave  text primary key,
  valor  text not null
);
insert into public.ajustes (clave, valor) values ('sal_desafio', gen_random_uuid()::text)
  on conflict (clave) do nothing;

-- El día de hoy en la Argentina: el desafío cambia a las 0 h de allá.
create or replace function public.hoy_ar() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date
$$;

-- ===================== CUENTAS =====================
-- google_sub: el identificador de la cuenta de Google (no dice quién es).
create table if not exists public.usuarios (
  id          uuid primary key default gen_random_uuid(),
  google_sub  text not null unique,
  nombre      text not null check (char_length(btrim(nombre)) between 1 and 30),
  creado      timestamptz not null default now()
);

-- ===================== PARTIDAS =====================
-- Misma tabla que PUNTOS_SOLO en src/main.js: 1 s → 10, 2 s → 7 … 6 s → 1, 0 = no salió.
create or replace function public.puntos_solo(segundos smallint[]) returns smallint
language sql immutable set search_path = '' as $$
  select coalesce(sum((array[10,7,5,3,2,1])[s]), 0)::smallint
  from unnest(segundos) as s
$$;

-- videos: los que sonaron, en orden (null en las que se guardaron antes de anotarlos).
-- genero: el de la playlist, cuando la partida se jugó con una sola (ranking por género).
-- modo:   'titulo' (se escribe el título) o 'artista' (se escribe quién la canta).
-- dia:    la fecha del desafío del día, si la partida fue ese desafío.
-- duelo:  el duelo que se estaba respondiendo, si fue uno.
create table if not exists public.partidas_solo (
  id         bigint generated always as identity primary key,
  usuario    uuid not null references public.usuarios on delete cascade,
  canciones  smallint not null check (canciones in (0, 5, 10, 15, 20, 30)),  -- 0 = sin límite
  segundos   smallint[] not null check (
               cardinality(segundos) between 1 and 600
               and 0 <= all(segundos) and 6 >= all(segundos)),
  resueltas  smallint generated always as (cardinality(segundos)) stored,
  puntos     smallint generated always as (public.puntos_solo(segundos)) stored,
  jugada     timestamptz not null default now(),
  videos     text[],
  check (canciones = 0 or cardinality(segundos) <= canciones)
);
alter table public.partidas_solo add column if not exists genero text;
alter table public.partidas_solo add column if not exists modo text not null default 'titulo' check (modo in ('titulo', 'artista'));
alter table public.partidas_solo add column if not exists dia date;
alter table public.partidas_solo add column if not exists duelo text;
create index if not exists partidas_solo_ranking on public.partidas_solo (canciones, usuario, puntos desc);
create index if not exists partidas_solo_mias on public.partidas_solo (usuario, jugada desc);
-- Para la semana y el mes se buscan las partidas recientes de cada cantidad.
create index if not exists partidas_solo_periodo on public.partidas_solo (canciones, jugada);
-- El desafío del día: una sola partida por cuenta y por fecha.
create unique index if not exists partidas_solo_desafio on public.partidas_solo (usuario, dia) where dia is not null;
create index if not exists partidas_solo_dia on public.partidas_solo (dia, puntos desc) where dia is not null;

-- ===================== CATÁLOGO =====================
-- Las canciones de src/data.js: video de YouTube, título y artista pasados por
-- norm(), y la playlist. Un video que está en dos playlists tiene dos filas.
-- Se regenera con `npm run catalogo` y se sube con `npm run catalogo:subir`.
create table if not exists public.catalogo_solo (
  video    text not null check (video ~ '^[A-Za-z0-9_-]{11}$'),
  titulo   text not null,
  artista  text not null default '',
  genero   text not null default ''
);
alter table public.catalogo_solo add column if not exists artista text not null default '';
alter table public.catalogo_solo add column if not exists genero text not null default '';
-- Antes la clave era (video, título): con una fila por playlist ya no sirve.
alter table public.catalogo_solo drop constraint if exists catalogo_solo_pkey;
create index if not exists catalogo_solo_video on public.catalogo_solo (video);

-- ===================== PARTIDAS EN CURSO =====================
-- La partida se va anotando en la base mientras se juega, con o sin cuenta.
-- Sin dueño: la identifica el uuid, que solo conoce el navegador que la empezó.
-- videos: los que sonaron, en orden · segundos: con cuántos salió cada una ya
-- resuelta (0 = no salió) · sono_en: cuándo empezó a sonar la última ·
-- cambios: videos reemplazados porque YouTube no los pasó.
-- genero, modo, dia, duelo: lo mismo que en partidas_solo · reto: el duelo que
-- se armó con esta partida · guardada: ya pasó al historial de una cuenta (se
-- deja unas horas más para poder armar un duelo con ella).
create table if not exists public.partidas_en_curso (
  id         uuid primary key default gen_random_uuid(),
  canciones  smallint not null check (canciones in (0, 5, 10, 15, 20, 30)),
  empezada   timestamptz not null default now(),
  videos     text[] not null default '{}',
  segundos   smallint[] not null default '{}',
  sono_en    timestamptz,
  cambios    smallint not null default 0
);
alter table public.partidas_en_curso add column if not exists genero text;
alter table public.partidas_en_curso add column if not exists modo text not null default 'titulo';
alter table public.partidas_en_curso add column if not exists dia date;
alter table public.partidas_en_curso add column if not exists duelo text;
alter table public.partidas_en_curso add column if not exists reto text;
alter table public.partidas_en_curso add column if not exists guardada boolean not null default false;
create index if not exists partidas_en_curso_empezada on public.partidas_en_curso (empezada);

-- ===================== DESAFÍO DEL DÍA =====================
-- Las mismas canciones para todos, una vez por día. videos: 10 más 3 suplentes
-- (por si YouTube no pasa alguna en ese país) · inicios: desde qué segundo
-- suena cada una, para que a todos les toque el mismo fragmento.
create table if not exists public.desafios (
  dia      date primary key,
  videos   text[] not null,
  inicios  smallint[] not null
);

-- El desafío de hoy; lo sortea la primera vez que alguien lo pide. No repite
-- canciones de los últimos 30 días ni dos versiones del mismo título.
create or replace function public.desafio_del_dia() returns public.desafios
language plpgsql set search_path = '' as $$
declare
  v_dia date := public.hoy_ar();
  d public.desafios;
begin
  select * into d from public.desafios where dia = v_dia;
  if found then return d; end if;
  insert into public.desafios (dia, videos, inicios)
    select v_dia, array_agg(e.video order by e.orden), array_agg(e.inicio order by e.orden)
    from (
      select c.video,
             md5(c.video || v_dia::text || s.valor) as orden,
             (60 + (('x' || substr(md5(s.valor || c.video || v_dia::text), 1, 6))::bit(24)::int % 60))::smallint as inicio
      from (select distinct on (t.titulo) t.video from public.catalogo_solo t order by t.titulo, t.video) c
      cross join (select a.valor from public.ajustes a where a.clave = 'sal_desafio') s
      where not exists (
        select 1 from public.desafios x where x.dia >= v_dia - 30 and c.video = any(x.videos))
      order by orden
      limit 13
    ) e
    having count(*) >= 10
  on conflict (dia) do nothing;
  select * into d from public.desafios where dia = v_dia;
  return d;
end $$;

-- ===================== DUELOS POR LINK =====================
-- Un duelo son las canciones de una partida (y desde dónde sonó cada una) para
-- que otro juegue exactamente lo mismo. id: lo que va en el link. Cada uno que
-- lo juega deja su resultado, con cuenta o con el nombre que escriba.
create table if not exists public.duelos (
  id         text primary key check (id ~ '^[a-z0-9]{8}$'),
  canciones  smallint not null,
  modo       text not null default 'titulo',
  videos     text[] not null,
  inicios    smallint[] not null,
  creado     timestamptz not null default now()
);
create table if not exists public.duelo_resultados (
  duelo     text not null references public.duelos on delete cascade,
  partida   uuid not null,     -- la partida en curso de la que salió: no se anota dos veces
  usuario   uuid references public.usuarios on delete set null,
  nombre    text not null check (char_length(btrim(nombre)) between 1 and 30),
  segundos  smallint[] not null,
  puntos    smallint generated always as (public.puntos_solo(segundos)) stored,
  jugada    timestamptz not null default now(),
  primary key (duelo, partida)
);
create unique index if not exists duelo_resultados_usuario on public.duelo_resultados (duelo, usuario) where usuario is not null;

-- ===================== LIGAS PRIVADAS =====================
-- Un ranking entre amigos: se crea, se pasa el código y cada uno se suma con su cuenta.
create table if not exists public.ligas (
  id       uuid primary key default gen_random_uuid(),
  codigo   text not null unique check (codigo ~ '^[A-Z0-9]{6}$'),
  nombre   text not null check (char_length(btrim(nombre)) between 1 and 40),
  creador  uuid references public.usuarios on delete set null,
  creada   timestamptz not null default now()
);
create table if not exists public.liga_miembros (
  liga     uuid not null references public.ligas on delete cascade,
  usuario  uuid not null references public.usuarios on delete cascade,
  desde    timestamptz not null default now(),
  primary key (liga, usuario)
);
create index if not exists liga_miembros_usuario on public.liga_miembros (usuario);

-- ===================== REPORTES =====================
-- "Esta canción anda mal", desde la partida. Se miran con `npm run reportes`.
create table if not exists public.reportes (
  id       bigint generated always as identity primary key,
  video    text not null check (video ~ '^[A-Za-z0-9_-]{11}$'),
  motivo   text not null check (motivo in ('no_suena', 'otra_cancion', 'version', 'empieza_mal', 'otro')),
  usuario  uuid references public.usuarios on delete set null,
  creado   timestamptz not null default now()
);
create index if not exists reportes_video on public.reportes (video);
create index if not exists reportes_creado on public.reportes (creado);

-- ===================== LISTAS COMPARTIDAS =====================
-- Las canciones propias de YouTube de alguien, para pasarlas por link.
-- canciones: [[título, artista, idDeYouTube], …]
create table if not exists public.listas (
  codigo     text primary key check (codigo ~ '^[a-z0-9]{8}$'),
  nombre     text not null check (char_length(btrim(nombre)) between 1 and 40),
  canciones  jsonb not null,
  usuario    uuid references public.usuarios on delete set null,
  creada     timestamptz not null default now()
);
create index if not exists listas_creada on public.listas (creada);

-- ===================== SALAS (PULSADORES) =====================
-- Con amigos: cada equipo toca "¡YO!" en su celular y la base dice quién llegó
-- primero. codigo: lo que escriben para sumarse · clave: solo la tiene el que
-- maneja la partida · abierta: si se puede pulsar · primero: el equipo que
-- pulsó antes · excluidos: equipos que ya erraron esta canción.
create table if not exists public.salas (
  codigo     text primary key check (codigo ~ '^[A-Z]{4}$'),
  clave      uuid not null default gen_random_uuid(),
  equipos    text[] not null,
  abierta    boolean not null default false,
  ronda      int not null default 0,
  primero    smallint,
  pulso      timestamptz,
  excluidos  smallint[] not null default '{}',
  creada     timestamptz not null default now()
);
create index if not exists salas_creada on public.salas (creada);

-- ===================== PASOS DE LA PARTIDA =====================
-- La base comprueba que el video sea del catálogo, que el título sea el suyo y
-- que haya pasado el tiempo de los fragmentos que sonaron. Si algo no cierra,
-- la partida se descarta.

-- Empieza una partida. De paso borra las abandonadas hace más de 6 horas.
-- p_genero: la playlist, si se juega con una sola · p_modo: titulo | artista ·
-- p_dia: la fecha del desafío del día (tiene que ser hoy) · p_duelo: el duelo
-- que se va a responder. Devuelve null si algo no corresponde.
drop function if exists public.solo_empezar(smallint);
create or replace function public.solo_empezar(
  p_canciones smallint, p_genero text default null, p_modo text default 'titulo',
  p_dia date default null, p_duelo text default null)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  v_modo text := coalesce(p_modo, 'titulo');
begin
  delete from public.partidas_en_curso where empezada < now() - interval '6 hours';
  if v_modo not in ('titulo', 'artista') then return null; end if;
  if p_genero is not null
     and not exists (select 1 from public.catalogo_solo c where c.genero = p_genero) then
    return null;
  end if;
  if p_dia is not null
     and (p_dia <> public.hoy_ar() or p_canciones <> 10 or v_modo <> 'titulo'
          or p_genero is not null or p_duelo is not null) then
    return null;
  end if;
  if p_duelo is not null
     and not exists (select 1 from public.duelos d
                     where d.id = p_duelo and d.canciones = p_canciones and d.modo = v_modo) then
    return null;
  end if;
  insert into public.partidas_en_curso (canciones, genero, modo, dia, duelo)
    values (p_canciones, p_genero, v_modo, p_dia, p_duelo)
    returning id into v_id;
  return v_id;
end $$;

-- Empezó a sonar un video. Si la anterior todavía no se resolvió es un
-- reemplazo (YouTube no la pasó): se cambia, hasta 3 veces por partida.
-- Un video repetido, fuera del catálogo (o de la playlist de la partida, o del
-- desafío de ese día) o de más descarta la partida.
create or replace function public.solo_sonar(p_partida uuid, p_video text) returns boolean
language plpgsql set search_path = '' as $$
declare
  p public.partidas_en_curso;
  n int;
begin
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found or p.guardada then return false; end if;
  n := cardinality(p.videos);
  if p_video = any(p.videos)
     or not exists (select 1 from public.catalogo_solo c
                    where c.video = p_video and (p.genero is null or c.genero = p.genero))
     or (p.dia is not null and not (p_video = any(coalesce(
           (select d.videos from public.desafios d where d.dia = p.dia), '{}'::text[])))) then
    delete from public.partidas_en_curso where id = p_partida;
    return false;
  end if;
  if n > cardinality(p.segundos) then
    if p.cambios >= 3 then
      delete from public.partidas_en_curso where id = p_partida;
      return false;
    end if;
    update public.partidas_en_curso
      set videos = p.videos[1:n-1] || p_video, sono_en = now(), cambios = p.cambios + 1
      where id = p_partida;
  else
    if p.canciones > 0 and n >= p.canciones then
      delete from public.partidas_en_curso where id = p_partida;
      return false;
    end if;
    update public.partidas_en_curso
      set videos = p.videos || p_video, sono_en = now()
      where id = p_partida;
  end if;
  return true;
end $$;

-- Se resolvió la canción que suena: con p_segundos (1 a 6) y lo que eligió (el
-- título o, en el modo artista, el artista), o 0 si no salió. p_pistas: cuántos
-- de esos pasos fueron pistas y no audio (hasta 2). Con a pasos de audio
-- sonaron 1 + 2 + … + a segundos; se dan 2 de margen por la red.
drop function if exists public.solo_resolver(uuid, smallint, text);
create or replace function public.solo_resolver(
  p_partida uuid, p_segundos smallint, p_titulo text, p_pistas smallint default 0)
returns boolean
language plpgsql set search_path = '' as $$
declare
  p public.partidas_en_curso;
  n int;
  v_pistas int := coalesce(p_pistas, 0);
  v_audio int;
begin
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found or p.guardada then return false; end if;
  n := cardinality(p.videos);
  v_audio := coalesce(p_segundos, 0) - v_pistas;
  if n <> cardinality(p.segundos) + 1 or p_segundos is null or p_segundos not between 0 and 6
     or v_pistas not between 0 and 2
     or (p_segundos > 0 and (
       v_audio < 1
       or not exists (select 1 from public.catalogo_solo c
                      where c.video = p.videos[n]
                        and (case when p.modo = 'artista' then c.artista else c.titulo end) = p_titulo)
       or now() - p.sono_en < make_interval(secs => greatest(0, v_audio * (v_audio + 1) / 2.0 - 2))
     )) then
    delete from public.partidas_en_curso where id = p_partida;
    return false;
  end if;
  update public.partidas_en_curso set segundos = p.segundos || p_segundos where id = p_partida;
  return true;
end $$;

-- Pasa la partida a la cuenta p_usuario. La que sonó y no se resolvió
-- (terminó a mitad de canción) cuenta como que no salió. Devuelve los puntos,
-- o null si no se guardó: no existe, ya estaba guardada o era el desafío de un
-- día que esa cuenta ya había jugado (vale el primer intento).
create or replace function public.solo_terminar(p_partida uuid, p_usuario uuid) returns smallint
language plpgsql set search_path = '' as $$
declare
  p public.partidas_en_curso;
  v_segundos smallint[];
  v_puntos smallint;
begin
  if p_usuario is null then raise exception 'hace falta entrar con una cuenta'; end if;
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found or p.guardada then return null; end if;
  v_segundos := p.segundos || array_fill(0::smallint, array[cardinality(p.videos) - cardinality(p.segundos)]);
  if cardinality(v_segundos) = 0 then return null; end if;
  insert into public.partidas_solo (usuario, canciones, segundos, videos, genero, modo, dia, duelo)
    values (p_usuario, p.canciones, v_segundos, p.videos, p.genero, p.modo, p.dia, p.duelo)
    on conflict (usuario, dia) where dia is not null do nothing
    returning puntos into v_puntos;
  if v_puntos is null then return null; end if;
  update public.partidas_en_curso set guardada = true where id = p_partida;
  return v_puntos;
end $$;

-- ===================== DUELOS: FUNCIONES =====================
-- Arma un duelo con la partida p_partida (terminada hace menos de 6 horas) y
-- anota el resultado del que la jugó. p_inicios: desde qué segundo sonó cada
-- canción. Si la partida ya era de un duelo, devuelve ese mismo: el link que se
-- pasa es siempre el del duelo original. Devuelve el id, o null si no se puede.
create or replace function public.duelo_crear(
  p_partida uuid, p_inicios smallint[], p_nombre text, p_usuario uuid)
returns text
language plpgsql set search_path = '' as $$
declare
  p public.partidas_en_curso;
  v_id text;
  v_n int;
  v_segundos smallint[];
  v_inicios smallint[];
begin
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found then return null; end if;
  if p.duelo is not null then return p.duelo; end if;
  if p.reto is not null then return p.reto; end if;
  if p.dia is not null then return null; end if;   -- el desafío del día ya es el mismo para todos
  v_n := cardinality(p.videos);
  if v_n < 3 or char_length(btrim(coalesce(p_nombre, ''))) not between 1 and 30 then return null; end if;
  v_segundos := p.segundos || array_fill(0::smallint, array[v_n - cardinality(p.segundos)]);
  select array_agg(least(greatest(coalesce(p_inicios[i], 60), 0), 3600)::smallint order by i)
    into v_inicios from generate_series(1, v_n) as i;
  delete from public.duelos where creado < now() - interval '180 days';
  v_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.duelos (id, canciones, modo, videos, inicios)
    values (v_id, p.canciones, p.modo, p.videos, v_inicios);
  insert into public.duelo_resultados (duelo, partida, usuario, nombre, segundos)
    values (v_id, p_partida, p_usuario, btrim(p_nombre), v_segundos);
  update public.partidas_en_curso set reto = v_id where id = p_partida;
  return v_id;
end $$;

-- Anota en su duelo el resultado de la partida p_partida. Las canciones que
-- no llegó a jugar cuentan como que no salieron. Se aceptan hasta 3 canciones
-- distintas de las del duelo (las que YouTube no le pasó). Con cuenta, un solo
-- resultado por duelo: vale el primero. Devuelve el id del duelo, o null.
create or replace function public.duelo_anotar(p_partida uuid, p_nombre text, p_usuario uuid) returns text
language plpgsql set search_path = '' as $$
declare
  p public.partidas_en_curso;
  d public.duelos;
  v_segundos smallint[];
  v_comunes int;
  v_n int;
begin
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found or p.duelo is null then return null; end if;
  select * into d from public.duelos where id = p.duelo;
  if not found then return null; end if;
  v_n := cardinality(p.videos);
  if v_n = 0 or v_n > cardinality(d.videos)
     or char_length(btrim(coalesce(p_nombre, ''))) not between 1 and 30 then
    return null;
  end if;
  select count(*) into v_comunes from unnest(p.videos) as v where v = any(d.videos);
  if v_comunes < v_n - 3 then return null; end if;
  v_segundos := p.segundos || array_fill(0::smallint, array[cardinality(d.videos) - cardinality(p.segundos)]);
  insert into public.duelo_resultados (duelo, partida, usuario, nombre, segundos)
    values (d.id, p_partida, p_usuario, btrim(p_nombre), v_segundos)
    on conflict do nothing;
  return d.id;
end $$;

-- ===================== RANKING =====================
-- El mejor puntaje de cada cuenta para esa cantidad de canciones. Trae los
-- primeros p_limite y, si p_usuario quedó más abajo, también su fila. A igual
-- puntaje queda antes el que lo hizo primero. No cuentan el desafío del día
-- (tiene su tabla), los duelos (las canciones ya se conocen) ni el modo artista.
--
-- p_periodo: 'semana' cuenta solo las partidas desde el viernes a las 0 h
-- (hora de Argentina), 'mes' desde el día 1 a las 0 h y 'siempre' todas. Un
-- período desconocido da la tabla vacía. isodow: lunes 1 … domingo 7, así que
-- se retroceden los días que pasaron desde el último viernes (0 si es hoy).
-- p_genero: solo las partidas jugadas con esa playlist sola.
-- p_liga: solo las cuentas de esa liga.
drop function if exists public.ranking_solo(smallint, int, text, uuid);
create or replace function public.ranking_solo(
  p_canciones smallint, p_limite int default 20, p_periodo text default 'siempre', p_usuario uuid default null,
  p_genero text default null, p_liga uuid default null)
returns table (puesto bigint, nombre text, puntos smallint, resueltas smallint, jugada timestamptz, es_mio boolean)
language sql stable set search_path = '' as $$
  with ahora as (
    select now() at time zone 'America/Argentina/Buenos_Aires' as t
  ), desde as (
    select case p_periodo
      when 'semana'  then (date_trunc('day', a.t) - ((extract(isodow from a.t)::int + 2) % 7) * interval '1 day') at time zone 'America/Argentina/Buenos_Aires'
      when 'mes'     then date_trunc('month', a.t) at time zone 'America/Argentina/Buenos_Aires'
      when 'siempre' then '-infinity'::timestamptz
    end as t
    from ahora a
  ), mejores as (
    select distinct on (p.usuario) p.usuario, p.puntos, p.resueltas, p.jugada
    from public.partidas_solo p
    where p.canciones = p_canciones and p.jugada >= (select t from desde)
      and p.dia is null and p.duelo is null and p.modo = 'titulo'
      and (p_genero is null or p.genero = p_genero)
      and (p_liga is null or exists (
            select 1 from public.liga_miembros m where m.liga = p_liga and m.usuario = p.usuario))
    order by p.usuario, p.puntos desc, p.jugada asc
  ), ordenado as (
    select row_number() over (order by m.puntos desc, m.jugada asc) as puesto,
           f.nombre, m.puntos, m.resueltas, m.jugada,
           m.usuario is not distinct from p_usuario as es_mio
    from mejores m join public.usuarios f on f.id = m.usuario
  )
  select * from ordenado
  where puesto <= least(greatest(p_limite, 1), 100) or es_mio
  order by puesto
$$;

-- El ranking del desafío de un día: una partida por cuenta. Misma forma que
-- ranking_solo, más los segundos de cada canción (para los cuadritos).
create or replace function public.ranking_desafio(
  p_dia date, p_limite int default 20, p_usuario uuid default null, p_liga uuid default null)
returns table (puesto bigint, nombre text, puntos smallint, resueltas smallint, jugada timestamptz, es_mio boolean, segundos smallint[])
language sql stable set search_path = '' as $$
  with ordenado as (
    select row_number() over (order by p.puntos desc, p.jugada asc) as puesto,
           f.nombre, p.puntos, p.resueltas, p.jugada,
           p.usuario is not distinct from p_usuario as es_mio, p.segundos
    from public.partidas_solo p join public.usuarios f on f.id = p.usuario
    where p.dia = p_dia
      and (p_liga is null or exists (
            select 1 from public.liga_miembros m where m.liga = p_liga and m.usuario = p.usuario))
  )
  select * from ordenado
  where puesto <= least(greatest(p_limite, 1), 100) or es_mio
  order by puesto
$$;

-- ===================== LIGAS: FUNCIONES =====================
-- Crea una liga y suma al que la creó. Hasta 10 ligas por cuenta. Devuelve el código.
create or replace function public.liga_crear(p_usuario uuid, p_nombre text) returns text
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
  v_codigo text;
begin
  if p_usuario is null or char_length(btrim(coalesce(p_nombre, ''))) not between 1 and 40 then return null; end if;
  if (select count(*) from public.liga_miembros m where m.usuario = p_usuario) >= 10 then return null; end if;
  for intento in 1..20 loop
    v_codigo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.ligas l where l.codigo = v_codigo);
    v_codigo := null;
  end loop;
  if v_codigo is null then return null; end if;
  insert into public.ligas (codigo, nombre, creador) values (v_codigo, btrim(p_nombre), p_usuario) returning id into v_id;
  insert into public.liga_miembros (liga, usuario) values (v_id, p_usuario);
  return v_codigo;
end $$;

-- Suma la cuenta a la liga de ese código. Hasta 10 ligas por cuenta y 200
-- cuentas por liga. Devuelve el id de la liga, o null si no se pudo.
create or replace function public.liga_unirse(p_usuario uuid, p_codigo text) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_usuario is null then return null; end if;
  select l.id into v_id from public.ligas l where l.codigo = upper(btrim(coalesce(p_codigo, ''))) for update;
  if v_id is null then return null; end if;
  if exists (select 1 from public.liga_miembros m where m.liga = v_id and m.usuario = p_usuario) then return v_id; end if;
  if (select count(*) from public.liga_miembros m where m.usuario = p_usuario) >= 10
     or (select count(*) from public.liga_miembros m where m.liga = v_id) >= 200 then
    return null;
  end if;
  insert into public.liga_miembros (liga, usuario) values (v_id, p_usuario) on conflict do nothing;
  return v_id;
end $$;

-- Saca la cuenta de la liga. Si era la última, la liga se borra.
create or replace function public.liga_salir(p_usuario uuid, p_liga uuid) returns boolean
language plpgsql set search_path = '' as $$
begin
  delete from public.liga_miembros m where m.liga = p_liga and m.usuario = p_usuario;
  if not found then return false; end if;
  delete from public.ligas l where l.id = p_liga
    and not exists (select 1 from public.liga_miembros m where m.liga = l.id);
  return true;
end $$;

-- ===================== SALAS: FUNCIONES =====================
-- Abre una sala para una partida con amigos. De paso borra las de hace más de
-- 12 horas. Devuelve { codigo, clave }.
create or replace function public.sala_crear(p_equipos text[]) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_codigo text;
  v_clave uuid;
begin
  delete from public.salas where creada < now() - interval '12 hours';
  if p_equipos is null or cardinality(p_equipos) not between 1 and 12 then return null; end if;
  for intento in 1..30 loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '')
      into v_codigo from generate_series(1, 4);
    exit when not exists (select 1 from public.salas s where s.codigo = v_codigo);
    v_codigo := null;
  end loop;
  if v_codigo is null then return null; end if;
  insert into public.salas (codigo, equipos) values (v_codigo, p_equipos) returning clave into v_clave;
  return jsonb_build_object('codigo', v_codigo, 'clave', v_clave);
end $$;

-- El que maneja la partida abre o cierra los pulsadores. Al abrir se olvida
-- quién había pulsado; al cerrar no (el que ganó lo sigue viendo en su
-- celular), salvo con p_limpiar, que es para cuando la canción ya terminó.
-- p_excluidos son los equipos que ya erraron esta canción y no pueden volver a
-- pulsar. p_equipos, si viene, actualiza los nombres.
drop function if exists public.sala_ronda(text, uuid, boolean, smallint[], text[]);
create or replace function public.sala_ronda(
  p_codigo text, p_clave uuid, p_abierta boolean,
  p_excluidos smallint[] default '{}', p_equipos text[] default null, p_limpiar boolean default false)
returns boolean
language plpgsql set search_path = '' as $$
begin
  update public.salas s set
      abierta = coalesce(p_abierta, false),
      primero = case when coalesce(p_abierta, false) or coalesce(p_limpiar, false) then null else s.primero end,
      pulso = case when coalesce(p_abierta, false) or coalesce(p_limpiar, false) then null else s.pulso end,
      excluidos = coalesce(p_excluidos, '{}'),
      ronda = s.ronda + (case when coalesce(p_abierta, false) then 1 else 0 end),
      equipos = case when p_equipos is not null and cardinality(p_equipos) between 1 and 12 then p_equipos else s.equipos end
    where s.codigo = p_codigo and s.clave = p_clave;
  return found;
end $$;

-- Un equipo tocó "¡YO!". Gana el primero que llega a la base. Devuelve
-- { estado, primero, equipos }: estado es 'primero' (ganó), 'tarde' (ya había
-- pulsado otro, aunque ya se haya cerrado), 'cerrada' (no hay canción
-- sonando), 'excluido' (ya erró esta) o 'no' (la sala o el equipo no existen).
create or replace function public.sala_pulsar(p_codigo text, p_equipo smallint) returns jsonb
language plpgsql set search_path = '' as $$
declare
  s public.salas;
  v_estado text;
begin
  select * into s from public.salas where codigo = p_codigo for update;
  if not found or p_equipo is null or p_equipo < 0 or p_equipo >= cardinality(s.equipos) then
    return jsonb_build_object('estado', 'no');
  end if;
  if not s.abierta then
    v_estado := case when s.primero = p_equipo then 'primero' when s.primero is not null then 'tarde' else 'cerrada' end;
  elsif p_equipo = any(s.excluidos) then
    v_estado := 'excluido';
  elsif s.primero is null then
    update public.salas set primero = p_equipo, pulso = now() where codigo = p_codigo;
    s.primero := p_equipo;
    v_estado := 'primero';
  else
    v_estado := case when s.primero = p_equipo then 'primero' else 'tarde' end;
  end if;
  return jsonb_build_object('estado', v_estado, 'primero', s.primero, 'equipos', to_jsonb(s.equipos));
end $$;
