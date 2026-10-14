import { defineConfig } from "astro/config";

// Static output only: no adapter, no SSR, no functions. Moving host later is a
// config change, not a rewrite.
export default defineConfig({
  output: "static",
  build: { inlineStylesheets: "auto" },
});
