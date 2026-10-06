# the-queriooor

Cosmos blockchain event parser and monitoring toolkit. Vanilla JavaScript (ES Modules), no build step. Queries Cosmos LCD/REST and Tendermint RPC endpoints for transaction data, parses events, filters transfers, and monitors whale activity. Includes a browser-based explorer UI.

## Setup

```bash
yarn install
```

## Usage

### Event Parser (LCD)

Query transactions via Cosmos LCD event filters with pagination, retry, and rate limiting.

```bash
node cosmos-event-parser.js <address>
node cosmos-event-parser.js --received <address>
node cosmos-event-parser.js --sent <address>
node cosmos-event-parser.js --failed <address>
```

### RPC Event Query

Query transactions via Tendermint RPC `/tx_search`. Supports archive nodes and auto-detects base64-encoded attributes (CometBFT <0.38).

```bash
node rpc-event-query.js --event <type> --attr <name> --value <val>
node rpc-event-query.js --query "event.attr='value' AND event2.attr2='value2'" --all
node rpc-event-query.js --rpc https://rpc.archive.osmosis.zone \
  --event fungible_token_packet --attr receiver --value <address>
```

### Block Scanner

Walk blocks backward from chain tip, checking all message address fields and events.

```bash
node query-txs.js <address>
node query-txs.js --tx <hash>
node query-txs.js --account <address>
```

### Block Fee Totals (RPC)

Total transaction fees for a block, height range, or UTC time range, read from RPC `/block_results` fee events. Failed transactions are included because they still pay fees; no off-chain indexer is needed.

```bash
node fees.js                          # latest block
node fees.js 71443001                 # single block
node fees.js 71443001-71443100        # inclusive height range
node fees.js --from 2026-09-27T17:32:00Z --to 2026-09-27T17:33:00Z
node fees.js --rpc https://rpc.archive.osmosis.zone 71443001
```

Time ranges binary-search heights via `/block` header timestamps, so the RPC node must serve blocks for the requested range. Supports Osmosis-style `tx.fee` events and the older Cosmos Hub-style `fee_pay` event.

### Historical Address Search

Scan blocks to find all historical transactions for an address. Auto-stops at first tx (sequence 0). Saves results to timestamped JSON.

```bash
node find-address-txs.js <address> [start-height]
```

### Mintscan Distribution Audit

Query Mintscan's account history, fetch each transaction detail, and total outbound base-denom transfers for an address. Handles `MsgSend`, `MsgMultiSend`, and nested `MsgExec`, with transfer events as a fallback when message decoding does not expose the bank send directly.

```bash
set -x MINT_TOKEN ...
node mintscan-distributions.js osmo1f3w7ved2murkx4rg9qw8fyk5mfk2285hzzsxh5
node mintscan-distributions.js osmo1... --from "2026-01-01" --to "2026-02-01 23:59:59" --json
```

### Offline TX Parsing

Parse transaction JSON from file. Handles multiple JSON structures and error categorization.

```bash
node parse-tx-json.js <json_file> [--failed] [--sender <addr>] [--export]
```

### Whale Watcher

Monitor large transfers on Osmosis. Configurable token thresholds with IBC denom support.

```bash
node whale-watcher.js [--once] [--hours <n>] [--token <symbol>]
```

### Explorer UI

Browser-based interactive event query builder with dropdown-based query construction, preset queries, paginated results, and JSON export. Event Search and RPC Queries use the RPC URL field; REST Queries use the REST URL field. Selecting **Custom URL** clears the field so the next query runs against the endpoint you enter.

```bash
yarn explorer  # http://127.0.0.1:8420/
```

## Modules

| Module | Role |
|---|---|
| `cosmos-event-parser.js` | `CosmosEventParser` class -- LCD event queries, paginated fetch with retry, tx parsing, transfer filtering, address activity aggregation |
| `rpc-event-query.js` | `RpcEventQuery` class -- Tendermint RPC `/tx_search`, base64 auto-detection, `EVENT_CATALOG` with all known event types |
| `query-txs.js` | Block-level backward scanning, checks all message address fields and events |
| `fees.js` | RPC `/block_results` fee totals per block, height range, or UTC time range; failed txs included |
| `find-address-txs.js` | Historical address search via block scanning, auto-stop, JSON output |
| `mintscan-distributions.js` | Mintscan-backed account-history audit for outbound denom distributions |
| `parse-tx-json.js` | `TxParser` class for offline JSON file parsing, error categorization |
| `whale-watcher.js` | `WhaleWatcher` class -- large transfer monitoring, configurable thresholds, continuous watch loop |
| `index.html` | Single-file browser UI for interactive event queries |

## Query Strategies

- **LCD event queries** (`cosmos-event-parser.js`) -- filtered search via `/cosmos/tx/v1beta1/txs` with `events=` parameter. Best for targeted queries on nodes with working LCD search.
- **Tendermint RPC** (`rpc-event-query.js`) -- `/tx_search` endpoint. Works with archive nodes and supports the full Tendermint query syntax. Required for Osmosis (LCD tx search is broken).
- **Block scanning** (`query-txs.js`, `find-address-txs.js`) -- linear walk through blocks. Exhaustive but slow. Use when event indexing is unavailable or incomplete.
- **RPC block results** (`fees.js`) -- one `/block_results` call per block for fee totals; includes failed txs and avoids LCD pagination limits.
- **Mintscan historical API** (`mintscan-distributions.js`) -- account-centric history with `searchAfter` pagination and tx-detail fetches. Best when you need transaction classification for one address and have a valid Mintscan API token.

## Runtime

Uses Node.js native `fetch` (requires Node 18+). The toolkit is intentionally read-only and does not connect wallets, sign, or broadcast transactions. The CORS proxy (`api/proxy.js`) accepts GET requests only, limits responses to 1 MiB, and forwards only to read-only Cosmos/Tendermint paths — preset public endpoints plus any custom HTTPS endpoint whose path is a read-only query. Locally, `node dev-server.js` serves the explorer and the same proxy, so custom endpoints work in-browser without a Vercel deploy; against a custom endpoint that does not permit browser CORS, the proxy is required.

## License

MIT
