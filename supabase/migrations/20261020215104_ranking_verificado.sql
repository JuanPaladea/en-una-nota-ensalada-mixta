-- Ranking verificado: la partida se anota en la base mientras se juega.
--
-- Antes el navegador mandaba al final los segundos de cada canción y había que
-- creerle. Ahora cada paso pasa por una función que lo comprueba: el video
-- tiene que ser del catálogo, el título acertado tiene que ser el suyo y tiene
-- que haber pasado al menos el tiempo de los fragmentos que sonaron. Si algo no
-- cierra, la partida se descarta. Sin cuenta se puede ir anotando (así, si
-- entra con Google desde la pantalla final, esa partida se guarda); pasarla al
-- ranking pide cuenta.

-- ===================== CATÁLOGO =====================
-- Las canciones de src/data.js: video de YouTube y título pasado por norm().
-- Se regenera con `npm run catalogo` (supabase/catalogo_solo.sql).
create table public.catalogo_solo (
  video   text not null check (video ~ '^[A-Za-z0-9_-]{11}$'),
  titulo  text not null,
  primary key (video, titulo)
);
alter table public.catalogo_solo enable row level security;
revoke all on public.catalogo_solo from anon, authenticated;   -- solo lo leen las funciones de abajo

-- ===================== PARTIDAS EN CURSO =====================
-- Sin dueño: la identifica el uuid, que solo conoce el navegador que la empezó.
-- videos: los que sonaron, en orden · segundos: con cuántos salió cada una ya
-- resuelta (0 = no salió) · sono_en: cuándo empezó a sonar la última ·
-- cambios: videos reemplazados porque YouTube no los pasó.
create table public.partidas_en_curso (
  id         uuid primary key default gen_random_uuid(),
  canciones  smallint not null check (canciones in (0, 5, 10, 15, 20, 30)),
  empezada   timestamptz not null default now(),
  videos     text[] not null default '{}',
  segundos   smallint[] not null default '{}',
  sono_en    timestamptz,
  cambios    smallint not null default 0
);
create index partidas_en_curso_empezada on public.partidas_en_curso (empezada);
alter table public.partidas_en_curso enable row level security;
revoke all on public.partidas_en_curso from anon, authenticated;

-- Las partidas guardadas recuerdan qué videos sonaron (null en las de antes).
alter table public.partidas_solo add column videos text[];

-- Ya no se cargan partidas a mano: solo entran por solo_terminar().
drop policy "guardar mis partidas" on public.partidas_solo;
revoke insert on public.partidas_solo from anon, authenticated;

-- Empieza una partida. De paso borra las abandonadas hace más de 6 horas.
create function public.solo_empezar(p_canciones smallint) returns uuid
language plpgsql security definer set search_path = '' as $$
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
create function public.solo_sonar(p_partida uuid, p_video text) returns boolean
language plpgsql security definer set search_path = '' as $$
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
create function public.solo_resolver(p_partida uuid, p_segundos smallint, p_titulo text) returns boolean
language plpgsql security definer set search_path = '' as $$
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

-- Pasa la partida a la cuenta de quien llama. La que sonó y no se resolvió
-- (terminó a mitad de canción) cuenta como que no salió. Devuelve los puntos.
create function public.solo_terminar(p_partida uuid) returns smallint
language plpgsql security definer set search_path = '' as $$
declare
  p public.partidas_en_curso;
  v_segundos smallint[];
  v_puntos smallint;
begin
  if auth.uid() is null then raise exception 'hace falta entrar con una cuenta'; end if;
  select * into p from public.partidas_en_curso where id = p_partida for update;
  if not found then return null; end if;
  delete from public.partidas_en_curso where id = p_partida;
  v_segundos := p.segundos || array_fill(0::smallint, array[cardinality(p.videos) - cardinality(p.segundos)]);
  if cardinality(v_segundos) = 0 then return null; end if;
  insert into public.partidas_solo (usuario, canciones, segundos, videos)
    values (auth.uid(), p.canciones, v_segundos, p.videos)
    returning puntos into v_puntos;
  return v_puntos;
end $$;

revoke execute on function public.solo_empezar(smallint), public.solo_sonar(uuid, text),
  public.solo_resolver(uuid, smallint, text), public.solo_terminar(uuid) from public;
grant execute on function public.solo_empezar(smallint), public.solo_sonar(uuid, text),
  public.solo_resolver(uuid, smallint, text) to anon, authenticated;
grant execute on function public.solo_terminar(uuid) to authenticated;
