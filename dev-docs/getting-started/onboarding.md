# Getting started

## Prerequisites

- Node.js 18+ (CI uses Node 20).
- Yarn 1 for the lockfile workflow; npm works but is not exercised.

## Setup and commands

```bash
yarn install
yarn test          # node --test, no network access required
yarn explorer      # http://127.0.0.1:8420/ (static explorer + /api/proxy)
```

The full command list, including every CLI tool, is in
[`README.md`](../../README.md). There is no build or bundling step. Every
`src/*.js` file is both an importable module and a CLI; tests sit next to the
module as `*.test.js`.

## Repository layout

| Path | Purpose |
|---|---|
| `index.html` | Single-file browser explorer (no build step) |
| `api/proxy.js` | Vercel/serverless read-only CORS proxy, also used by the dev server |
| `dev-server.js` | Local static server that mounts the same proxy |
| `src/*.js` | CLI tools and importable modules |
| `docs/` | Product/operator docs: query capabilities, testing, deployment |
| `dev-docs/` | This engineering documentation |

Structure and relationships are in [../architecture.md](../architecture.md).

## First-change workflow

1. Read the dev-doc for the area you are touching (index:
   [../README.md](../README.md)); if none covers it, add a section as part of the
   change.
2. Read the relevant product doc: [`docs/query-capabilities.md`](../../docs/query-capabilities.md)
   for query grammar and limits, [`docs/testing.md`](../../docs/testing.md) for
   bounded live checks.
3. Make the change and add a deterministic test. Parsing logic gets fixtures;
   network checks stay bounded and follow `docs/testing.md`.
4. Run `yarn test` (and a browser check via `yarn explorer` for explorer UI).
5. Update the affected dev-docs and add a dated entry to
   [../logs/](../logs/), then report the doc impact.
6. For a release, follow [`docs/deployment.md`](../../docs/deployment.md).
   Pushing to `main` deploys production via the Vercel Git integration.

## Conventions

Tabs, semicolons, single quotes; `camelCase` functions, `PascalCase` classes,
kebab-case CLI filenames. Keep endpoint access, parsing, and presentation
separated. Keep the toolkit read-only: no wallet, signing, simulation, or
broadcast paths without explicit project-direction approval.
