# Cosmos/Tendermint Query Capabilities Reference

Reference for querying Cosmos SDK / Tendermint / CometBFT applications, derived
from CometBFT and Cosmos SDK source. Covers the query grammar, operators, and
limits; the cross-event `AND` limitation; the RPC and REST method catalogue; and
recipes for common cases. Use it to choose the right retrieval method and to
understand why some queries return nothing.

---

## Architecture: Two Query Layers

```
Browser UI
  |
  +-- CometBFT RPC (port 26657)     -- tx_search, block_search, block_results, etc.
  |     Query grammar parsed by:     libs/pubsub/query/syntax/parser.go
  |     Events indexed by:           state/txindex/kv/kv.go
  |
  +-- Cosmos SDK REST/gRPC (port 1317) -- /cosmos/tx/v1beta1/txs, module queries
        GetTxsEvent handler:          x/auth/tx/service.go
        Forwards query verbatim to CometBFT TxSearch
        Module state queries:         each x/{module}/keeper/grpc_query.go
```

The SDK REST layer is a **thin passthrough** for event queries -- it forwards the query
string directly to CometBFT's TxSearch. All query parsing, operator handling, and event
matching happens in CometBFT.

---

## CometBFT Query Grammar

Source: `libs/pubsub/query/syntax/doc.go`

```ebnf
query      = conditions EOF
conditions = condition { "AND" condition }
condition  = tag comparison
comparison = equal | order | contains | "EXISTS"
equal      = "=" ( date | number | time | value )
order      = cmp ( date | number | time )
contains   = "CONTAINS" value
cmp        = "<" | "<=" | ">" | ">="
```

### Operators (7 total)

| Operator   | Accepts              | Example                                  |
|------------|----------------------|------------------------------------------|
| `=`        | string, number, date, time | `message.action='/cosmos.bank.v1beta1.MsgSend'` |
| `>`        | number, date, time   | `tx.height > 58000000`                   |
| `>=`       | number, date, time   | `tx.height >= 58000000`                  |
| `<`        | number, date, time   | `tx.height < 58100000`                   |
| `<=`       | number, date, time   | `tx.height <= 58100000`                  |
| `EXISTS`   | (no argument)        | `wasm.token_id EXISTS`                   |
| `CONTAINS` | string only          | `message.action CONTAINS 'bank'`         |

### Value Types

| Type   | Syntax                        | Examples                          |
|--------|-------------------------------|-----------------------------------|
| String | Single-quoted                 | `'NewBlock'`, `'/cosmos.bank.v1beta1.MsgSend'` |
| Number | Digits, optional decimal      | `0`, `58143529`, `3.25`           |
| Date   | `DATE` keyword + YYYY-MM-DD   | `DATE 2024-01-15`                 |
| Time   | `TIME` keyword + RFC3339      | `TIME 2024-01-15T14:30:00Z`      |

### Logical Operators

- **AND**: Supported. Must be uppercase. Joins multiple conditions.
- **OR**: NOT supported. Grammar has no OR token. Always conjunction.

### Tag Format

Tags match `[a-zA-Z0-9_][a-zA-Z0-9._-]*`. Dot separates event type from attribute key.
Hyphens allowed (e.g., `wasm-set-ask._contract_address`).

### Reserved Tags

| Tag            | Behavior                                              |
|----------------|-------------------------------------------------------|
| `tx.hash`      | Short-circuits to direct hash lookup (no scan)        |
| `tx.height`    | Special height deduplication, works across all events  |
| `block.height` | Used in block indexer only                            |

### Limits

- Max query length: **512 characters**
- Max `per_page`: **100**
- Default `per_page`: **30**
- No server-side cap on total matches (but broad queries timeout)

---

## The Cross-Event AND Problem

Source: `state/txindex/kv/kv.go`, function `setTmpHashes`

### Root Cause

The KV indexer stores composite keys:
```
{eventType}.{attrKey}/{attrValue}/{blockHeight}/{txIndex}$es${eventSequence}
```

When intersecting AND conditions, the indexer uses `txHash + eventSequence` as the
deduplication key. Two conditions matching the SAME transaction but DIFFERENT events
produce different composite keys (different `$es$` suffixes), so the intersection
discards them.

### What This Means in Practice

