/*
 * ESLint configuration for the static analysis lab (quality_assessment/). It adds the strict and
 * stylistic type-checked rule sets of typescript-eslint on top of the normal team config. CI keeps
 * using eslint.config.js, so this stricter run does not block pull requests. Run it with
 * `bun run lint:quality`.
 */
import tseslint from "typescript-eslint";

import baseConfig from "./eslint.config.js";

export default tseslint.config(
  ...baseConfig,
  { ignores: ["prisma.config.ts", "eslint.config.js", "eslint.quality.config.js"] },
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
