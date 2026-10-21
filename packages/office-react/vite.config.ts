import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  base: "./",
  envDir: false,
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    reportCompressedSize: false,
    rolldownOptions: {
      input:
        mode === "artifact"
          ? ["frame.html", "artifact.html", "trace.html", "bootstrap.html", "bootstrap-frame.html"]
          : "frame.html",
    },
  },
}));
