# Testing Procedure

Verified live data as of 2026-03-30. All examples use Osmosis endpoints, which
are the most reliable public ones.

Run `yarn test` first for the deterministic parsing and accounting checks. The
scenarios below are bounded live checks and may fail when public endpoints are
unavailable or their indexed history changes.

## Endpoints

| Label | URL | Status |
|---|---|---|
| Osmosis (Polkachu) | `https://osmosis-rpc.polkachu.com` | Reliable |
| Osmosis Archive | `https://rpc.archive.osmosis.zone` | Reliable, slower |
| Cosmos Hub (Polkachu) | `https://cosmos-rpc.polkachu.com` | Flaky/timeouts |

## Known addresses and values

| Type | Value | Notes |
|---|---|---|
| Sender | `osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94` | Sent ~1512 OSMO in bank send |
| Recipient | `osmo10p7dg5nh8kwjhfucq0uxjppg6wkevzmg67c4hx` | Received ~1512 OSMO |
| Delegator | `osmo1yqla2r7wyfk7tlr38wslpxqxfjde86csyph9p7` | Delegated ~367 OSMO |
| Validator | `osmovaloper146mj09yzu3mvz7pmy4dvs4z9wr2mst7rq8p8gy` | Received delegation |
| Swapper | `osmo1tgx3cuq4sae6nxq457r92cy4ctkv85wgn7l6g3` | Swapped ~123k uosmo for IBC ATOM |
| Tx Hash | `CFC05589D9D2EE964946814F0588E9AB491EDF611193924DCA77D7E04989E476` | Bank send |
| Tx Hash | `6A528AA8AAFBD9B2D664C828EC22614D3B3272325811683CA147C8EDAD1E72CD` | Delegation |
| Tx Hash | `3A82FC3F0FF163CBA190FDF794D1DAB723C9A0BCA0BC1F2D862717EDF1FBA8A7` | Token swap |
| IBC Channel | `channel-0` | Osmosis <-> Cosmos Hub, 5277+ packets |
| Pool ID | `1` | OSMO/ATOM pool, 9596+ swaps |

---

## RPC Event Query (src/rpc-event-query.js)

### 1. Bank transfer by sender

```bash
node src/rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event message --attr sender \
  --value osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94
```

### 2. Transfer by recipient

```bash
node src/rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event transfer --attr recipient \
  --value osmo10p7dg5nh8kwjhfucq0uxjppg6wkevzmg67c4hx
```

### 3. Staking delegation by validator

```bash
node src/rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event delegate --attr validator \
  --value osmovaloper146mj09yzu3mvz7pmy4dvs4z9wr2mst7rq8p8gy
```

### 4. IBC send packets (Osmosis -> Cosmos Hub)

```bash
node src/rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event send_packet --attr packet_src_channel \
  --value channel-0 --per-page 5
```

### 5. Token swap on pool 1 (OSMO/ATOM)

```bash
node src/rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event token_swapped --attr pool_id \
  --value 1 --per-page 5
```

### 6. Raw query string

```bash
node src/rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --query "message.action='/cosmos.staking.v1beta1.MsgDelegate'" \
  --per-page 3
```

### 7. JSON output mode

```bash
node src/rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event message --attr module --value bank \
  --per-page 1 --json
```

---

## LCD Parser (src/cosmos-event-parser.js)

Defaults to the public Osmosis LCD (`https://lcd.osmosis.zone`). Override the
endpoint with `--lcd <url>` or the `COSMOS_LCD` environment variable. Note that
LCD event search is disabled on Osmosis, so these calls only return results on
chains that expose `/cosmos/tx/v1beta1/txs`.

```bash
node src/cosmos-event-parser.js --lcd https://lcd.osmosis.zone osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94
node src/cosmos-event-parser.js --lcd https://lcd.osmosis.zone --received osmo10p7dg5nh8kwjhfucq0uxjppg6wkevzmg67c4hx
node src/cosmos-event-parser.js --lcd https://lcd.osmosis.zone --sent osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94
```

---

## Whale Watcher (src/whale-watcher.js)

```bash
node src/whale-watcher.js --once
node src/whale-watcher.js --hours 6
node src/whale-watcher.js --token ATOM --once
node src/whale-watcher.js --threshold OSMO 50000 --once
```

