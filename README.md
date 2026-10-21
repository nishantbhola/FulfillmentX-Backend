# Dispatch Backend

Small **read-only** proxy that holds Shopify credentials. The Next.js dashboard never stores `SHOPIFY_CLIENT_SECRET` when this is used.

```
Browser → Next.js (Dispatch) → Backend (secrets) → Shopify Admin GraphQL
```

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/health` | none | Liveness |
| `GET` | `/v1/health` | `X-Dispatch-Key` | Token + scopes status |
| `POST` | `/v1/graphql` | `X-Dispatch-Key` | Proxy GraphQL **queries** only |

Mutations and subscriptions are rejected before any Shopify call.

## Setup

```bash
cd backend
cp .env.example .env.local
# Fill SHOPIFY_* and DISPATCH_API_KEY
pnpm install
pnpm dev
```

Runs on `http://localhost:8787` by default.

## Dispatch app env

In the Next.js `.env.local` (no Shopify secret):

```bash
DISPATCH_BACKEND_URL=http://localhost:8787
DISPATCH_BACKEND_KEY=<same as DISPATCH_API_KEY>
# Leave SHOPIFY_CLIENT_ID / SECRET empty when using the backend
```
