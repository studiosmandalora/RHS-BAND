import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // html5-qrcode pulls in a fairly large bundle; keep the QR scanner out of the
    // initial chunk so the app shell loads fast on phones.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("html5-qrcode") || id.includes("qrcode.react")) {
            return "qr";
          }
        },
      },
    },
  },
});