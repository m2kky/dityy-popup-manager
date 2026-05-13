# Dityy Popup Manager Coolify Deploy

## App

- Domain: `https://popup.muhammedmekky.com`
- Port: `3000`
- Dockerfile: `Dockerfile`
- Health check path: `/healthz`
- Persistent storage mount: `/data`

## Environment Variables

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=file:/data/dev.sqlite
SHOPIFY_APP_URL=https://popup.muhammedmekky.com
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SCOPES=
```

Get the Shopify values locally:

```powershell
shopify app env show --config dityy-popup-manager
```

## Shopify Deploy

After the Coolify app is live and `https://popup.muhammedmekky.com/healthz` returns `ok`, deploy the app configuration and extension:

```powershell
shopify app deploy --config dityy-popup-manager --allow-updates
```

Then install the app on the store and enable the theme app embed:

`Online Store -> Themes -> Customize -> App embeds -> Dityy Popup Embed`

## Notes

- SQLite is stored under `/data`, so the Coolify persistent volume is required.
- Run one app instance when using SQLite.
- If the app grows to analytics/events, move `DATABASE_URL` to Postgres.
