import { defineConfig } from "vite";

export default defineConfig({
  // rutas relativas: el sitio funciona tanto en la raíz del dominio como en subcarpetas
  base: "./",
  build: {
    target: "es2018",
    outDir: "dist",
  },
});
