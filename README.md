# 🎵 En una nota · Ensalada mixta

Juego local para cantar con amigos, inspirado en el clásico "en una nota".
Suena una canción **tapada** (nadie sabe cuál es), en algún momento se **corta**, y
el equipo que grita **"¡YO!"** primero tiene que seguir cantando **la que sigue**.
Después se **revela** la canción y el grupo decide si la pegó.

> Demo en vivo: <https://en-una-nota-ensalada-mixta.netlify.app>

## ✨ Características

- **Tres secciones**: **Jugar** (inicio, armar partida, partida y resultado), **Ranking** y **Mi cuenta**.
  En el celular van en una barra fija abajo, que se esconde al armar la partida, durante el juego y en
  el resultado; en la compu van arriba, al lado del logo, y las pantallas usan dos columnas (géneros y
  opciones, podio y tu puesto, perfil y preferencias). Con amigos en una pantalla ancha, el marcador va
  en una columna al costado.
- **Inicio**: se elige con amigos o un jugador, **repetir la última** arma la partida anterior en un toque
  (mismos géneros, modo y cantidad) y se ve tu récord con tu puesto en el ranking.
- Letras **Baloo 2** (títulos) y **Nunito** (texto), servidas desde el sitio con `@fontsource-variable`.

- **16 playlists** con +500 canciones precargadas (Rock Nacional, Cumbia y Cuarteto,
  Pop/Reggaetón, Internacional, Clásicos, Disney, Fiesta, Rock en Español, Trap/Urbano,
  Baladas, Folklore, Infantiles, Pop Nacional, Boy Bands y Pop 2000s, Cachengue y RKT y
  K-Pop). Se pueden combinar géneros.
- Reproductor **oculto**: la canción suena pero no se ve el título hasta revelarla.
- **Cortar / revelar** con control preciso (pausa y reanuda en el segundo exacto).
- Al revelar se muestra la **imagen de la canción** (miniatura del video) debajo del título,
  más un fondo difuminado con la misma imagen. Si no se puede cargar, queda solo el texto.
- Los **nombres de los equipos se recuerdan**: sobreviven a la revancha, al volver al menú
  principal y a recargar la página (los puntos siempre arrancan en cero).
- Puntaje flexible: a **un equipo**, a **todos** o a **nadie** (saltear).
- **Modo un jugador**: en vez de equipos, se escribe el título con autocompletado (todo el catálogo,
  sin importar acentos ni signos) y el juego lo comprueba. Cada intento repite desde el mismo
  punto un segundo más largo (1 s, 2 s… hasta 6) y vale 10, 7, 5, 3, 2 o 1 punto; errar cuenta
  como un intento. Se guarda el récord por cantidad de canciones y la imagen final muestra un
  cuadrito por canción (🟩 1 s, 🟨 2–3 s, 🟧 4–6 s, ⬛ no salió), que también va en el texto al
  compartir. El modo elegido se recuerda.
- **Cuentas con Google y ranking** (opcional, con Supabase): entrando con Google, cada partida de un
  jugador se guarda en la cuenta (historial) y el mejor puntaje de cada uno entra a un **ranking por
  cantidad de canciones** (5, 10, 15, 20, 30 y sin límite), que se mira **semanal** (arranca cada
  lunes), **mensual** (cada día 1) o **histórico**. El ranking es **verificado**: la partida
  se va anotando en la base mientras se juega y la base comprueba cada paso (que el video sea del
  catálogo, que el título acertado sea el suyo y que haya pasado el tiempo de los fragmentos que
  sonaron); los puntos los calcula ella, no el navegador. Las partidas con canciones propias no
  entran. Si se entra desde la pantalla final, esa partida se guarda al volver de Google. En el ranking sale un nombre corto ("Juan P.") que se cambia en Mi cuenta;
  el mail y la foto no se muestran. supabase-js se baja recién cuando hace falta. Sin configurar,
  el juego queda igual que antes.
- **Cantidad de canciones por partida** configurable; al agotarse la playlist, termina.
- **No se repiten entre partidas**: las canciones que ya sonaron se guardan localmente y se
  evitan en partidas siguientes hasta agotar la playlist elegida (se puede reiniciar el
  historial manualmente).
- **Tus propios audios**: cargá MP3/M4A desde tu compu (se guardan con IndexedDB y
  funcionan **sin internet**), ideal para jugar sin depender de YouTube.
- Al terminar, **imagen del resultado para compartir**: se dibuja en un canvas con el
  marcador y los nombres de los equipos, se muestra ya armada en la pantalla final
  (tocarla la comparte) y se manda con la Web Share API. Si el navegador
  no comparte archivos, se descarga y se copia el link.
- **Compartir** con la Web Share API (y copia del link como respaldo).
- **Cafecito**: el pedido aparece en la pantalla final desde la primera partida
  terminada en ese navegador, contando cuántas partidas y canciones llevan (se guarda en
  localStorage). Además hay una tarjeta en el inicio y en Mi cuenta que explica para qué es (playlists nuevas, dominio y hosting, cero anuncios). Se miden las veces que se
  muestra el pedido final (`cafecito_visto`) y los clics (`cafecito`, con `desde`: `final`, `inicio` o `cuenta`).
