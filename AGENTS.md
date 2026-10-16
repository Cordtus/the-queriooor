# Repository Guidelines

## What this is

A flat, no-build JavaScript (ES Modules, Node 18+) toolkit for querying Cosmos
LCD/REST and Tendermint/CometBFT RPC endpoints, parsing transactions and events,
and exploring chains in a browser. Read the short orientation in `README.md`
first; the deep query reference (grammar, limits, verified behaviours, and when
to use which strategy) is `docs/query-capabilities.md`.

## Layout

- `src/*.js` — the CLI tools and importable modules. Every file is both: the
  class/function exports are the API, and an `import.meta.url === ...process.argv[1]`
  guard runs the CLI. Tests live next to their module as `*.test.js`.
- `index.html` — the single-file browser explorer (no build step).
- `api/proxy.js` — Vercel/serverless CORS proxy for the explorer, restricted to
  read-only Cosmos/Tendermint paths. Must stay at `api/` for Vercel routing.
- `dev-server.js` — local server that serves `index.html` and reuses
  `api/proxy.js`, so custom endpoints work in the browser without a deploy.
- `docs/testing.md` — bounded live-verification scenarios and known values.
- `docs/query-capabilities.md` — Cosmos/Tendermint query reference.

## Build, test, development commands

- `yarn install` — installs declared dependencies (see `package.json`).
- `yarn test` — deterministic Node test runner suite (`node --test`).
- `yarn test:live` — network-dependent smoke run of `src/cosmos-event-parser.js`.
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
follow the scenarios in `docs/testing.md`.

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

## Things that bite

- **Cross-event `AND` never matches.** Tendermint indexes `eventType.attr/value`
  keys, so `message.action='X' AND transfer.recipient='Y'` returns nothing.
  Intersect separate queries client-side instead — see `docs/query-capabilities.md`.
- **Osmosis LCD tx search is disabled.** Use RPC `/tx_search` (`src/rpc-event-query.js`)
  there; LCD event queries only work on chains that expose `/cosmos/tx/v1beta1/txs`.
- **Always scope broad queries with `tx.height`,** or they time out; max query
  length is 512 chars and `per_page` is capped at 100.
- **CometBFT < 0.38 base64-encodes event attributes.** Decode defensively
  (`RpcEventQuery.tryDecodeBase64Node`) rather than assuming plaintext.
- The proxy only allows read-only Cosmos/Tendermint paths and credential-free
  HTTPS; do not widen it into a general open proxy.
