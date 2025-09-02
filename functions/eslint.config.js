import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

export default [
    
  js.configs.recommended,
  {






    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: ["tsconfig.json"],
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...importPlugin.configs.errors.rules,
      ...importPlugin.configs.warnings.rules,
      ...importPlugin.configs.typescript.rules,
      "import/no-unresolved": 0,
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      ...importPlugin.configs.errors.rules,
      ...importPlugin.configs.warnings.rules,
      "import/no-unresolved": 0,
    },
  },
  {
    ignores: ["/lib/**/*", "eslint.config.js"],
  },
];
