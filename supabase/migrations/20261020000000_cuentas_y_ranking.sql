-- Cuentas con Google y ranking del modo un jugador.
--
-- Cada cuenta tiene un perfil con el nombre que se muestra en el ranking (solo
-- nombre e inicial del apellido: el mail y la foto de Google no se guardan).
-- Cada partida guarda los segundos que hicieron falta en cada canción, y los
-- puntos los calcula la base con la misma tabla que el juego: el navegador no
-- manda un puntaje que haya que creerle.

-- ===================== PERFILES =====================
create table public.perfiles (
  id      uuid primary key references auth.users on delete cascade,
  nombre  text not null check (char_length(btrim(nombre)) between 1 and 30),
  creado  timestamptz not null default now()
);
alter table public.perfiles enable row level security;

-- Cada uno ve y renombra solo el suyo; los nombres ajenos salen por ranking_solo().
create policy "ver mi perfil" on public.perfiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "renombrar mi perfil" on public.perfiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
revoke insert, update, delete on public.perfiles from anon, authenticated;
grant update (nombre) on public.perfiles to authenticated;

-- "Juan Paladea" → "Juan P."; sin nombre en Google, la parte del mail antes de la @.
create function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  completo text := btrim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''));
  partes text[] := regexp_split_to_array(completo, '\s+');
  corto text;
begin
  if completo = '' then
    corto := split_part(coalesce(new.email, 'Jugador'), '@', 1);
  elsif cardinality(partes) > 1 then
    corto := partes[1] || ' ' || left(partes[cardinality(partes)], 1) || '.';
  else
    corto := partes[1];
  end if;
  insert into public.perfiles (id, nombre) values (new.id, left(corto, 30));
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();
revoke execute on function public.crear_perfil() from public, anon, authenticated;

-- ===================== PARTIDAS =====================
-- Misma tabla que PUNTOS_SOLO en src/main.js: 1 s → 10, 2 s → 7 … 6 s → 1, 0 = no salió.
create function public.puntos_solo(segundos smallint[]) returns smallint
language sql immutable set search_path = '' as $$
  select coalesce(sum((array[10,7,5,3,2,1])[s]), 0)::smallint
  from unnest(segundos) as s
$$;

create table public.partidas_solo (
  id         bigint generated always as identity primary key,
  usuario    uuid not null default auth.uid() references public.perfiles on delete cascade,
  canciones  smallint not null check (canciones in (0, 5, 10, 15, 20, 30)),  -- 0 = sin límite
  segundos   smallint[] not null check (
               cardinality(segundos) between 1 and 600
               and 0 <= all(segundos) and 6 >= all(segundos)),
  resueltas  smallint generated always as (cardinality(segundos)) stored,
  puntos     smallint generated always as (public.puntos_solo(segundos)) stored,
  jugada     timestamptz not null default now(),
  check (canciones = 0 or cardinality(segundos) <= canciones)
);
create index partidas_solo_ranking on public.partidas_solo (canciones, usuario, puntos desc);
create index partidas_solo_mias on public.partidas_solo (usuario, jugada desc);
alter table public.partidas_solo enable row level security;

-- Se cargan y se leen solo las propias (el historial); nada se edita ni se borra.
create policy "guardar mis partidas" on public.partidas_solo
  for insert to authenticated with check ((select auth.uid()) = usuario);
create policy "ver mis partidas" on public.partidas_solo
  for select to authenticated using ((select auth.uid()) = usuario);
revoke update, delete on public.partidas_solo from anon, authenticated;

-- ===================== RANKING =====================
-- El mejor puntaje de cada cuenta para esa cantidad de canciones. Trae los
-- primeros p_limite y, si quien pregunta quedó más abajo, también su fila.
-- A igual puntaje queda antes el que lo hizo primero.
create function public.ranking_solo(p_canciones smallint, p_limite int default 20)
returns table (puesto bigint, nombre text, puntos smallint, resueltas smallint, jugada timestamptz, es_mio boolean)
language sql stable security definer set search_path = '' as $$
  with mejores as (
    select distinct on (p.usuario) p.usuario, p.puntos, p.resueltas, p.jugada
    from public.partidas_solo p
    where p.canciones = p_canciones
    order by p.usuario, p.puntos desc, p.jugada asc
  ), ordenado as (
    select row_number() over (order by m.puntos desc, m.jugada asc) as puesto,
           f.nombre, m.puntos, m.resueltas, m.jugada,
           m.usuario is not distinct from (select auth.uid()) as es_mio
    from mejores m join public.perfiles f on f.id = m.usuario
  )
  select * from ordenado
  where puesto <= least(greatest(p_limite, 1), 100) or es_mio
  order by puesto
$$;
revoke execute on function public.ranking_solo(smallint, int) from public;
grant execute on function public.ranking_solo(smallint, int) to anon, authenticated;