---

## Block Fee Totals (src/fees.js)

Deterministic fee, time, and argument parsing is covered by `yarn test`. Live
checks below use fixed heights, so the RPC node must retain that history
(archive nodes).

```bash
node src/fees.js 71443001
node src/fees.js 71443001-71443010
node src/fees.js --from 2026-09-27T17:32:00Z --to 2026-09-27T17:33:00Z
node src/fees.js --rpc https://cosmos-rpc.polkachu.com 33154001
```

Expected behavior:

- Block `71443001` reports `11236 uosmo` from a failed tx (code 11), proving failed txs are included
- Range `71443001-71443010` reports 12 transactions (4 failed) and `428724 uosmo`
- The time range resolves to blocks `71442963-71443010` and reports 28 transactions (9 failed), `2541 ibc/D189335C...` plus `1057468 uosmo`
- Cosmos Hub block `33154001` reports `381 uatom` via the older `fee_pay` event

---

## Explorer UI (index.html)

```bash
yarn explorer
```

Open `http://127.0.0.1:8420`; the Network panel defaults to **Osmosis**, which
sets the RPC endpoint to `https://rpc.cosmos.directory/osmosis` and the REST
endpoint to `https://rest.cosmos.directory/osmosis`.

| Event | Attribute | Value |
|---|---|---|
| `transfer` | `sender` | `osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94` |
| `token_swapped` | `pool_id` | `1` |
| `send_packet` | `packet_src_channel` | `channel-0` |
| `delegate` | `validator` | `osmovaloper146mj09yzu3mvz7pmy4dvs4z9wr2mst7rq8p8gy` |
| `message` | `module` | `bank` |

Also verify network selection and result rows:

- Choosing another chain updates both URL fields to that chain's `rpc.`/`rest.cosmos.directory` pair in one step.
- A chain with only one aggregate side (e.g. **Sei**, REST only) leaves the missing field empty and its note says those queries are unavailable.
- Editing either URL switches the selector to **Custom endpoints**.
- On first load (empty cache) the page renders from the bundled seed, then refreshes the chain list from `https://chains.cosmos.directory/` and writes `cosmos-explorer-directory-chains` to `localStorage`. Reloading within 24h uses the cache and makes no directory request (check the network tab). Clear the key to force a refresh.
- A transaction row shows a **Copy** button beside its hash while collapsed; clicking it copies the hash, shows `Copied`, and does not expand the row.
- If an RPC query hits a node with transaction indexing disabled, it retries once through a different node from `chains.cosmos.directory/<chain>` and the status says which node served the page. The condition is intermittent and cannot be forced from the UI; to reproduce, point the RPC field at a node known to have indexing disabled or rewrite the `/tx_search` response in DevTools to return `{"error":{"data":"transaction indexing is disabled"}}`.
- Running a query on a REST-only chain's REST side (e.g. Sei balances) succeeds through `/api/proxy`; the aggregate REST path `rest.cosmos.directory/<chain>/cosmos/...` is allowed.

---

## Expected behavior

- RPC queries should return parsed tx objects with `hash`, `height`, `code`, `success`, `events`
- Events should have decoded (not base64) attribute keys and values
- `--json` flag should output raw JSON response
- `--all` flag should paginate through all results respecting rate limits
- Explorer should render results in the browser with expandable event details
- Whale watcher should report transfers exceeding configured thresholds

---

## Mintscan Distribution Audit (src/mintscan-distributions.js)

Requires a valid Mintscan bearer token in `MINT_TOKEN` or `MINTSCAN_API_KEY`.

```bash
node src/mintscan-distributions.js --help
export MINT_TOKEN=...
node src/mintscan-distributions.js osmo1...
node src/mintscan-distributions.js osmo1... --json
```

Expected behavior:

- Reads the account transaction list from `GET /v1/:network/accounts/:address/transactions`
- Paginates with the returned `pagination.searchAfter` cursor until exhausted
- Fetches full transaction detail via Mintscan tx-hash lookup for each unique hash
- Totals outbound `uosmo` for `MsgSend`, `MsgMultiSend`, and nested `MsgExec`
- Falls back to `transfer` events only when no message-level distribution was classified
