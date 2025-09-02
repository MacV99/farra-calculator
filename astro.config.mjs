import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",   // sitio 100% estático
  // NO uses "base" en Netlify si estás en raíz del dominio
  // site: "https://tu-sitio.netlify.app" // (opcional)
});
