import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "**/dist/**",
            "**/coverage/**",
            "**/node_modules/**",
            "**/routeTree.gen.ts",
            "**/.turbo/**",
            "**/.vite/**",
            "eslint.config.mjs",
            "prettier.config.mjs",
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
            "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
            "no-restricted-syntax": [
                "error",
                {
                    selector: "ImportDeclaration[source.value=/^\\./]",
                    message: "Use the workspace absolute import alias instead.",
                },
                {
                    selector: "ExportNamedDeclaration[source.value=/^\\./], ExportAllDeclaration[source.value=/^\\./]",
                    message: "Use the workspace absolute import alias instead.",
                },
            ],
        },
    },
    {
        files: ["apps/api/**/*.ts"],
        languageOptions: {
            globals: globals.node,
            parserOptions: { projectService: true },
        },
        rules: {
            "@typescript-eslint/no-extraneous-class": "off",
            "@typescript-eslint/unbound-method": "off",
        },
    },
    {
        files: ["apps/api/src/{modules,platform}/**/domain/**/*.ts", "apps/api/test/fixtures/domain/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "@nestjs/**",
                                "drizzle-orm",
                                "drizzle-orm/**",
                                "@kinetix/db",
                                "@kinetix/db/**",
                                "@kinetix/types",
                                "@kinetix/types/**",
                                "**/application/**",
                                "**/infrastructure/**",
                                "**/presentation/**",
                            ],
                            message: "Domain code must remain framework-free and depend only on domain primitives.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["apps/api/src/{modules,platform}/**/application/**/*.ts", "apps/api/test/fixtures/application/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: [
                                "@nestjs/**",
                                "drizzle-orm",
                                "drizzle-orm/**",
                                "@kinetix/db",
                                "@kinetix/db/**",
                                "@kinetix/types",
                                "@kinetix/types/**",
                                "**/infrastructure/**",
                                "**/presentation/**",
                            ],
                            message: "Application code may depend on domain and declared application ports only.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["apps/api/src/modules/*/infrastructure/**/*.ts", "apps/api/test/fixtures/infrastructure/**/*.ts"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            group: ["**/*/infrastructure/**", "@kinetix/db/schema/*"],
                            message:
                                "Infrastructure must not reach into another module or schema; use its public application interface.",
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ["apps/kin/**/*.ts", "packages/**/*.ts", "*.config.{js,mjs,ts}"],
        languageOptions: {
            globals: globals.node,
        },
    },
    {
        ...tseslint.configs.disableTypeChecked,
        files: ["**/*.test.ts", "**/test/**/*.ts", "packages/db/drizzle.config.ts"],
    },
    {
        files: ["apps/web/**/*.{ts,tsx}"],
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
        },
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": [
                "warn",
                {
                    allowConstantExport: true,
                    allowExportNames: ["Route", "buttonVariants"],
                },
            ],
        },
    },
    {
        files: ["apps/web/src/routes/**/*.tsx"],
        rules: {
            "react-refresh/only-export-components": "off",
        },
    },
    prettier,
);
