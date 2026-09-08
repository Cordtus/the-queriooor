# Repository Guidelines

## Project Structure & Module Organization

This is a flat, no-build JavaScript toolkit for querying and parsing Cosmos transactions. Root-level `*.js` files are focused CLI tools: `rpc-event-query.js` handles Tendermint RPC searches, `cosmos-event-parser.js` handles LCD queries, and `query-txs.js` and `find-address-txs.js` scan blocks. `index.html` is the standalone browser explorer, `api/proxy.js` is its CORS proxy, and `dev-server.js` is the local server that serves the explorer and reuses `api/proxy.js` so custom endpoints work in-browser without a Vercel deploy. Deployment settings live in `vercel.json`; manual verification scenarios live in `TESTING.md`.

## Build, Test, and Development Commands

- `yarn install` verifies the lockfile and installs any declared dependencies.
- `yarn explorer` serves the explorer and its `/api/proxy` at `http://127.0.0.1:8420` via `node dev-server.js` (replaces the old python http.server, which had no proxy).
- `yarn test` runs the deterministic Node test suite, including `api/proxy.test.js`.
- `yarn test:live` runs the parser's network-dependent smoke/demo flow.
- `yarn rpc-query -- --event transfer --attr recipient --value osmo1...` exercises an RPC query.
- `node mintscan-distributions.js --help` documents the Mintscan audit CLI.

There is no compilation or bundling step. Validate browser changes by serving the repository locally.

## Coding Style & Naming Conventions

Use modern JavaScript and ES modules, Node 18+ native APIs, tabs for indentation, semicolons, and single-quoted strings. Follow existing names: `camelCase` for functions and variables, `PascalCase` for classes, and descriptive kebab-case CLI filenames. Keep endpoint access, parsing, and presentation logic separated. Preserve CLI help text and useful error context when extending flags.

## Testing Guidelines

The deterministic suite uses Node's built-in test runner; no coverage threshold is configured. Follow the live Osmosis scenarios in `TESTING.md`, including JSON output, pagination, decoded event attributes, and explorer rendering. Keep network-dependent checks bounded with small page sizes. For pure parsing logic, add deterministic fixtures and tests rather than relying only on live services.

## Commit & Pull Request Guidelines

Recent commits use concise imperative subjects such as `Add SVG favicon` and `Expand query builder...`. Keep each commit focused. Pull requests should summarize behavior changes, list commands or live scenarios run, link relevant issues, and include screenshots for explorer UI changes. Call out endpoint assumptions or operational risks.

## Security & Configuration

Never commit API tokens, mnemonics, private keys, or captured sensitive transactions. Supply credentials such as `MINT_TOKEN` through the environment, and avoid logging them. Keep the toolkit read-only: do not add wallet connection, signing, simulation, or broadcast paths without explicit project-direction approval.
