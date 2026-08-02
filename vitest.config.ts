import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Teach Vitest the "@/" path alias that tsconfig.json declares. Without it a
// test (or a one-off verification script) cannot import anything that reaches
// `@/lib/db`, which rules out testing the server layer at all.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next resolves this marker package itself at build time and it is not
      // installed, so Vitest needs a stand-in to import any server lib at all.
      "server-only": fileURLToPath(
        new URL("./lib/__mocks__/server-only.ts", import.meta.url)
      ),
    },
  },
  test: {
    // Server libs import "server-only"; under Node that resolves to a harmless
    // no-op, but it must not be treated as browser code.
    environment: "node",
  },
});
