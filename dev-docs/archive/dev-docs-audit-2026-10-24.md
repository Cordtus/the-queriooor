# Dev-docs adoption audit — 2026-10-24

Migration record for introducing Dev Docs Discipline. Scope: the single
repository `the-queriooor` (no multi-repo workspace), excluding `node_modules`
and generated CLI output (`transactions-*.json`, `filtered-txs-*.json`).

## Baseline

- Baseline commit: `bb845f3` (`main`, before the 2026-10-24 UI change).
- Disposable copy: `/tmp/opencode/baseline-the-queriooor-2026-10-24/` and
  `baseline-the-queriooor-2026-10-24.tar.gz` (AGENTS.md, README.md, docs/, api/,
  index.html, package.json, vercel.json, dev-server.js, .github/).
- No `dev-docs/` existed. Existing docs: `README.md`, `docs/query-capabilities.md`,
  `docs/testing.md`, `AGENTS.md`.

## Pass one — inventory

| Area | Responsibility | Existing docs | Evidence | Status before | Remediation |
|---|---|---|---|---|---|
| CLI/library (`src/`) | Read-only RPC/LCD query tools, parsing, fees, whale watch | README module table; `docs/query-capabilities.md` | Code + colocated tests | Accurate but no engineering map of relationships | `dev-docs/architecture.md`, onboarding |
| Explorer (`index.html`) | Browser query builder, results, endpoint selection | README §Explorer UI; `docs/testing.md` §Explorer UI | Code + test-covered endpoint helpers | Behaviour documented; architecture and couplings absent | `architecture.md`, `data-model.md` |
| Proxy (`api/proxy.js`) | Read-only CORS proxy, local and production | README paragraph; `api/proxy.test.js` | Code + 20+ proxy tests | Validation rules only in code | `integration.md` (boundary + change protocol) |
| Dev server (`dev-server.js`) | Static server mounting the same proxy | README one line | Code | Sufficient for users, not for engineers | `architecture.md` |
| Delivery (`vercel.json`, `.github/workflows/ci.yml`) | Vercel static+function deploy, GitHub Actions tests | None | `vercel ls`, `vercel inspect`, GitHub deployments API | Live but undocumented | `docs/deployment.md`, `operations/running-state.md` |
| Registry integration (`chains.cosmos.directory`) | Chain catalogue for endpoint selection | README paragraph | Code | Partially documented | `integration.md`, `data-model.md` |

Material relationships: explorer → proxy → public Cosmos endpoints; explorer →
directory registry (browser-direct); CLI → public endpoints (no proxy); Vercel
Git integration → production alias. Explorer and CLI share decoding rules
without sharing code (drift risk).

## Pass two — remediation

| Item | Action | Evidence |
|---|---|---|
| Missing index | Created `dev-docs/README.md` with links to every maintained doc | Structure checker clean |
| Missing roles | Added architecture, data (model), integration, operations docs | `--report --require-roles` clean |
| Running state absent | Created `operations/running-state.md`; exact commands in `docs/deployment.md` | `vercel ls`, `vercel inspect`, GitHub deployments |
| Project map drift | Rewrote root `AGENTS.md` as a project map + working rules, pointing at dev-docs | Map under 120 lines; project-level detail moved |
| Undocumented deploy | Created `docs/deployment.md` and linked from README and dev-docs | Deploy path verified against Vercel metadata |
| Dated record | Created `logs/2026-10.md` | This session recorded |

## Verification

```text
python3 .../check_dev_docs.py --report --require-roles --dev-docs dev-docs
=> no output (no broken links, unlisted docs, role gaps, or map violations)
```

`yarn test` passes (35 tests) after the code change that triggered adoption.

## Accepted limitations / unresolved

- The explorer deliberately duplicates CLI parsing helpers; recorded as a
  coupling in `architecture.md` rather than solved by adding a build step.
- Vercel builds `api/proxy.test.js` as an unused second function (observed in
  `vercel inspect`); recorded as a hazard, not changed in this pass.
- No monitoring or alerting exists; the running-state record says so.
- There is no separate integration counterpart repository; `integration.md`
  covers external upstreams and the proxy boundary only.
