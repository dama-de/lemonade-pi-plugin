// @ts-check

import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        ignores: ["node_modules", "dist", "coverage", "scripts"],
        rules: {
            // Allow unused variables with underscore prefix
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {argsIgnorePattern: "^_", varsIgnorePattern: "^_"},
            ],
            // Disallow unnecessary semicolons at end of statements
            semi: ["error", "never"],
        },
    },
)
