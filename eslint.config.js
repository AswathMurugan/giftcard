import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/** Helpers that already ship in @/lib/runtime + @/lib/field-format — never re-implement. */
const CANONICAL_HELPERS =
  'asText|asNumber|coerceBool|formatPhone|formatSsn|maskSsn|formatEin|formatUsd|' +
  'sanitizeMoney|formatDate|formatDateTime|parseDateOnly|toDateOnlyString|isValidEmail|formatAddress|' +
  'escapeCelString|celString'

/** Spacing utilities must use 4-pt tokens (gap-3), never brackets (gap-[0.75rem]). */
const SPACING_BRACKET = /\b(gap(-[xy])?|space-[xy]|p[xytrbl]?|m[xytrbl]?)-\[[0-9.]+(rem|px)\]/
const HEX_IN_CLASS = /-\[#[0-9a-fA-F]{3,8}\]/

export default defineConfig([
  globalIgnores([
    'dist',
    'tmp',
    // Starter-owned scaffolding pages — dev/demo code, never agent-authored.
    // Linting them would gate every agent turn on pre-existing foreign noise.
    'src/pages/error-boundary-demo',
    'src/pages/getting-started',
    'src/pages/log-viewer',
    'src/pages/review',
    'src/pages/showcase',
    'src/pages/test-results',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Honour the `_` prefix the codebase already uses to mark a binding as a
      // deliberate discard. Most sites are the `{ key: _omit, ...rest }`
      // destructuring-omit idiom, where naming the binding IS the mechanism —
      // it cannot be deleted, so without this the rule reports code that is
      // already correct.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Import conventions — everywhere except the shadcn wrappers themselves.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'radix-ui',
              message:
                "Direct Radix import — use the shadcn wrapper from '@/components/ui/*' (e.g. Dialog from '@/components/ui/dialog').",
            },
          ],
          patterns: [
            {
              group: ['@radix-ui/*', '@radix-ui/**', 'radix-ui/*', 'radix-ui/**'],
              message:
                "Direct Radix import — use the shadcn wrapper from '@/components/ui/*' (e.g. Dialog from '@/components/ui/dialog').",
            },
            {
              group: ['..', '../*', '../**', '../../*', '../../**', '../../../*', '../../../**'],
              message: "Relative parent import — use the '@/' alias (@/ maps to src/).",
            },
          ],
        },
      ],
    },
  },
  {
    // PrivateApp is a route manifest (ROUTES array + lazy page consts) —
    // the fast-refresh single-export rule can't apply to it by design.
    files: ['src/PrivateApp.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Design-token + helper-duplication guardrails for the agent-writable area.
    files: ['src/pages/**/*.{ts,tsx}', 'src/PrivateApp.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${SPACING_BRACKET}]`,
          message:
            'Arbitrary spacing bracket — use a 4-pt Tailwind token (gap-[0.75rem] → gap-3) per DESIGN.md.',
        },
        {
          selector: `TemplateElement[value.raw=${SPACING_BRACKET}]`,
          message:
            'Arbitrary spacing bracket — use a 4-pt Tailwind token (gap-[0.75rem] → gap-3) per DESIGN.md.',
        },
        {
          selector: `Literal[value=${HEX_IN_CLASS}]`,
          message:
            'Hard-coded color — use a design token class (bg-primary, text-muted-foreground, …) per DESIGN.md.',
        },
        {
          selector: `TemplateElement[value.raw=${HEX_IN_CLASS}]`,
          message:
            'Hard-coded color — use a design token class (bg-primary, text-muted-foreground, …) per DESIGN.md.',
        },
        {
          selector:
            'Property[key.name=/^(color|background|backgroundColor|borderColor|fill|stroke)$/] > Literal[value=/#[0-9a-fA-F]{3,8}/]',
          message:
            'Hard-coded color — use a design token class (bg-primary, text-muted-foreground, …) per DESIGN.md.',
        },
        {
          selector: `:matches(FunctionDeclaration, VariableDeclarator)[id.name=/^(${CANONICAL_HELPERS})$/]`,
          message:
            "This helper already exists — import it from '@/lib/field-format' (or '@/lib/runtime' for asText/asNumber/coerceBool, '@/lib/cel' for CEL escaping) instead of re-implementing.",
        },
        {
          selector: "CallExpression[callee.name='ilike']",
          message:
            'ilike() does not exist in CEL filters — use containsIgnoreCase(field, value) (case-insensitive, %/_ match literally).',
        },
        {
          selector:
            "CallExpression[callee.property.name='replace'] > Literal[value=/^''$/]",
          message:
            "SQL-style quote-doubling ('') is not CEL escaping (runtime PHX-ERR-400) — use celString/escapeCelString from '@/lib/cel'.",
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'Unsafe HTML injection — render Markdown with react-markdown + remark-gfm, or compose trusted content as React elements.',
        },
      ],
    },
  },
])
