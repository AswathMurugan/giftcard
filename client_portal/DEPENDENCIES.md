# Dependency Reference

This document explains why each direct package in `package.json` is installed.
Generated applications inherit these packages and the starter components that
use them.

## Version Policy

- Direct dependencies use exact versions so generated applications install a
  reproducible package set.
- `package-lock.json` locks the complete transitive dependency tree.
- Versions were checked against the npm registry on 2026-08-06.
- Upgrade related packages together and run typecheck, tests, and a production
  build before accepting a new version.

Current compatibility constraints:

- `pdfjs-dist` stays at `5.4.296` because `react-pdf@10.4.1` requires that exact
  version.
- `typescript` stays at `6.0.3` because `typescript-eslint@8.66.0` supports
  TypeScript versions below `6.1.0`.
- `@vitejs/plugin-react` stays at `5.2.0` because `6.0.5` currently has an npm
  peer-resolution conflict between Rolldown's optional Babel integration and
  the Babel 7 packages used by this project. Version `5.2.0` supports Vite 8.

## Application Dependencies

| Package | Use |
| --- | --- |
| `@base-ui/react` | Accessible primitives behind `Combobox` and `SearchableSelect`. |
| `@fontsource-variable/source-sans-3` | Bundles the Source Sans 3 variable font imported by `src/index.css`. |
| `@hookform/resolvers` | Connects Zod schemas to React Hook Form validation. |
| `@tailwindcss/vite` | Compiles Tailwind CSS through the Vite plugin. |
| `@tanstack/react-query` | Provides query caching, mutations, loading state, and invalidation for API hooks. |
| `ag-grid-community` | Supplies AG Grid core APIs, themes, types, and community modules. |
| `ag-grid-enterprise` | Supplies the licensed enterprise grid modules registered by the shared data table. |
| `ag-grid-react` | Renders AG Grid through React components. |
| `aws-amplify` | Implements Cognito authentication and token storage. |
| `axios` | Implements the shared HTTP client, interceptors, and upload progress types. |
| `class-variance-authority` | Defines typed visual variants for shared UI components. |
| `clsx` | Builds conditional class-name strings through the shared `cn` helper. |
| `cmdk` | Implements the Command component used by organization selectors. |
| `date-fns` | Formats dates in date-picker and generated page workflows. |
| `embla-carousel-react` | Implements the shared Carousel component. |
| `input-otp` | Implements the shared accessible one-time-password input. |
| `lucide-react` | Provides fallback React icons used by the shell, authentication, and UI components. |
| `next-themes` | Supplies theme state to the shared Sonner toaster wrapper. |
| `pdfjs-dist` | Supplies the PDF.js runtime and worker used by the document viewer. |
| `radix-ui` | Provides accessible primitives for dialogs, menus, popovers, tabs, and other shared components. |
| `react` | Provides the component and hook runtime. |
| `react-day-picker` | Implements the calendar used by the shared date picker. |
| `react-dom` | Mounts the React application and renders portals. |
| `react-hook-form` | Manages form state and validation in login and generated workflows. |
| `react-is` | Satisfies Recharts' React element inspection peer dependency. |
| `react-markdown` | Safely renders Markdown in generated pages and the shared agent chat. |
| `react-pdf` | Provides React document, page, and thumbnail components for PDF viewing. |
| `react-resizable-panels` | Implements the shared resizable panel component; v4 uses the `orientation` prop. |
| `react-router-dom` | Provides browser routing, navigation, layouts, and route matching. |
| `recharts` | Provides chart primitives used by the shared chart wrapper and generated dashboards. |
| `remark-gfm` | Adds tables, task lists, autolinks, and other GFM syntax to rendered Markdown. |
| `shadcn` | Supplies `shadcn/tailwind.css` and supports management of the checked-in UI primitives. |
| `sonner` | Displays global application and development error toasts. |
| `tailwind-merge` | Resolves conflicting Tailwind classes through the shared `cn` helper. |
| `tailwindcss` | Provides the utility CSS compiler and design-token processing. |
| `tw-animate-css` | Provides animation utilities used by shared UI components. |
| `uuid` | Generates request identifiers in the shared API client. The package includes its own TypeScript declarations. |
| `vaul` | Implements the shared Drawer component. |
| `zod` | Defines runtime validation schemas for forms and structured fields such as addresses. |

## Development Dependencies

| Package | Use |
| --- | --- |
| `@eslint/js` | Supplies ESLint's recommended JavaScript rules. |
| `@types/http-proxy` | Supplies TypeScript declarations for the Vite development proxy. |
| `@types/node` | Supplies Node.js types used by Vite configuration and code-generation scripts. |
| `@types/react` | Supplies React and JSX TypeScript declarations. |
| `@types/react-dom` | Supplies React DOM and portal TypeScript declarations. |
| `@vitejs/plugin-react` | Enables React transforms and Fast Refresh in Vite. |
| `eslint` | Runs static analysis through `npm run lint`. |
| `eslint-plugin-react-hooks` | Enforces React Hooks rules. |
| `eslint-plugin-react-refresh` | Checks exports for compatibility with Fast Refresh. |
| `globals` | Defines browser globals for ESLint's flat configuration. |
| `http-proxy` | Implements the custom API and WebSocket proxies in `vite.config.ts`. |
| `prettier` | Formats TypeScript and TSX source through `npm run format`. |
| `prettier-plugin-tailwindcss` | Sorts Tailwind utility classes during formatting. |
| `tsx` | Executes TypeScript code-generation scripts without a separate compile step. |
| `typescript` | Type-checks source and emits the project build. |
| `typescript-eslint` | Parses TypeScript and supplies its recommended ESLint rules. |
| `vite` | Runs the development server, builds production assets, and serves previews. |
| `vitest` | Runs unit tests and emits the test-results report. |

## Removed Packages

| Package | Reason |
| --- | --- |
| `@types/uuid` | Removed because `uuid` provides its own TypeScript declarations. |
