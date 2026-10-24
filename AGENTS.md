# Repository Guidelines

## What this is

A no-build JavaScript (ES Modules, Node 18+) toolkit for querying Cosmos LCD/REST
and Tendermint/CometBFT RPC endpoints, parsing transactions and events, plus a
single-file browser explorer. Read [`README.md`](README.md) for usage,
[`docs/query-capabilities.md`](docs/query-capabilities.md) for the query
reference, and the engineering index in [`dev-docs/README.md`](dev-docs/README.md).

## Project map

| Area | Function | Docs | Running state |
|---|---|---|---|
| CLI/library (`src/*.js`) | Read-only query, parse, fee, and audit tools; most source files are both a module and a CLI | [`dev-docs/architecture.md`](dev-docs/architecture.md), module table in `README.md` | Not deployed; run locally |
| Explorer (`index.html`) | Browser query builder, network selection, results, JSON export | [`dev-docs/architecture.md`](dev-docs/architecture.md), [`dev-docs/data-model.md`](dev-docs/data-model.md) | Live on Vercel |
| Proxy (`api/proxy.js`) | Read-only CORS proxy, same code locally and in production | [`dev-docs/integration.md`](dev-docs/integration.md) | Live on Vercel |
| Dev server (`dev-server.js`) | Serves the explorer and mounts the proxy locally | [`dev-docs/architecture.md`](dev-docs/architecture.md) | Local only |
| Delivery (`vercel.json`, `.github/`) | Vercel static+function deploy from `main`; GitHub Actions test job | [`dev-docs/operations/running-state.md`](dev-docs/operations/running-state.md), [`docs/deployment.md`](docs/deployment.md) | Live: <https://the-queriooor.vercel.app> |

### How it fits together

The explorer runs entirely in the browser and sends read-only requests through
`/api/proxy` (same origin locally and on Vercel); the proxy validates the target
and path before forwarding to public Cosmos infrastructure. The CLI tools call
those endpoints directly from Node, never through the proxy. The explorer
refreshes its chain catalogue from `chains.cosmos.directory` and caches it for
24 hours. Pushing to `main` deploys production through the Vercel Git
integration.

## Where to work

- Query grammar, operators, or limits → `src/` plus
  [`docs/query-capabilities.md`](docs/query-capabilities.md).
- Explorer UI or endpoint selection → `index.html`, then
  [`dev-docs/architecture.md`](dev-docs/architecture.md).
- Proxy validation or allowed paths → `api/proxy.js` and
  `api/proxy.test.js`, then [`dev-docs/integration.md`](dev-docs/integration.md).
- Live verification values → [`docs/testing.md`](docs/testing.md).
- Release or rollback → [`docs/deployment.md`](docs/deployment.md); record a
  state change in [`dev-docs/operations/running-state.md`](dev-docs/operations/running-state.md).

## Build, test, development commands

- `yarn install` — installs declared dependencies (see `package.json`).
- `yarn test` — deterministic Node test runner suite (`node --test`).
- `yarn explorer` — serves the explorer + `/api/proxy` at `http://127.0.0.1:8420`.
- `yarn rpc-query -- --event transfer --attr recipient --value osmo1...` — RPC query.
- `node src/<tool>.js --help` — every CLI prints its own usage.

There is no compilation or bundling step. Validate browser changes by serving
the repo locally.

## Coding style

Modern JavaScript, ES modules, tabs, semicolons, single quotes. `camelCase`
functions/variables, `PascalCase` classes, kebab-case CLI filenames. Keep
endpoint access, parsing, and presentation separated. Preserve CLI help text and
useful error context when extending flags.

## Testing

The deterministic suite uses Node's built-in test runner; no coverage threshold.
Add deterministic fixtures for parsing logic instead of relying on live
services. Keep network-dependent checks bounded with small page sizes, and
follow the scenarios in [`docs/testing.md`](docs/testing.md).

## Commit & pull request guidelines

Concise imperative subjects ("Add SVG favicon"). Keep each commit focused. PRs
summarize behaviour changes, list commands or live scenarios run, link issues,
and include a screenshot for explorer UI changes. Call out endpoint assumptions
or operational risks.

## Security & configuration

Never commit API tokens, mnemonics, private keys, or captured sensitive
transactions. Tokens (e.g. `MINT_TOKEN` for the Mintscan audit) come from the
environment and must never be logged. Endpoint defaults are public nodes;
override with CLI flags (`--rpc`, `--lcd`) or `COSMOS_LCD`. Keep the toolkit
read-only: do not add wallet connection, signing, simulation, or broadcast paths
without explicit project-direction approval.

## Known hazards

Endpoint, proxy, and cross-surface parsing hazards are owned by
[`dev-docs/architecture.md`](dev-docs/architecture.md#known-hazards) and
[`dev-docs/integration.md`](dev-docs/integration.md). Query pitfalls (cross-event
`AND`, height scoping, LCD search availability) are owned by
[`docs/query-capabilities.md`](docs/query-capabilities.md).

## Documentation

Consult the relevant `dev-docs/` page before planning a change and update it
after verification, adding a dated entry to [`dev-docs/logs/`](dev-docs/logs/).
A behaviour change without the matching docs is not complete.