| Combination | Example | Works? |
|------------|---------|--------|
| Same event type, different attrs | `message.action='X' AND message.module='bank'` | Y |
| Same event type, 3+ attrs | `wasm._contract_address='X' AND wasm.action='Y' AND tx.height>N` | Y |
| Different event types | `message.action='X' AND transfer.recipient='Y'` | NEVER (returns 0) |
| Different event types | `wasm.action='X' AND token_swapped.pool_id='Y'` | NEVER (returns 0) |
| Same event type, same attr, different values | `message.action='A' AND message.action='B'` | NEVER (logically impossible) |
| Any filter + `tx.height` | `wasm.action='X' AND tx.height>N` | Y (height is special) |
| Height range | `tx.height>N AND tx.height<M` | Y |

### Confirmed by CometBFT test (`TestTxSearchEventMatch`):
```
Event(type="account"): number=1, owner="Ana"
Event(type="account"): number=2, owner="/Ivan/.test"

Query "account.number=2 AND account.owner='Ana'" -> 0 results (different event instances)
Query "account.number=1 AND account.owner='Ana'" -> 1 result  (same event instance)
```

### Workaround: Client-Side Intersection

Run N separate queries (one per event type), collect results, intersect by tx hash:
```
Query 1: message.action='/cosmos.bank.v1beta1.MsgSend' AND tx.height>N
Query 2: transfer.recipient='osmo1...' AND tx.height>N
Result:  intersection of tx hashes from both queries
```

---

## CometBFT RPC Methods (Query-Relevant)

### tx_search
```
GET /tx_search?query="..."&per_page=100&page=1&order_by="desc"&prove=false
```
Search txs by event query. Returns matching txs with decoded events.

### tx
```
GET /tx?hash=0xABCD...&prove=false
```
Direct lookup by tx hash. No query parsing.

### block_search
```
GET /block_search?query="..."&per_page=100&page=1&order_by="desc"
```
Search blocks by FinalizeBlock events. Same query grammar as tx_search.
Searches a DIFFERENT index (block events, not tx events).

### block
```
GET /block?height=N
```
Get block at height. Default: latest.

### block_results
```
GET /block_results?height=N
```
Returns `tx_results[]` (per-tx events) and `finalize_block_events[]`. This is the
raw event data BEFORE indexing -- useful for seeing ALL events including non-indexed ones.

### blockchain
```
GET /blockchain?minHeight=N&maxHeight=M
```
Block headers in range. Hard limit: **20 blocks** per request. Descending order.

### validators
```
GET /validators?height=N&per_page=100&page=1
```
Validator set at height. Sorted by voting power desc.

### status
```
GET /status
```
Node info, sync status, latest block height/hash/time.

### abci_query
```
GET /abci_query?path="..."&data=0x...&height=N&prove=false
```
Query application state directly. The `path` maps to module query routes.
This is how gRPC queries are forwarded through CometBFT when no gRPC port is available.

### subscribe (WebSocket only)
```
{"method": "subscribe", "params": {"query": "tm.event='Tx' AND message.action='...'"}}
```
Real-time event subscription. Same query grammar. Useful for live monitoring.

---

## Cosmos SDK REST Endpoints

### Transaction Queries

#### GET /cosmos/tx/v1beta1/txs -- Event Search
```
Parameters:
  query=<CometBFT query string>     (v0.50+, current)
  events=<event1>&events=<event2>   (deprecated, pre-v0.47)
  order_by=ORDER_BY_DESC            (ORDER_BY_ASC, ORDER_BY_DESC, ORDER_BY_UNSPECIFIED)
  page=1                            (1-indexed)
  limit=100                         (default 100)
```

**CRITICAL**: The `events` repeated param is DEPRECATED. The handler in current SDK
(`x/auth/tx/service.go`) only reads `query`. The query string is passed verbatim to
CometBFT's TxSearch. However, older chain binaries (pre-v0.50) may only support `events`.

#### GET /cosmos/tx/v1beta1/txs/{hash} -- TX by Hash
Direct lookup. Returns decoded tx + tx_response.

#### GET /cosmos/tx/v1beta1/txs/block/{height} -- Block TXs
All txs in a block with decoded bodies. SDK-paginated.

#### POST /cosmos/tx/v1beta1/decode -- Decode TX
Decode raw tx bytes into structured Tx proto.

