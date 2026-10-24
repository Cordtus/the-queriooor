# Data model

There is no database or index in this project. Data is fetched per request and
discarded; the only persistence is browser `localStorage`. The canonical query
grammar lives in [`docs/query-capabilities.md`](../docs/query-capabilities.md).

## Transaction shapes

### RPC `/tx_search` (index.html `parseTxBrowser`)

```js
{
  hash: string,
  height: number,
  code: number,
  success: boolean,        // code === 0
  gasWanted: number|string,
  gasUsed: number|string,
  events: [{ type: string, attributes: { [key]: string } }],
  log: string,
}
```

The raw RPC response nests results under `result.txs[].tx_result`. Attributes
arrive as `{ key, value }` arrays and may be base64 on CometBFT < 0.38;
`decodeAttr` decodes only when the value is valid base64 that round-trips to
valid UTF-8, otherwise it keeps the original text.

### LCD `/cosmos/tx/v1beta1/txs` search

The REST renderer consumes `tx_responses[]` directly: each entry has `txhash`,
`height`, `code`, `gas_used`, `gas_wanted`, `timestamp`, and `logs[].events[]`
with plaintext `attributes[]` (no base64 decoding is applied on this path).
RPC and LCD result rows therefore use different field names by design; both are
rendered by their own functions.

### CLI modules

| Producer | Shape |
|---|---|
| `src/rpc-event-query.js` | Normalized parsed tx objects; base64 attributes decoded defensively |
| `src/cosmos-event-parser.js` | LCD tx responses, transfer filtering, address aggregation |
| `src/parse-tx-json.js` | Offline JSON dumps |

The explorer does not import these modules; see
[architecture.md](architecture.md#surfaces) for the duplication coupling.

## Browser local storage

| Key | Value | Lifetime |
|---|---|---|
| `cosmos-explorer-directory-chains` | `{ ts: number, chains: [{ slug, label, rpc?: false, rest?: false }] }` | 24 h TTL; written after a successful registry fetch |
| `cosmos-explorer-custom-values` | `{ "<event>.<attribute>": string[] }` — values typed by the user that become suggestions | Until `localStorage` is cleared |

The cache is only trusted when `chains` is a non-empty array and `ts` is finite.
A failed write is ignored; the in-memory list from the fetch is still used.

## Event catalogue

`EVENT_CATALOG` in `index.html` and the catalogue in
`src/rpc-event-query.js` describe known event types and attributes for the
builder UI. They are kept in sync manually; the module header says so. Values
are suggestions only — the condition builder accepts arbitrary attributes.
