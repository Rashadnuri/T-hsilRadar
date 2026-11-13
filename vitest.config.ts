import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts", "supabase/tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Database suites each create their own throw-away database; run files one at a time.
    fileParallelism: false },
});
