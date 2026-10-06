import { defineConfig } from "vite";

export default defineConfig({
  // rutas relativas: el sitio funciona tanto en la raíz del dominio como en subcarpetas
  base: "./",
  build: {
    target: "es2018",
    outDir: "dist",
    // dos páginas: el juego y Cómo se juega (que se publica en /como-se-juega/)
    rollupOptions: {
      input: {
        main: "index.html",
        "como-se-juega": "como-se-juega/index.html",
      },
    },
  },
});
