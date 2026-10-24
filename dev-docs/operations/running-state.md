# Running state

Last verified: 2026-10-24, after the explorer network-selection release.

| Question | Answer |
|---|---|
| Status | **live**, production |
| Platform | Vercel, project `craw/the-queriooor`, region `iad1` for the function |
| Public URL | <https://the-queriooor.vercel.app> |
| Other aliases | `the-queriooor-craw.vercel.app`, `the-queriooor-git-main-craw.vercel.app` |
| Source | `github.com/Cordtus/the-queriooor`, branch `main` |
| Deployed by | Vercel Git integration; deployments are created by `vercel[bot]` on push |
| Last application release | 2026-10-24, commit `da3f6f6`, deployment `dpl_5pBZJdg4K1v3bfZHSgTVADnEwpvW` |
| Canonical runbook | [`docs/deployment.md`](../../docs/deployment.md) |

Every push to `main` creates a production deployment, including docs-only
commits. This record names the last **application** release; use
`vercel ls the-queriooor` for the newest deployment.

## Topology

```text
github main ──push──> Vercel project craw/the-queriooor
                        ├─ static: repository root (every committed file is public)
                        └─ function: api/proxy.js  (30 s, iad1)
                                 └─ HTTPS → public RPC/LCD nodes
```

No database, queue, cron, worker, or persistent volume. Browser state is
`localStorage` only; nothing is written server-side.

## Configuration

- No build command and no framework; `outputDirectory` is the repository root
  (`vercel.json`).
- No environment variables or secrets. Public endpoints are compiled defaults in
  `index.html` and the CLI flags/`COSMOS_LCD`.
- `api/proxy.js` is the only endpoint that must be reachable; everything else is
  static.

## Observability

- Vercel deployment/build logs and function logs in the Vercel dashboard.
- No metrics, tracing, uptime checks, or alerting are configured.
- Ad-hoc check: `curl -sS -o /dev/null -w '%{http_code}\n' https://the-queriooor.vercel.app/`.

## Rollback

Promote the previous Ready production deployment to Production; do not push a
revert commit for an infrastructure-only failure. Commands are in
[`docs/deployment.md`](../../docs/deployment.md).

## Hazards

- **Vercel builds every file under `api/` as a function.** The build currently
  includes `api/proxy.test.js` as a second, unused function. Harmless but
  unnecessary; exclude it with `.vercelignore` if the function surface matters.
- **No build step means what is in the repo is what is served.** `outputDirectory`
  is the repository root, so `AGENTS.md`, `docs/`, `src/`, and `dev-docs/` are
  publicly reachable on the production host (the GitHub repository is public, so
  this exposes nothing new). Add a `.vercelignore` if that surface should shrink.
- **The proxy caps responses at 1 MiB** and only allows read-only paths; see
  [../integration.md](../integration.md).
- **Git integration is the deploy path.** A local `vercel --prod` deployment
  works but can drift from `main`; prefer pushing, and verify the alias.
- **Public upstreams are not ours.** Outages or pruning in cosmos.directory or
  community nodes look like query failures; the status dots only test
  reachability.
