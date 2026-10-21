import { serve } from "@hono/node-server";
import { existsSync, readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import { getEnv } from "./env.js";
import { assertReadOnlyQuery, proxyShopifyGraphql } from "./shopify.js";
import { getTokenMeta } from "./token.js";

function loadDotEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

loadDotEnv();

const env = getEnv();

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

const app = new Hono();

const origins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (origins.length > 0) {
  app.use(
    "*",
    cors({
      origin: origins,
      allowHeaders: ["Content-Type", "X-Dispatch-Key"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );
}

app.get("/", (c) =>
  c.json({
    name: "dispatch-backend",
    readOnly: true,
    endpoints: ["GET /health", "GET /v1/health", "POST /v1/graphql"],
  }),
);

/** Unauthenticated liveness (no secrets). */
app.get("/health", (c) => c.json({ ok: true }));

app.use("/v1/*", async (c, next) => {
  const key = c.req.header("X-Dispatch-Key") ?? "";
  if (!key || !safeEqual(key, env.DISPATCH_API_KEY)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

app.get("/v1/health", async (c) => {
  const token = await getTokenMeta();
  return c.json({
    ok: token.ok,
    storeDomain: env.SHOPIFY_STORE_DOMAIN,
    apiVersion: env.SHOPIFY_API_VERSION,
    scopes: token.scope,
    tokenExpiresInMs: token.expiresInMs,
    error: token.error ?? null,
    readOnly: true,
  });
});

const graphqlBody = z.object({
  query: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).optional(),
});

app.post("/v1/graphql", async (c) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = graphqlBody.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "Invalid body", issues: parsed.error.issues }, 400);
  }

  try {
    assertReadOnlyQuery(parsed.data.query);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Read-only violation" },
      400,
    );
  }

  try {
    const { status, payload } = await proxyShopifyGraphql(parsed.data);
    return c.json(payload, status as 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    `[dispatch-backend] read-only proxy on http://localhost:${info.port}`,
  );
  console.log(
    `[dispatch-backend] store=${env.SHOPIFY_STORE_DOMAIN} api=${env.SHOPIFY_API_VERSION}`,
  );
});
