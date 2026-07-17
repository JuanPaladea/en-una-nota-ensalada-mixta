# 🎵 En una nota · Ensalada mixta

Juego local para cantar con amigos, inspirado en el clásico "en una nota".
Suena una canción **tapada** (nadie sabe cuál es), en algún momento se **corta**, y
el equipo que grita **"¡YO!"** primero tiene que seguir cantando **la que sigue**.
Después se **revela** la canción y el grupo decide si la pegó.

> Demo en vivo: <https://en-una-nota-ensalada-mixta.netlify.app>

## ✨ Características

- **11 playlists** con +350 canciones precargadas (Rock Nacional, Cumbia y Cuarteto,
  Pop/Reggaetón, Internacional, Clásicos, Disney, Fiesta, Rock en Español, Trap/Urbano,
  Baladas y Folklore). Se pueden combinar géneros.
- Reproductor **oculto**: la canción suena pero no se ve el título hasta revelarla.
- **Cortar / revelar** con control preciso (pausa y reanuda en el segundo exacto).
- Puntaje flexible: a **un equipo**, a **todos** o a **nadie** (saltear).
- **Cantidad de canciones por partida** configurable; al agotarse la playlist, termina.
- **No se repiten entre partidas**: las canciones que ya sonaron se guardan localmente y se
  evitan en partidas siguientes hasta agotar la playlist elegida (se puede reiniciar el
  historial manualmente).
- **Tus propios audios**: cargá MP3/M4A desde tu compu (se guardan con IndexedDB y
  funcionan **sin internet**), ideal para jugar sin depender de YouTube.
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
├── index.html          # markup y contenedores de la app
├── public/
│   └── favicon.svg      # ícono
├── src/
│   ├── main.js          # estado, lógica de juego, render y arranque
│   ├── data.js          # las playlists (título, artista, id de YouTube)
│   ├── utils.js         # helpers puros (localStorage, escape, parseo de links)
│   ├── idb.js           # persistencia de audios en IndexedDB
│   └── styles.css       # estilos
├── vite.config.js
└── netlify.toml         # build de Netlify (npm run build → dist/)
```

## 🌐 Deploy

Configurado para Netlify: `netlify.toml` corre `npm run build` y publica `dist/`.
Sirve como cualquier sitio estático (también en GitHub Pages, Vercel, etc.).

## 📝 Notas

La app **no aloja música**: reproduce videos de YouTube que ya existen, o los archivos
de audio que cada persona carga en su propio navegador. Los links y audios quedan
guardados **solo localmente** (localStorage / IndexedDB).

## Licencia

[MIT](LICENSE)
