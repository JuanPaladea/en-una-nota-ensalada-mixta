-- Géneros favoritos en el perfil.
--
-- Ya no se usa: los favoritos salen de las partidas jugadas (src/favoritos.js).
-- Queda la columna, vacía, hasta borrarla con una migración nueva.
--
-- Los ids de los géneros de src/data.js ("rock", "cumbia"…) que la persona
-- marcó en Mi cuenta. Al armar una partida se eligen con un toque. Se guardan
-- en la cuenta para tenerlos en cualquier dispositivo; sin cuenta quedan solo
-- en el navegador. La base no conoce la lista de géneros: un id que ya no
-- existe lo ignora el juego.
alter table public.perfiles add column generos text[] not null default '{}' check (
  cardinality(generos) <= 30
  and array_position(generos, null) is null
  and array_to_string(generos, ',') ~ '^([a-z0-9-]{1,20}(,[a-z0-9-]{1,20})*)?$'
);

-- Igual que el nombre: cada uno cambia solo los suyos (la regla "renombrar mi perfil").
grant update (nombre, generos) on public.perfiles to authenticated;
