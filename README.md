# IPO Tracker Website

A static IPO monitoring dashboard for A-share new listings. The app separates BSE cash subscriptions from Shanghai/Shenzhen market-cap subscriptions, and includes a searchable IPO database.

## Data

- Source: EastMoney public data center APIs.
- Window: recent 3 months by default.
- Incremental mode: uses the previous `market_time - 14 days` overlap window.
- Field policy: source requests use `columns=ALL`; normalized CSV files keep core fields and all visible raw fields with prefixes.

Generated data is not committed. The build pipeline should run the data update before building the static site.

## Commands

```sh
npm install
npm run data:update
npm run dev
```

Build:

```sh
npm run data:update
npm run build
```

Force a rolling 3-month refresh:

```sh
npm run data:full
```

## Cloudflare Pages

Recommended settings:

```text
Build command: npm run data:update && npm run build
Build output directory: dist
Node.js version: 20 or 22
```

The included GitHub Actions workflow can deploy directly to Cloudflare Pages on push, manual runs, and a daily schedule. Configure these repository secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

The token needs permission to deploy Cloudflare Pages for this account. If the secrets are not configured, the workflow exits cleanly without deploying.

## Generated Files

Ignored local outputs:

- `data/`
- `public/data/`
- `dist/`
- `handoff/`
- `output/`