#### POST /cosmos/tx/v1beta1/encode -- Encode TX
Encode structured Tx proto to bytes.

### Module State Queries

All module queries use Cosmos SDK pagination (`PageRequest`):
```
?pagination.key=<base64>&pagination.limit=100&pagination.count_total=true&pagination.reverse=true
```
OR offset-based:
```
?pagination.offset=0&pagination.limit=100
```
Key-based is more efficient. Use `next_key` from response for cursor pagination.

#### Bank
| Endpoint | Description |
|----------|-------------|
| `GET /cosmos/bank/v1beta1/balances/{address}` | All balances |
| `GET /cosmos/bank/v1beta1/balances/{address}/by_denom?denom=uosmo` | Single balance |
| `GET /cosmos/bank/v1beta1/spendable_balances/{address}` | Spendable balances |
| `GET /cosmos/bank/v1beta1/supply` | Total supply |
| `GET /cosmos/bank/v1beta1/supply/by_denom?denom=uosmo` | Supply of denom |
| `GET /cosmos/bank/v1beta1/denoms_metadata` | All denom metadata |
| `GET /cosmos/bank/v1beta1/denom_owners/{denom}` | All holders of denom |

#### Staking
| Endpoint | Description |
|----------|-------------|
| `GET /cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED` | Validators (filter by status) |
| `GET /cosmos/staking/v1beta1/validators/{addr}` | Single validator |
| `GET /cosmos/staking/v1beta1/validators/{addr}/delegations` | Delegations to validator |
| `GET /cosmos/staking/v1beta1/delegations/{delegator}` | All delegations by delegator |
| `GET /cosmos/staking/v1beta1/delegators/{addr}/unbonding_delegations` | Unbonding delegations |
| `GET /cosmos/staking/v1beta1/delegators/{addr}/redelegations` | Redelegations |
| `GET /cosmos/staking/v1beta1/pool` | Bonded/unbonded pool totals |

#### Governance
| Endpoint | Description |
|----------|-------------|
| `GET /cosmos/gov/v1/proposals?proposal_status=PROPOSAL_STATUS_VOTING_PERIOD` | Proposals (filter by status) |
| `GET /cosmos/gov/v1/proposals/{id}` | Single proposal |
| `GET /cosmos/gov/v1/proposals/{id}/votes` | Votes on proposal |
| `GET /cosmos/gov/v1/proposals/{id}/deposits` | Deposits on proposal |
| `GET /cosmos/gov/v1/proposals/{id}/tally` | Tally result |

#### Distribution
| Endpoint | Description |
|----------|-------------|
| `GET /cosmos/distribution/v1beta1/delegators/{addr}/rewards` | Total rewards |
| `GET /cosmos/distribution/v1beta1/delegators/{addr}/rewards/{validator}` | Rewards from validator |
| `GET /cosmos/distribution/v1beta1/validators/{addr}/commission` | Validator commission |
| `GET /cosmos/distribution/v1beta1/community_pool` | Community pool |

#### Auth
| Endpoint | Description |
|----------|-------------|
| `GET /cosmos/auth/v1beta1/accounts/{address}` | Account info |
| `GET /cosmos/auth/v1beta1/accounts` | All accounts (paginated) |
| `GET /cosmos/auth/v1beta1/module_accounts` | Module accounts |

#### IBC
| Endpoint | Description |
|----------|-------------|
| `GET /ibc/core/channel/v1/channels` | All channels |
| `GET /ibc/core/channel/v1/channels/{id}/ports/{port}` | Single channel |
| `GET /ibc/core/channel/v1/connections/{conn}/channels` | Channels by connection |
| `GET /ibc/core/connection/v1/connections` | All connections |
| `GET /ibc/core/client/v1/client_states` | All IBC clients |
| `GET /ibc/apps/transfer/v1/denoms` | All IBC denominations |
| `GET /ibc/apps/transfer/v1/denom_hashes/{trace}` | Denom hash from trace |

---

## Chaining Strategies for the Explorer

### Strategy 1: Same-Event AND (Native)
When all conditions share the same event type, use a single query:
```
wasm._contract_address='osmo1...' AND wasm.action='swap' AND tx.height>58000000
```

