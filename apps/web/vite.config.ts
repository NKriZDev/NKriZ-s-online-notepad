import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787", "/health": "http://127.0.0.1:8787" }
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          editor: ["@uiw/react-codemirror", "@codemirror/lang-markdown", "@codemirror/lang-javascript", "@codemirror/lang-json", "@codemirror/lang-python"],
          markdown: ["react-markdown", "remark-gfm"]
        }
      }
    }
  }
});
