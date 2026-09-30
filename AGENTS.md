# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm/Turborepo monorepo. `packages/` contains the core, models, engines,
PDFium bindings, and `plugin-*` features. Many packages keep framework adapters in
`src/react`, `src/preact`, `src/vue`, and `src/svelte` beside shared logic in
`src/lib` or `src/shared`. `viewers/` contains assembled viewers; `examples/`
contains runnable integrations. `website/` holds the docs and demo, with sample
PDFs, images, and WebAssembly assets in `website/public/`. Build configuration
lives in `config/` and package level Vite files.

## Build, Test, and Development Commands

- `pnpm install` installs workspace dependencies (use the pinned pnpm version in
  `package.json`).
- `pnpm build:packages` builds libraries in dependency order; `pnpm build` also
  builds viewers, examples, and the website.
- `pnpm build:watch` rebuilds changed packages during development.
- `pnpm --filter @embedpdf/example-react-mui dev` runs one example locally.
- `pnpm format:check` checks Prettier formatting. Run a package's `lint` script,
  for example `pnpm --filter @embedpdf/plugin-zoom lint`, for ESLint checks.

## Coding Style & Naming Conventions

Use TypeScript for package logic and follow nearby framework adapter patterns.
Prettier specifies two spaces, single quotes, semicolons, trailing commas, LF
line endings, and 100 character lines (80 for Markdown). ESLint checks
TypeScript formatting and warns about unordered imports and unused variables.
Use kebab case for feature file names, matching files such as
`zoom-gesture-logic.ts`. Format only touched files with
`pnpm exec prettier --write <path>`.

## Testing Guidelines

Put focused `*.test.ts` files beside source, as in
`packages/models/src/geometry.test.ts`. Root JavaScript regressions use
`tests/*.test.mjs`; run the current gesture suite with
`node --test tests/gesture-regressions.test.mjs`. There is no root `test` script
or coverage threshold. The existing model tests use Jest syntax, but the
current Jest invocation lacks a TypeScript transform; document the runner
setup and results if changing those tests. Add tests for new behavior and check
the affected example or framework adapter.

## Commit & Pull Request Guidelines

Use a short imperative commit subject. Recent history also uses scoped
prefixes such as `feat(plugin-selection):` and `fix(build):`; no strict format
is enforced. Keep PRs focused, explain behavior and verification, link relevant
issues, and add screenshots for UI changes. Update docs and tests when needed.
For publishable package changes, create a release note with `pnpm changeset`.
Keep `NPM_TOKEN` in the environment, never in committed files.
