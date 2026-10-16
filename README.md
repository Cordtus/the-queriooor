# the-queriooor

Cosmos/Tendermint query and transaction-parsing toolkit. Vanilla JavaScript (ES
Modules), no build step, Node 18+. Queries Cosmos LCD/REST and Tendermint/CometBFT
RPC endpoints for transaction data, parses events, filters transfers, totals
fees, and monitors whale activity — plus a browser-based explorer UI.

Everything is read-only: no wallet connection, signing, simulation, or broadcast.

## Quick start

```bash
yarn install

# Search transactions by event over RPC
yarn rpc-query -- --event transfer --attr recipient --value osmo1...

# Or query an LCD/REST endpoint
node src/cosmos-event-parser.js --lcd https://lcd.osmosis.zone osmo1...

# Serve the explorer at http://127.0.0.1:8420
yarn explorer
```

Run any CLI with `--help` for its options. Endpoint defaults are public nodes;
override with `--rpc` / `--lcd` or the `COSMOS_LCD` environment variable.

## Picking a retrieval method

Cosmos exposes two query layers. The right tool depends on what you're asking:

| Goal | Use | Tool |
|---|---|---|
| Find transactions by event attribute (bank, staking, IBC, wasm, swap…) | Tendermint RPC `/tx_search` | `src/rpc-event-query.js` |
| Same, but you only have an LCD/REST endpoint | Cosmos SDK `/cosmos/tx/v1beta1/txs` | `src/cosmos-event-parser.js` |
| Fee totals for a block / height range / time range | RPC `/block_results` fee events | `src/fees.js` |
| Every tx touching one address (no index assumption) | backward block scan | `src/query-txs.js`, `src/find-address-txs.js` |
| Account-centric history + per-tx classification | Mintscan account API | `src/mintscan-distributions.js` |
| Parse a JSON dump you already have | offline parser | `src/parse-tx-json.js` |
| Live monitoring of large transfers | event query loop | `src/whale-watcher.js` |
| Interactive exploration | browser UI | `index.html` |

Rules of thumb:

- **RPC `/tx_search` is the fastest indexed lookup and works on archive nodes**,
  but some chains (notably Osmosis) disable LCD event search, so RPC is the
  reliable path there.
- **The SDK REST layer is a thin passthrough** to CometBFT's TxSearch — it adds
  no extra query power and paginates the same way. Use it when you only have a
  REST endpoint.
- **Block scanning is exhaustive but slow** (~linear in blocks). Use it only
  when event indexing is unavailable or incomplete, or you need all events.
- **`/block_results` is complete and indexer-free** for per-block data (e.g.
  fees): it returns every event, including ones not indexed for search, and
  includes failed transactions (which still pay fees).

The full query grammar, operators, limits, the cross-event `AND` pitfall, and
verified per-query behaviour live in [`docs/query-capabilities.md`](docs/query-capabilities.md).

## Tools

Each file under `src/` is both a CLI and an importable ES module.

### RPC Event Query (`src/rpc-event-query.js`)

Tendermint `/tx_search` with raw or built queries, base64 auto-detection for
CometBFT < 0.38, pagination, and the full event catalog.

```bash
node src/rpc-event-query.js --event <type> --attr <name> --value <val>
node src/rpc-event-query.js --query "event.attr='value' AND event2.attr2='value2'" --all
node src/rpc-event-query.js --rpc https://rpc.archive.osmosis.zone \
  --event fungible_token_packet --attr receiver --value <address>
```

### Event Parser (`src/cosmos-event-parser.js`)

Cosmos LCD event queries with pagination, retry, and rate limiting.

```bash
node src/cosmos-event-parser.js <address>
node src/cosmos-event-parser.js --received <address>
node src/cosmos-event-parser.js --sent <address>
node src/cosmos-event-parser.js --failed <address>
node src/cosmos-event-parser.js --lcd https://lcd.osmosis.zone <address>
```

### Block Scanner (`src/query-txs.js`)

Walk blocks backward from the chain tip, checking all message address fields and
events.

```bash
node src/query-txs.js <address>
node src/query-txs.js --tx <hash>
node src/query-txs.js --account <address>
```

### Historical Address Search (`src/find-address-txs.js`)

Scan blocks to find all historical transactions for an address. Auto-stops at
the first tx (sequence 0). Saves results to a timestamped JSON file.

```bash
node src/find-address-txs.js <address> [start-height]
```

### Block Fee Totals (`src/fees.js`)

