# Deployment

Production is live at <https://the-queriooor.vercel.app> on Vercel project
`craw/the-queriooor`, connected to `github.com/Cordtus/the-queriooor`. There is no
build step; Vercel serves the repository root and deploys `api/proxy.js` as a
function.

Status and topology are recorded in
[`dev-docs/operations/running-state.md`](../dev-docs/operations/running-state.md).

## Normal release

```bash
yarn install          # first time only
yarn test
git push origin main  # triggers a Vercel production deployment
```

The push is the release. The Vercel Git integration creates the deployment
(`vercel[bot]` in the deployment list). Watch it with:

```bash
vercel ls the-queriooor
```

## Verify a release

```bash
# Page is served
curl -sS -o /dev/null -w '%{http_code}\n' https://the-queriooor.vercel.app/

# The deployed content includes the release (adjust the marker to the change)
curl -sS https://the-queriooor.vercel.app/ | grep -c 'id="networkSelect"'

# Proxy function answers a read-only RPC path
curl -sS 'https://the-queriooor.vercel.app/api/proxy?url=https%3A%2F%2Frpc.cosmos.directory%2Fosmosis%2Fstatus' \
  | head -c 120
```

Then open the deployment URL and run one query against the default network.

## Manual deploy (Git integration unavailable)

```bash
vercel link --yes --project the-queriooor --scope craw
vercel --prod --yes
```

A manual deployment is not tied to a commit. Push the matching commit to `main`
afterwards, otherwise the next push redeploys different content.

## Rollback

```bash
vercel ls the-queriooor          # find the last known-good production deployment
vercel rollback <deployment-url> --yes
```

The dashboard equivalent is Deployments → select the previous Ready production
deployment → **Promote to Production**. Re-run the verify commands after the
alias moves.

## Notes

- No environment variables or secrets are required.
- `api/` contains `proxy.test.js`, so Vercel also builds it as an unused
  function. Harmless; see the running-state hazards.
- `vercel.json` sets `outputDirectory` to the repository root and allows CORS on
  `/api/*`. Only `api/proxy.js` is intended to serve traffic.
