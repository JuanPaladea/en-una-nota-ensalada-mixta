-- El ranking semanal arranca el viernes.
--
-- Igual que antes, pero la semana de ranking_solo() va desde el viernes a las
-- 0 h (hora de Argentina) en vez del lunes. isodow: lunes 1 … domingo 7, así
-- que se retroceden los días que pasaron desde el último viernes (0 si es hoy).
-- El mes y el histórico no cambian.

create or replace function public.ranking_solo(p_canciones smallint, p_limite int default 20, p_periodo text default 'siempre')
returns table (puesto bigint, nombre text, puntos smallint, resueltas smallint, jugada timestamptz, es_mio boolean)
language sql stable security definer set search_path = '' as $$
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
           m.usuario is not distinct from (select auth.uid()) as es_mio
    from mejores m join public.perfiles f on f.id = m.usuario
  )
  select * from ordenado
  where puesto <= least(greatest(p_limite, 1), 100) or es_mio
  order by puesto
$$;