Total transaction fees for a block, height range, or UTC time range, read from
RPC `/block_results` fee events. Failed transactions are included because they
still pay fees; no off-chain indexer is needed. Time ranges binary-search
heights via `/block` header timestamps, so the node must serve the range.

```bash
node src/fees.js                          # latest block
node src/fees.js 71443001                 # single block
node src/fees.js 71443001-71443100        # inclusive height range
node src/fees.js --from 2026-09-27T17:32:00Z --to 2026-09-27T17:33:00Z
node src/fees.js --rpc https://rpc.archive.osmosis.zone 71443001
```

Supports Osmosis-style `tx.fee` events and the older Cosmos Hub-style `fee_pay`
event.

### Mintscan Distribution Audit (`src/mintscan-distributions.js`)

Query Mintscan's account history, fetch each transaction detail, and total
outbound base-denom transfers for an address. Handles `MsgSend`, `MsgMultiSend`,
and nested `MsgExec`, with transfer events as a fallback when message decoding
does not expose the bank send directly. Requires a Mintscan bearer token.

```bash
export MINT_TOKEN=...   # or MINTSCAN_API_KEY
node src/mintscan-distributions.js osmo1...
node src/mintscan-distributions.js osmo1... --from "2026-01-01" --to "2026-02-01 23:59:59" --json
```

### Offline TX Parsing (`src/parse-tx-json.js`)

Parse transaction JSON from a file. Handles multiple JSON structures and
categorizes errors.

```bash
node src/parse-tx-json.js <json_file> [--failed] [--sender <addr>] [--export]
```

### Whale Watcher (`src/whale-watcher.js`)

Monitor large transfers on Osmosis. Configurable token thresholds with IBC denom
support.

```bash
node src/whale-watcher.js [--once] [--hours <n>] [--token <symbol>]
```

## Explorer UI

Browser-based interactive query builder with dropdown-based query construction,
preset queries, paginated results, and JSON export. Event Search and RPC Queries
use the RPC URL field; REST Queries use the REST URL field. Selecting **Custom
URL** clears the field so the next query runs against the endpoint you enter.

The preset dropdowns combine a curated list of public nodes with every live
network that exposes a cosmos.directory aggregate endpoint
(`rpc.cosmos.directory/<chain>` / `rest.cosmos.directory/<chain>`). That list is
refreshed from `https://chains.cosmos.directory/` in the background and cached in
`localStorage` for 24 hours, with a bundled seed as the offline fallback.

```bash
yarn explorer  # http://127.0.0.1:8420/
```

`api/proxy.js` is the CORS proxy used both in-browser and on Vercel. It accepts
GET only, limits responses to 1 MiB, and forwards only to read-only
Cosmos/Tendermint paths on public or custom HTTPS endpoints.

## Modules

| Module | Role |
|---|---|
| `src/cosmos-event-parser.js` | `CosmosEventParser` class — LCD event queries, paginated fetch with retry, tx parsing, transfer filtering, address activity aggregation |
| `src/rpc-event-query.js` | `RpcEventQuery` class — Tendermint RPC `/tx_search`, base64 auto-detection, `EVENT_CATALOG` of known event types |
| `src/query-txs.js` | Block-level backward scanning, checks all message address fields and events |
| `src/find-address-txs.js` | Historical address search via block scanning, auto-stop, JSON output |
| `src/fees.js` | RPC `/block_results` fee totals per block, height range, or UTC time range; failed txs included |
| `src/mintscan-distributions.js` | Mintscan-backed account-history audit for outbound denom distributions |
| `src/parse-tx-json.js` | `TxParser` class for offline JSON file parsing, error categorization |
| `src/whale-watcher.js` | `WhaleWatcher` class — large transfer monitoring, configurable thresholds, watch loop |
| `index.html` | Single-file browser UI for interactive event queries |
| `api/proxy.js` | CORS proxy for the explorer (Vercel function + local dev server) |
| `dev-server.js` | Local static server that mounts the same proxy |

## Runtime

Uses Node.js native `fetch` (Node 18+) with no runtime dependencies. The
deterministic test suite runs with `yarn test`; see
[`docs/testing.md`](docs/testing.md) for bounded live-verification scenarios.

## Documentation

- [`docs/query-capabilities.md`](docs/query-capabilities.md) — query grammar,
  operators, limits, the cross-event `AND` problem, endpoint catalogue, and
  strategy recipes.
- [`docs/testing.md`](docs/testing.md) — live test scenarios and known values.
- [`AGENTS.md`](AGENTS.md) — working agreement for agents contributing here.

## License

MIT — see [`LICENSE`](LICENSE).
