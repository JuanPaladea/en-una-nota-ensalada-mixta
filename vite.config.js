import { defineConfig } from "vite";

export default defineConfig({
  // rutas relativas: el sitio funciona tanto en la raíz del dominio como en subcarpetas
  base: "./",
  build: {
    target: "es2018",
    outDir: "dist",
    // tres páginas: el juego, Cómo se juega (/como-se-juega/) y Privacidad (/privacidad/)
    rollupOptions: {
      input: {
        main: "index.html",
        "como-se-juega": "como-se-juega/index.html",
        privacidad: "privacidad/index.html",
      },
    },
  },
});
