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

### Historical Address Search

Scan blocks to find all historical transactions for an address. Auto-stops at first tx (sequence 0). Saves results to timestamped JSON.

```bash
node find-address-txs.js <address> [start-height]
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

Browser-based interactive event query builder with dropdown-based query construction, preset queries, paginated results, and JSON export. Queries RPC directly (CORS open on most public nodes).

```bash
yarn explorer  # http://127.0.0.1:8420/explorer.html
```

### Test Transaction Broadcaster

Broadcasts transactions (including intentional failures) to devnet using CosmJS.

```bash
node send-cosmos-txs.js
```

## Modules

| Module | Role |
|---|---|
| `cosmos-event-parser.js` | `CosmosEventParser` class -- LCD event queries, paginated fetch with retry, tx parsing, transfer filtering, address activity aggregation |
| `rpc-event-query.js` | `RpcEventQuery` class -- Tendermint RPC `/tx_search`, base64 auto-detection, `EVENT_CATALOG` with all known event types |
| `query-txs.js` | Block-level backward scanning, checks all message address fields and events |
| `find-address-txs.js` | Historical address search via block scanning, auto-stop, JSON output |
| `parse-tx-json.js` | `TxParser` class for offline JSON file parsing, error categorization |
| `whale-watcher.js` | `WhaleWatcher` class -- large transfer monitoring, configurable thresholds, continuous watch loop |
| `send-cosmos-txs.js` | CosmJS transaction broadcaster for devnet testing |
| `explorer.html` | Single-file browser UI for interactive event queries |
| `generate-test-txs.js` | Test fixture generator (CommonJS) |

## Query Strategies

- **LCD event queries** (`cosmos-event-parser.js`) -- filtered search via `/cosmos/tx/v1beta1/txs` with `events=` parameter. Best for targeted queries on nodes with working LCD search.
- **Tendermint RPC** (`rpc-event-query.js`) -- `/tx_search` endpoint. Works with archive nodes and supports the full Tendermint query syntax. Required for Osmosis (LCD tx search is broken).
- **Block scanning** (`query-txs.js`, `find-address-txs.js`) -- linear walk through blocks. Exhaustive but slow. Use when event indexing is unavailable or incomplete.

## Dependencies

- `@cosmjs/amino`, `@cosmjs/proto-signing`, `@cosmjs/stargate` -- wallet/signing/broadcasting (only used by `send-cosmos-txs.js`)

Uses Node.js native `fetch` (requires Node 18+).

## License

MIT
