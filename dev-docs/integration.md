# Integration

The project has no private paired service. Its integrations are public Cosmos
infrastructure and the hosting platform. The proxy is the only **server-side**
security boundary; the browser can still fetch endpoints directly when the proxy
is unavailable, so proxy rules constrain what the deployment forwards, not what a
client may request.

## Upstreams

| Upstream | Used by | Contract |
|---|---|---|
| `https://rpc.cosmos.directory/<chain>` | Explorer RPC (Event Search, RPC Queries) | CometBFT JSON-RPC, load-balanced public nodes. `/tx_search` carries `x-cosmos-require-index: 1` so the aggregate prefers nodes last recorded with `txIndex: true` |
| `https://status.cosmos.directory/<chain>` | Reference only | Per-chain node health; `rpc.current[url].txIndex` reports each node's tx-index state and `txIndexCheckedAt` its freshness. The explorer does not poll it |
| `https://rest.cosmos.directory/<chain>` | Explorer REST (balances, tx lookup, tx search) | Cosmos SDK REST over HTTPS |
| `https://chains.cosmos.directory/` | Explorer chain catalogue refresh | Registry JSON with `chains[]`; needs browser CORS; cached 24 h |
| `https://chains.cosmos.directory/<chain>` | Explorer RPC fallback | Single-chain JSON fetched **browser-direct (needs CORS; failure is silent)**; `chain.best_apis.rpc` (else `chain.apis.rpc`) supplies alternative nodes for the indexing-disabled retry |
| Arbitrary public RPC/LCD | CLI tools and **Custom endpoints** override | Credential-free HTTPS; read-only paths only through the proxy |

Changing the explorer's chain catalogue only requires the seed in `index.html`
and the registry fetch; the proxy already accepts any cosmos.directory aggregate
REST path and any read-only RPC path. Adding a new *query shape* does require a
proxy change (below).

## Proxy contract (`api/proxy.js`)

The proxy is served at `/api/proxy?url=<encoded target>` both locally
(`dev-server.js`) and on Vercel. `api/proxy.test.js` is the canonical executable
specification; the invariants are:

- `OPTIONS` returns 204; every method except `GET` returns 405.
- The target must be an absolute, credential-free `https:` URL.
- Paths are restricted to read-only shapes:
  - RPC: last path segment must be one of `/status`, `/block`,
    `/block_results`, `/validators`, `/tx_search`.
  - REST: the path must start with `/cosmos/` or `/ibc/`.
- Known presets keep their base-path prefix strict; unknown origins are accepted
  only when the path matches the rules above. `rest.cosmos.directory` has an
  explicit `<chain>/cosmos|ibc/...` aggregate exception.
- Responses are capped at 1 MiB (413 above that); upstream failures return 502.
- `x-cosmos-require-index: 1` is forwarded upstream only when the caller sets
  exactly that value **and** the target is the `rpc.cosmos.directory` aggregate's
  `/tx_search` path. Other values and targets drop it. This asks the aggregate to
  prefer nodes last recorded with a tx index.
- CORS is `*` for `/api/*` in `vercel.json` (including the require-index header
  in `Access-Control-Allow-Headers`); the function repeats the headers.

Do not widen these rules into a general open proxy. The CLI tools intentionally
do not use the proxy; they call endpoints directly from Node.

## Hosting and delivery

- **Platform:** Vercel project `craw/the-queriooor`, linked to
  `github.com/Cordtus/the-queriooor`.
- **Trigger:** a push to `main` creates a production deployment through the
  Vercel Git integration (`vercel[bot]` in the deployment list).
- **Function:** `api/proxy.js`, `maxDuration` 30 s, region `iad1` at last check.
- **Static output:** repository root, no build command, framework `null`.
- **Secrets:** none. No environment variables are required for the app or proxy.

Status, aliases, rollback, and the canonical runbook pointer:
[operations/running-state.md](operations/running-state.md) and
`docs/deployment.md`.

## Change protocol

- Proxy path/validation change → update `api/proxy.test.js` first, then the
  explorer's `proxiedFetch` expectations, then `docs/testing.md` scenarios.
- Registry/catalogue change → update the seed list, run `yarn test`
  (`src/index.test.js` covers the mapping), and note the availability flags for
  one-sided chains.
- Endpoint or alias change → update the running-state record and `README.md`
  only where they name the URL.
