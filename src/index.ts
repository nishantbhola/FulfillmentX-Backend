import { existsSync, readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
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

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.header("X-Dispatch-Key") ?? "";
  if (!key || !safeEqual(key, env.DISPATCH_API_KEY)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const origins = env.CORS_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (origins.length > 0) {
  app.use(
    cors({
      origin: origins,
      allowedHeaders: ["Content-Type", "X-Dispatch-Key"],
      methods: ["GET", "POST", "OPTIONS"],
    }),
  );
}

app.get("/", (_req, res) => {
  res.json({
    name: "dispatch-backend",
    framework: "express",
    readOnly: true,
    endpoints: ["GET /health", "GET /v1/health", "POST /v1/graphql"],
  });
});

/** Unauthenticated liveness (no secrets). */
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/v1/health", requireApiKey, async (_req, res) => {
  const token = await getTokenMeta();
  res.json({
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

app.post("/v1/graphql", requireApiKey, async (req, res) => {
  const parsed = graphqlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }

  try {
    assertReadOnlyQuery(parsed.data.query);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Read-only violation",
    });
    return;
  }

  try {
    const { status, payload } = await proxyShopifyGraphql(parsed.data);
    res.status(status).json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: message });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(env.PORT, () => {
  console.log(
    `[dispatch-backend] express read-only proxy on http://localhost:${env.PORT}`,
  );
  console.log(
    `[dispatch-backend] store=${env.SHOPIFY_STORE_DOMAIN} api=${env.SHOPIFY_API_VERSION}`,
  );
});
