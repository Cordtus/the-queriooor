# Testing Procedure

Verified live data as of 2026-03-30. All examples use Osmosis endpoints which are the most reliable.

Run `yarn test` first for deterministic parsing and accounting checks. The scenarios below are bounded live checks and may fail when public endpoints are unavailable or their indexed history changes.

## Endpoints

| Label | URL | Status |
|---|---|---|
| Osmosis (Polkachu) | `https://osmosis-rpc.polkachu.com` | Reliable |
| Osmosis Archive | `https://rpc.archive.osmosis.zone` | Reliable, slower |
| Cosmos Hub (Polkachu) | `https://cosmos-rpc.polkachu.com` | Flaky/timeouts |

## Known Addresses and Values

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

## RPC Event Query (rpc-event-query.js)

### 1. Bank transfer by sender

```bash
node rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event message --attr sender \
  --value osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94
```

### 2. Transfer by recipient

```bash
node rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event transfer --attr recipient \
  --value osmo10p7dg5nh8kwjhfucq0uxjppg6wkevzmg67c4hx
```

### 3. Staking delegation by validator

```bash
node rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event delegate --attr validator \
  --value osmovaloper146mj09yzu3mvz7pmy4dvs4z9wr2mst7rq8p8gy
```

### 4. IBC send packets (Osmosis -> Cosmos Hub)

```bash
node rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event send_packet --attr packet_src_channel \
  --value channel-0 --per-page 5
```

### 5. Token swap on pool 1 (OSMO/ATOM)

```bash
node rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event token_swapped --attr pool_id \
  --value 1 --per-page 5
```

### 6. Raw query string

```bash
node rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --query "message.action='/cosmos.staking.v1beta1.MsgDelegate'" \
  --per-page 3
```

### 7. JSON output mode

```bash
node rpc-event-query.js \
  --rpc https://osmosis-rpc.polkachu.com \
  --event message --attr module --value bank \
  --per-page 1 --json
```

---

## LCD Parser (cosmos-event-parser.js)

Hardcoded to Skip devnet LCD. To test against a live chain, modify baseUrl in the constructor call.

```bash
node cosmos-event-parser.js osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94
node cosmos-event-parser.js --received osmo10p7dg5nh8kwjhfucq0uxjppg6wkevzmg67c4hx
node cosmos-event-parser.js --sent osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94
```

---

## Whale Watcher (whale-watcher.js)

```bash
node whale-watcher.js --once
node whale-watcher.js --hours 6
node whale-watcher.js --token ATOM --once
node whale-watcher.js --threshold OSMO 50000 --once
```

---

## Block Fee Totals (fees.js)

Deterministic fee, time, and argument parsing is covered by `yarn test`. Live checks below use fixed heights, so the RPC node must retain that history (archive nodes).

```bash
node fees.js 71443001
node fees.js 71443001-71443010
node fees.js --from 2026-09-27T17:32:00Z --to 2026-09-27T17:33:00Z
node fees.js --rpc https://cosmos-rpc.polkachu.com 33154001
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

Open `http://127.0.0.1:8420` and select **Osmosis (Polkachu)** as the endpoint.

| Event | Attribute | Value |
|---|---|---|
| `transfer` | `sender` | `osmo13pet0rwjjzgz7f3058xklc2y05eg5cjneaad94` |
| `token_swapped` | `pool_id` | `1` |
| `send_packet` | `packet_src_channel` | `channel-0` |
| `delegate` | `validator` | `osmovaloper146mj09yzu3mvz7pmy4dvs4z9wr2mst7rq8p8gy` |
| `message` | `module` | `bank` |

---

## Expected Behavior

- RPC queries should return parsed tx objects with `hash`, `height`, `code`, `success`, `events`
- Events should have decoded (not base64) attribute keys and values
- `--json` flag should output raw JSON response
- `--all` flag should paginate through all results respecting rate limits
- Explorer should render results in the browser with expandable event details
- Whale watcher should report transfers exceeding configured thresholds

---

## Mintscan Distribution Audit (mintscan-distributions.js)

Requires a valid Mintscan bearer token in `MINT_TOKEN` or `MINTSCAN_API_KEY`.

```bash
node mintscan-distributions.js --help
set -x MINT_TOKEN ...
node mintscan-distributions.js osmo1f3w7ved2murkx4rg9qw8fyk5mfk2285hzzsxh5
node mintscan-distributions.js osmo1f3w7ved2murkx4rg9qw8fyk5mfk2285hzzsxh5 --json
```

Expected behavior:

- Reads the account transaction list from `GET /v1/:network/accounts/:address/transactions`
- Paginates with the returned `pagination.searchAfter` cursor until exhausted
- Fetches full transaction detail via Mintscan tx-hash lookup for each unique hash
- Totals outbound `uosmo` for `MsgSend`, `MsgMultiSend`, and nested `MsgExec`
- Falls back to `transfer` events only when no message-level distribution was classified
