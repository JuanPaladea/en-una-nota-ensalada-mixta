-- En Supabase anon recibe permiso de ejecutar las funciones nuevas por defecto,
-- además del grant a public: guardar en el ranking pide cuenta.
revoke execute on function public.solo_terminar(uuid) from anon;