### Strategy 2: Height-Scoped Queries
Always add `tx.height>N` to avoid timeouts on broad queries:
```
transfer.recipient='osmo1...' AND tx.height>58140000
```

### Strategy 3: Client-Side Intersection (Cross-Event)
For conditions spanning different event types, run separate queries and intersect:
```
Q1: message.action='/cosmos.bank.v1beta1.MsgSend' AND tx.height>N -> Set A (hashes)
Q2: transfer.recipient='osmo1...' AND tx.height>N                 -> Set B (hashes)
Result: A intersection B
```
This is what no existing block explorer does. It enables genuinely new query combinations.

### Strategy 4: EXISTS for Discovery
Find all txs that have a particular attribute, regardless of value:
```
wasm.token_id EXISTS AND tx.height>58000000
```
Useful for "show me all NFT activity" without knowing specific token IDs.

### Strategy 5: CONTAINS for Fuzzy Matching
Substring matching on attribute values:
```
message.action CONTAINS 'bank'        -> matches any bank module message
message.action CONTAINS 'Swap'        -> matches any swap message type
```

### Strategy 6: Block Scanning via block_results
For events that aren't indexed or for complete event coverage:
```
GET /block_results?height=N
```
Returns ALL events (indexed and non-indexed). Slower but complete.
Can be automated: scan height range, filter events client-side.

### Strategy 7: Module State + Event Correlation
Combine module state queries with event queries:
```
1. GET /cosmos/staking/v1beta1/validators/{addr}/delegations  -> get delegators
2. For each delegator: tx_search message.sender='{delegator}' -> get their tx history
```

### Strategy 8: WebSocket Subscription (Live)
For real-time monitoring:
```
subscribe: tm.event='Tx' AND message.action='/cosmwasm.wasm.v1.MsgExecuteContract'
```

---

## Live-Verified Test Results (Osmosis, 2026-03-29)

### Single Filters
| Filter | Query | Count | Notes |
|--------|-------|-------|-------|
| message.action | `/cosmos.bank.v1beta1.MsgSend` | 6924 | |
| message.action | `/cosmos.staking.v1beta1.MsgDelegate` | 1916 | |
| message.action | `/cosmwasm.wasm.v1.MsgExecuteContract` | 27269 | |
| message.action | `/osmosis.poolmanager.v1beta1.MsgSwapExactAmountIn` | 32115 | |
| message.module | `bank` | 6934 | |
| message.module | `ibc_client` | 71216 | |
| message.sender | address | 10 | needs height scope |
| transfer.recipient | address | 2571 | needs height scope |
| coin_received.receiver | address | 2571 | needs height scope |
| wasm._contract_address | contract | 5382 | |
| wasm.action | `swap` | 1357 | |
| wasm.action | `update_price_feeds` | 5382 | |
| token_swapped.pool_id | `1283` | 1115 | |
| token_swapped.sender | address | 10 | with height |
| delegate.amount | `1000000uosmo` | 5 | with height |
| recv_packet.packet_src_channel | `channel-0` | 19 | with height |
| send_packet.packet_dst_channel | `channel-0` | 34 | with height |
| tx.height (exact) | `58143529` | 1 | |
| tx.height (range) | `>58143500` | 120 | |
| EXISTS | `wasm.token_id EXISTS` | 394 | |
| CONTAINS | `message.action CONTAINS 'bank'` | 6941 | |

### AND Combinations
| Combination | Count | Works? |
|-------------|-------|--------|
| message.action + message.module (same type) | 6931 | Y |
| message.action + message.msg_index (same type) | 6218 | Y |
| wasm._contract_address + wasm.action (same type) | 5383 | Y |
| wasm + wasm + height (triple same) | 37 | Y |
| action + height range (both bounds) | 3 | Y |
| message + transfer (cross-type) | 0 | N |
| message + wasm (cross-type) | 0 | N |
| wasm + token_swapped (cross-type) | 0 | N |
| transfer + coin_received (cross-type) | 0 | N |
| 2x message.action different values | 0 | N (impossible) |
| OR syntax | error | N (not supported) |

### LCD Event Search
| Query param | Works? |
|-------------|--------|
| `?query=message.action='...'` | Y (current, v0.50+) |
| `?events=message.action='...'` | N (returns "query cannot be empty") |
| LCD cross-event AND | N (same CometBFT limitation) |
