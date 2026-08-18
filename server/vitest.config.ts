import { defineConfig } from "vitest/config";

// JSX settings come from tsconfig.json (jsx: react-jsx, jsxImportSource: @kitajs/html).
// Vitest 4 transforms with oxc and reads them from there — do not duplicate them here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
    },
  },
});
