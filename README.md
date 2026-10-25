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

- **16 playlists** con +1000 canciones precargadas (Rock Nacional, Cumbia y Cuarteto,
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
- **Cuentas con Google y ranking** (opcional): entrando con Google, cada partida de un
  jugador se guarda en la cuenta (historial) y el mejor puntaje de cada uno entra a un **ranking por
  cantidad de canciones** (5, 10, 15, 20, 30 y sin límite), que se mira **semanal** (arranca cada
  viernes), **mensual** (cada día 1) o **histórico**. El ranking es **verificado**: la partida
  se va anotando en la base mientras se juega y la base comprueba cada paso (que el video sea del
  catálogo, que el título acertado sea el suyo y que haya pasado el tiempo de los fragmentos que
  sonaron); los puntos los calcula ella, no el navegador. Las partidas con canciones propias no
  entran. Si se entra desde la pantalla final, esa partida se guarda al volver de Google. En el ranking sale un nombre corto ("Ana G.") que se cambia en Mi cuenta;
  el mail y la foto no se muestran ni se guardan.
  En Mi cuenta salen tus **géneros favoritos**: los tres que más sonaron en tus partidas, con su
  porcentaje (`src/favoritos.js`). Con cuenta se cuentan los videos de tus partidas de Un jugador;
  sin cuenta, las canciones que sonaron en este navegador en los dos modos. Sin configurar,
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
│   ├── icon-maskable-512.png # el mismo dibujo con margen, para Android
│   ├── og.svg           # fuente de la imagen para redes
│   ├── og.png           # imagen para redes (la que leen WhatsApp/Facebook/X)
│   ├── manifest.webmanifest
│   ├── robots.txt
│   └── sitemap.xml
├── src/
│   ├── main.js          # estado, lógica de juego, render y arranque
│   ├── data.js          # las playlists (título, artista, id de YouTube)
│   ├── sharecard.js     # dibuja y comparte la imagen del resultado
│   ├── cuenta.js        # cuentas con Google, partidas guardadas y ranking (habla con /api)
│   ├── share.js         # compartir el link del juego (lo usan las dos páginas)
│   ├── como-se-juega.js # arranque de la página de Cómo se juega
│   ├── utils.js         # helpers puros (localStorage, escape, parseo de links)
│   ├── idb.js           # persistencia de audios en IndexedDB
│   └── styles.css       # estilos
├── netlify/functions/
│   └── api.mjs          # /api: verifica el token de Google, lleva la sesión y habla con la base
├── db/
│   ├── esquema.sql      # tablas y funciones de la base (Postgres en Neon)
│   └── catalogo_solo.sql # catálogo contra el que la base verifica las partidas (generado)
├── scripts/
│   ├── catalogo-solo.mjs # genera db/catalogo_solo.sql desde src/data.js (npm run catalogo)
│   └── db.mjs           # ejecuta un .sql contra la base (npm run db -- <archivo>)
├── vite.config.js
└── netlify.toml         # build de Netlify (npm run build → dist/)
```

## 👤 Cuentas y ranking

La base es Postgres en [Neon](https://neon.tech) y la API es una Netlify Function
(`netlify/functions/api.mjs`, en `/api/*`). El navegador nunca ve la clave de la base: la página
le manda a la función el token de Google, la función lo verifica, abre la sesión con una cookie
(`HttpOnly`, 30 días) y llama a las funciones SQL de `db/esquema.sql`, que son las que cuidan el
ranking.

1. Crear un proyecto en Neon (región **AWS São Paulo**) y copiar la cadena de conexión.
2. Copiar `.env.example` a `.env` y completar `DATABASE_URL` y `SESSION_SECRET`. Después crear
   las tablas y subir el catálogo:

   ```bash
   npm run db -- db/esquema.sql
   npm run catalogo:subir
   ```

3. En Netlify (Site configuration → Environment variables) cargar las mismas `DATABASE_URL` y
   `SESSION_SECRET`.
4. En [Google Cloud Console](https://console.cloud.google.com/apis/credentials), en el **ID de
   cliente OAuth** (aplicación web):
   - **Orígenes autorizados de JavaScript** (los pide el botón de Google, que entra sin salir de la
     página): `https://enunanota.com.ar`, `https://www.enunanota.com.ar`,
     `https://en-una-nota-ensalada-mixta.netlify.app`, `http://localhost` y `http://localhost:8888`.
   - **URI de redireccionamiento autorizados** (la redirección que queda de respaldo si el botón no
     carga): `https://enunanota.com.ar/api/auth/google-vuelta` y las mismas para `www.` y
     `netlify.app`.

   El ID de cliente es público y está en `src/cuenta.js` y en la función (`GOOGLE_CLIENT_ID`).

Para probarlo en local hace falta correr la función: `npx netlify dev` (con `npm run dev` solo,
las cuentas y el ranking no responden; el juego anda igual).

**Al agregar o cambiar canciones en `src/data.js`**: correr `npm run catalogo` y después
`npm run catalogo:subir`. Si no, las partidas en las que suene una canción nueva se descartan del
ranking.

## 📊 Medición (Google Analytics 4)

La medición está en `src/analytics.js` (ID de la propiedad al principio; vacío, se apaga). En
`localhost` no se manda nada: cada evento se ve en la consola como `[analytics] …`. Con
`?interno=1` un navegador queda marcado como tráfico interno.

| Evento | Cuándo | Parámetros |
|---|---|---|
| `seccion` | Se toca Jugar, Ranking o Mi cuenta | `seccion` |
| `armar_partida` | Se abre Armar partida | `modo_juego`, `desde` (inicio · ranking) |
| `modo_elegido` | Se cambia entre Con amigos y Un jugador | `modo_juego` |
| `repetir_ultima` | Se toca Repetir la última | `modo_juego`, `canciones_por_partida` |
| `partida_iniciada` | Arranca una partida | `modo_juego`, `generos`, `cantidad_generos`, `equipos`, `canciones_por_partida`, `resta_puntos`, `canciones_disponibles` |
| `cancion_sonada` | Suena por primera vez una canción | `modo` (corte · continuo), `modo_juego`, `numero`, `tipo` (youtube · propia) |
| `ronda_grupo` | Con amigos: se anota una canción | `resultado` (acierto · robo · erro · todos · algunos · ninguno · salteada), `segundos`, `sin_cortar`, `numero`, `equipos` |
| `solo_respuesta` | Un jugador: se resuelve una canción | `respuesta` (acierto · error · no_se), `segundos`, `errados`, `puntos`, `numero` |
| `partida_terminada` | Termina una partida | `modo_juego`, `motivo` (limit · agotada · manual), `canciones`, `equipos`, `puntos_ganador`, `duracion_seg` |
| `partida_abandonada` | Se cierra la pestaña en plena partida | `modo_juego`, `numero`, `canciones_por_partida`, `duracion_seg` |
| `record_nuevo` | Un jugador: récord del navegador | `puntos`, `anterior`, `canciones_por_partida` |
| `revancha` | Revancha / Jugar otra vez | `canciones`, `modo_juego` |
| `error_youtube` | Un video no se pudo reproducir | `momento`, `codigo`, `video`, `cancion` |
| `ranking_visto` | Se abre o se cambia el ranking | `canciones_por_partida`, `periodo`, `desde` (seccion · inicio · final · guardado · periodo · cantidad) |
| `partida_guardada` | La partida entra al ranking | `canciones_por_partida`, `puntos`, `puesto` |
| `partida_descartada` | La base no la acepta | `canciones_por_partida`, `por` (propias · base) |
| `invitacion_cuenta` | Al final, sin cuenta, se ofrece entrar | `desde`, `canciones_por_partida` |
| `cuenta` | Entrar, volver de Google, salir, renombrar | `accion` (entrar · entro · cancelo · salir · renombrar), `desde`, `detalle` |
| `login` | Entró con Google (evento recomendado de GA4) | `method` |
| `error_cuenta` | Falló algo de la cuenta o el ranking | `donde` (google · nombre · guardar · ranking · mis_partidas) |
| `mis_canciones` | Mis canciones | `accion` (abrir · cancion_agregada · cancion_quitada · link_pegado · link_borrado · audio_quitado), `desde`, `total` |
| `audio_propio_cargado` | Se cargan audios de la compu | `cantidad`, `fallidos`, `total` |
| `preferencia_cambiada` | Se cambia "Restar un punto" | `resta_puntos`, `desde` (setup · cuenta) |
| `historial_reiniciado` | Se reinicia el historial de sonadas | `canciones` |
| `compartir` | Link del juego o imagen del resultado | `que` (link · resultado), `desde`, `resultado`, `canciones`, `modo_juego` |
| `cafecito_visto` / `cafecito` | Pedido al final / clic en un botón | `partidas`, `canciones` / `desde`, `pantalla`, `partidas` |
| `comentario` | Se manda el formulario | `estado` (enviado · error) |

Propiedad de usuario: `con_cuenta` (si · no). Con sesión abierta va además el `user_id` (el ID interno
de la cuenta, nunca el nombre ni el mail), que junta en una persona lo que hace en
distintos dispositivos. Para verlo en los informes, en Administrar → Recopilación de datos →
Identidad para los informes usar "Combinada" u "Observada".

**Para que los parámetros aparezcan en los informes** hay que darlos de alta una vez en
Administrar → Definiciones personalizadas: como **dimensión de evento** `modo_juego`, `desde`,
`resultado`, `respuesta`, `accion`, `motivo`, `periodo`, `donde`, `tipo`, `que`, `seccion`
(y los que se quieran mirar); como **métrica** `segundos`, `puntos`, `duracion_seg`, `numero` y
`canciones`; y `con_cuenta` como **dimensión de usuario**. Los eventos se cuentan solos sin esto.

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
