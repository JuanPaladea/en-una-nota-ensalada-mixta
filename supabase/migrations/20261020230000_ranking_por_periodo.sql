-- Ranking semanal, mensual e histórico.
--
-- ranking_solo() suma p_periodo: 'semana' cuenta solo las partidas desde el
-- lunes a las 0 h, 'mes' desde el día 1 a las 0 h (hora de Argentina) y
-- 'siempre' todas, como hasta ahora. Es lo que pasa si no se manda, así que
-- las llamadas de antes siguen andando. Un período desconocido da la tabla vacía.

drop function public.ranking_solo(smallint, int);

create function public.ranking_solo(p_canciones smallint, p_limite int default 20, p_periodo text default 'siempre')
returns table (puesto bigint, nombre text, puntos smallint, resueltas smallint, jugada timestamptz, es_mio boolean)
language sql stable security definer set search_path = '' as $$
  with desde as (
    select case p_periodo
      when 'semana'  then date_trunc('week',  now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires'
      when 'mes'     then date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires'
      when 'siempre' then '-infinity'::timestamptz
    end as t
  ), mejores as (
    select distinct on (p.usuario) p.usuario, p.puntos, p.resueltas, p.jugada
    from public.partidas_solo p
    where p.canciones = p_canciones and p.jugada >= (select t from desde)
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
revoke execute on function public.ranking_solo(smallint, int, text) from public;
grant execute on function public.ranking_solo(smallint, int, text) to anon, authenticated;

-- Para la semana y el mes se buscan las partidas recientes de cada cantidad.
create index partidas_solo_periodo on public.partidas_solo (canciones, jugada);
