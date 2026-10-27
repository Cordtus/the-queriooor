# Architecture

The project has two independent surfaces that share one contract: everything is
**read-only** HTTP against Cosmos SDK REST and CometBFT RPC, and no surface signs
or broadcasts anything. The CLI module catalogue is owned by
[`README.md`](../README.md); this document records how the pieces fit together
and which couplings break when only one side changes.

## Surfaces

| Surface | Entry point | Runtime | Notes |
|---|---|---|---|
| CLI/library | `src/*.js` | Node 18+, ES modules, no dependencies | Each file is both an importable module and a CLI (`import.meta.url` guard) |
| Browser explorer | `index.html` | Static HTML/CSS/JS, no build step | Self-contained; imports nothing from `src/` |
| Proxy | `api/proxy.js` | Vercel function and `dev-server.js` handler | Same code serves production and local development |

**Cross-surface coupling:** the explorer duplicates parsing heuristics that also
exist in the CLI modules. The important one is base64 event-attribute decoding:
`decodeAttr` in `index.html`, `RpcEventQuery.tryDecodeBase64Node`, and the LCD
parser all implement the CometBFT < 0.38 defensive-decode rule. A change to one
must be checked against the others; there is no shared module by design (the
explorer must stay a single file).

## Explorer request path

```text
index.html (browser)
  └─ proxiedFetch(url)
       ├─ GET /api/proxy?url=<encoded>
       │    ├─ local:      dev-server.js → api/proxy.js
       │    └─ production: Vercel serverless function api/proxy.js
       │         └─ HTTPS → public RPC/LCD endpoint
       └─ fallback: direct fetch(url) when the proxy answers 403/404
```

`proxiedFetch` tries the same-origin proxy first. A 403/404 is treated as "proxy
not available" and the request is retried directly (this is how a static
deployment without functions still works when the target allows CORS). Any
other proxy error is surfaced as a CORS hint. The proxy boundary itself is
documented in [integration.md](integration.md).

The local dev server mounts the same proxy, so browser behaviour matches
production; see [`dev-server.js`](../dev-server.js).

## Network selection model

Since 2026-10-24 the explorer selects **one chain**, not two endpoints:

- The **Chain** selector sets both fields from that chain's cosmos.directory
  aggregates: `https://rpc.cosmos.directory/<slug>` and
  `https://rest.cosmos.directory/<slug>`.
- RPC and REST therefore always describe the same network by construction.
  Splitting the selectors previously allowed RPC and REST from different chains,
  which silently produced nonsense results (for example an Osmosis tx hash
  queried against the Cosmos Hub REST node).
- Editing either URL by hand switches the selector to **Custom endpoints**; the
  fields stay editable so non-directory nodes remain usable.
- Chains that expose only one aggregate side carry `rpc: false` / `rest: false`
  in the catalogue. The missing field is left empty and the note names the
  unavailable capability; queries on that side fail with an explicit error.
- The default is **Osmosis**.

The chain catalogue comes from `https://chains.cosmos.directory/`, filtered to
`status === "live"` entries with at least one aggregate side. It is refreshed in
the background and cached in `localStorage` for 24 hours; the bundled seed in
`index.html` is the offline fallback. See [data-model.md](data-model.md) for the
cached shape.

## Query paths

| Explorer tab | Endpoint shape | Notes |
|---|---|---|
| Event Search | RPC `/tx_search` | Primary indexed search; client-side condition builder |
| RPC Queries | `/status`, `/block`, `/block_results`, `/validators`, `/tx_search` | Fixed query types |
| REST Queries | LCD `/cosmos/...` and `/ibc/...` | Includes tx search and per-tx lookup |

Cross-event `AND` conditions are executed as separate queries and intersected by
tx hash in the browser; the RPC index cannot express them. Query grammar,
operators, limits, and verified behaviours are owned by
[`docs/query-capabilities.md`](../docs/query-capabilities.md) — do not restate
them here.

## Known hazards

- **Aggregate nodes are shared public infrastructure.** They can be pruned
  (historical `/tx_search` fails), rate-limited, or offline. The status dot is an
  advisory reachability check, not a correctness guarantee. Some load-balanced
  nodes have transaction indexing disabled. `/tx_search` requests to the aggregate
  send `x-cosmos-require-index: 1`, which routes to nodes last recorded with
  `txIndex` enabled; `https://status.cosmos.directory/<chain>` exposes each node's
  `rpc.current[*].txIndex` and `txIndexCheckedAt` (the explorer does not poll it).
  A stale check can still route to an unindexed node, so the explorer also detects
  the missing-index payload, fetches the chain's directory endpoint list, and
  retries once through a randomly chosen different node; the node that works is
  reused for later pages.
- **The directory registry fetch is browser-direct.** It requires CORS on
  `chains.cosmos.directory`; failures are swallowed and the bundled seed remains.
- **Proxy 403/404 triggers a direct retry.** In local or function-less hosting a
  proxy rejection can surface as a misleading CORS message.
- **The proxy caps responses at 1 MiB.** Large `block_results` or tx payloads are
  rejected; the explorer reports the HTTP failure.
- **LCD event search is not universal** (Osmosis disables it). RPC `/tx_search`
  is the primary path; the REST search tab is a fallback.
- **Broad event queries must be height-scoped** and are limited to 512-character
  query strings and `per_page` ≤ 100. See `docs/query-capabilities.md`.
- **Explorer and CLI parsing drift.** They are deliberately separate files with
  no shared import; review both when decoding rules change.
