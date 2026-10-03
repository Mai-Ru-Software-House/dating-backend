/*
 * ESLint configuration: TypeScript recommended rules plus the team rules from
 * docs/MaiRu_CodingStandards.md. Prettier has the final say on formatting.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["node_modules", "dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "no-magic-numbers": ["error", { ignore: [0, 1, -1], ignoreDefaultValues: true }],
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: { "no-magic-numbers": "off" },
  },
);