- La canción se **precarga apenas se sortea** (muteada y tapada), así "Reproducir 1 segundo"
  suena al instante en vez de esperar a que bufferee.
- Página aparte **Cómo se juega** (`/como-se-juega/`, con un botón desde el inicio y desde Mi cuenta),
  con la misma barra de secciones que el juego (y lo mismo **Privacidad**): las
  reglas a la vista y las preguntas frecuentes plegadas, con datos estructurados `FAQPage`;
  imagen de OpenGraph en **PNG** (WhatsApp y Facebook no muestran previews en SVG) y
  `manifest.webmanifest` para instalarla desde el celular.
- **Comentarios**: formulario en Mi cuenta → Ayuda (comentario + nombre y mail opcionales) que llega por
  **Netlify Forms** al mail configurado. Se manda sin recargar la página; si el envío falla
  (por ejemplo con `npm run dev`, donde no hay Netlify) ofrece mandar el mismo texto por mail.
- Responsive (pensado también para celular).

## 🚀 Desarrollo

Requiere [Node.js](https://nodejs.org) 18+.

```bash
npm install     # instala dependencias
npm run dev     # servidor de desarrollo (http://localhost:5173)
npm run build   # genera la versión de producción en dist/
npm run preview # sirve el build de dist/ para probarlo
```

> **Importante:** el juego usa el reproductor de YouTube, que **solo funciona servido
> por http(s)** (con `npm run dev`, `npm run preview` o ya deployado). Abrir el HTML
> como archivo (`file://`) bloquea los videos de YouTube; en ese caso usá la playlist
> **"🎵 Mis canciones"** (tus audios locales), que anda igual sin internet.

## 📁 Estructura

```
├── index.html          # markup, SEO (metadatos + JSON-LD) y contenedores de la app
├── como-se-juega/
│   └── index.html      # página de Cómo se juega + preguntas frecuentes (FAQPage)
├── public/
│   ├── favicon.svg      # ícono
│   ├── icon-192.png     # íconos del manifest (generados desde favicon.svg)
│   ├── icon-512.png
│   ├── og.svg           # fuente de la imagen para redes
│   ├── og.png           # imagen para redes (la que leen WhatsApp/Facebook/X)
│   ├── manifest.webmanifest
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── main.js          # estado, lógica de juego, render y arranque
│   ├── data.js          # las playlists (título, artista, id de YouTube)
│   ├── sharecard.js     # dibuja y comparte la imagen del resultado
│   ├── cuenta.js        # cuentas con Google, partidas guardadas y ranking (Supabase)
│   ├── share.js         # compartir el link del juego (lo usan las dos páginas)
│   ├── como-se-juega.js # arranque de la página de Cómo se juega
│   ├── utils.js         # helpers puros (localStorage, escape, parseo de links)
│   ├── idb.js           # persistencia de audios en IndexedDB
│   └── styles.css       # estilos
├── supabase/
│   ├── migrations/      # tablas, reglas de acceso y ranking de la base
│   └── catalogo_solo.sql # catálogo contra el que la base verifica las partidas (generado)
├── scripts/
│   └── catalogo-solo.mjs # genera catalogo_solo.sql desde src/data.js (npm run catalogo)
├── vite.config.js
└── netlify.toml         # build de Netlify (npm run build → dist/)
```

## 👤 Cuentas y ranking (Supabase)

1. Crear un proyecto en [supabase.com](https://supabase.com), aplicarle las migraciones de
   `supabase/migrations/` en orden (SQL Editor, o `supabase db push`) y después ejecutar
   `supabase/catalogo_solo.sql`.
2. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crear un
   **ID de cliente OAuth** (aplicación web) con URI de redireccionamiento autorizado
   `https://<proyecto>.supabase.co/auth/v1/callback`.
3. En Supabase, **Authentication → Sign In / Providers → Google**: activarlo y pegar el ID y el secreto.
4. **Authentication → URL Configuration**: Site URL `https://enunanota.com.ar` y en Redirect URLs
   `https://enunanota.com.ar/**`, `https://www.enunanota.com.ar/**`,
   `https://en-una-nota-ensalada-mixta.netlify.app/**` y `http://localhost:5173/**`.
5. Copiar la URL del proyecto y la clave publicable (Project Settings → API) en las constantes
   del principio de `src/cuenta.js`. Vacías, las cuentas quedan apagadas.

**Al agregar o cambiar canciones en `src/data.js`**: correr `npm run catalogo` y ejecutar el
`supabase/catalogo_solo.sql` que genera en el SQL Editor. Si no, las partidas en las que suene una
canción nueva se descartan del ranking.

## 🌐 Deploy

Configurado para Netlify: `netlify.toml` corre `npm run build` y publica `dist/`.
Sirve como cualquier sitio estático (también en GitHub Pages, Vercel, etc.).

Los comentarios usan **Netlify Forms**: Netlify detecta el `<form data-netlify="true">` en
el HTML publicado. Para que lleguen al mail hay que activarlo una sola vez en el panel:
**Forms → Notifications → Email notification** apuntando a la casilla que corresponda.

## 📝 Notas

La app **no aloja música**: reproduce videos de YouTube que ya existen, o los archivos
de audio que cada persona carga en su propio navegador. Los links y audios quedan
guardados **solo localmente** (localStorage / IndexedDB).

## Licencia

[MIT](LICENSE)
