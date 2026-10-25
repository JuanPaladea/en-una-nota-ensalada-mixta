-- Base de datos de las cuentas y el ranking del modo un jugador (Postgres en Neon).
--
-- Se puede volver a ejecutar sin romper nada: `npm run db -- db/esquema.sql`.
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
create index if not exists partidas_solo_ranking on public.partidas_solo (canciones, usuario, puntos desc);
create index if not exists partidas_solo_mias on public.partidas_solo (usuario, jugada desc);
-- Para la semana y el mes se buscan las partidas recientes de cada cantidad.
create index if not exists partidas_solo_periodo on public.partidas_solo (canciones, jugada);

-- ===================== CATÁLOGO =====================
-- Las canciones de src/data.js: video de YouTube y título pasado por norm().
-- Se regenera con `npm run catalogo` y se sube con `npm run catalogo:subir`.
create table if not exists public.catalogo_solo (
  video   text not null check (video ~ '^[A-Za-z0-9_-]{11}$'),
  titulo  text not null,
  primary key (video, titulo)
);

-- ===================== PARTIDAS EN CURSO =====================
-- La partida se va anotando en la base mientras se juega, con o sin cuenta.
-- Sin dueño: la identifica el uuid, que solo conoce el navegador que la empezó.
-- videos: los que sonaron, en orden · segundos: con cuántos salió cada una ya
-- resuelta (0 = no salió) · sono_en: cuándo empezó a sonar la última ·
-- cambios: videos reemplazados porque YouTube no los pasó.
create table if not exists public.partidas_en_curso (
  id         uuid primary key default gen_random_uuid(),
  canciones  smallint not null check (canciones in (0, 5, 10, 15, 20, 30)),
  empezada   timestamptz not null default now(),
  videos     text[] not null default '{}',
  segundos   smallint[] not null default '{}',
  sono_en    timestamptz,
  cambios    smallint not null default 0
);
create index if not exists partidas_en_curso_empezada on public.partidas_en_curso (empezada);

-- ===================== PASOS DE LA PARTIDA =====================
-- La base comprueba que el video sea del catálogo, que el título sea el suyo y
-- que haya pasado el tiempo de los fragmentos que sonaron. Si algo no cierra,
-- la partida se descarta.

-- Empieza una partida. De paso borra las abandonadas hace más de 6 horas.
create or replace function public.solo_empezar(p_canciones smallint) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  delete from public.partidas_en_curso where empezada < now() - interval '6 hours';
  insert into public.partidas_en_curso (canciones) values (p_canciones) returning id into v_id;
  return v_id;
end $$;

-- Empezó a sonar un video. Si la anterior todavía no se resolvió es un
-- reemplazo (YouTube no la pasó): se cambia, hasta 3 veces por partida.
-- Un video repetido, fuera del catálogo o de más descarta la partida.
create or replace function public.solo_sonar(p_partida uuid, p_video text) returns boolean
language plpgsql set search_path = '' as $$
declare
  p public.partidas_en_curso;
  n int;
begin
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found then return false; end if;
  n := cardinality(p.videos);
  if p_video = any(p.videos)
     or not exists (select 1 from public.catalogo_solo c where c.video = p_video) then
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

-- Se resolvió la canción que suena: con p_segundos (1 a 6) y el título
-- elegido, o 0 si no salió. Con s intentos sonaron 1 + 2 + … + s segundos;
-- se dan 2 de margen por la red.
create or replace function public.solo_resolver(p_partida uuid, p_segundos smallint, p_titulo text) returns boolean
language plpgsql set search_path = '' as $$
declare
  p public.partidas_en_curso;
  n int;
begin
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found then return false; end if;
  n := cardinality(p.videos);
  if n <> cardinality(p.segundos) + 1 or p_segundos is null or p_segundos not between 0 and 6
     or (p_segundos > 0 and (
       not exists (select 1 from public.catalogo_solo c where c.video = p.videos[n] and c.titulo = p_titulo)
       or now() - p.sono_en < make_interval(secs => p_segundos * (p_segundos + 1) / 2.0 - 2)
     )) then
    delete from public.partidas_en_curso where id = p_partida;
    return false;
  end if;
  update public.partidas_en_curso set segundos = p.segundos || p_segundos where id = p_partida;
  return true;
end $$;

-- Pasa la partida a la cuenta p_usuario. La que sonó y no se resolvió
-- (terminó a mitad de canción) cuenta como que no salió. Devuelve los puntos.
create or replace function public.solo_terminar(p_partida uuid, p_usuario uuid) returns smallint
language plpgsql set search_path = '' as $$
declare
  p public.partidas_en_curso;
  v_segundos smallint[];
  v_puntos smallint;
begin
  if p_usuario is null then raise exception 'hace falta entrar con una cuenta'; end if;
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found then return null; end if;
  delete from public.partidas_en_curso where id = p_partida;
  v_segundos := p.segundos || array_fill(0::smallint, array[cardinality(p.videos) - cardinality(p.segundos)]);
  if cardinality(v_segundos) = 0 then return null; end if;
  insert into public.partidas_solo (usuario, canciones, segundos, videos)
    values (p_usuario, p.canciones, v_segundos, p.videos)
    returning puntos into v_puntos;
  return v_puntos;
end $$;

-- ===================== RANKING =====================
-- El mejor puntaje de cada cuenta para esa cantidad de canciones. Trae los
-- primeros p_limite y, si p_usuario quedó más abajo, también su fila. A igual
-- puntaje queda antes el que lo hizo primero.
--
-- p_periodo: 'semana' cuenta solo las partidas desde el viernes a las 0 h
-- (hora de Argentina), 'mes' desde el día 1 a las 0 h y 'siempre' todas. Un
-- período desconocido da la tabla vacía. isodow: lunes 1 … domingo 7, así que
-- se retroceden los días que pasaron desde el último viernes (0 si es hoy).
create or replace function public.ranking_solo(
  p_canciones smallint, p_limite int default 20, p_periodo text default 'siempre', p_usuario uuid default null)
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
