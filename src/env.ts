import { z } from "zod";

function normalizeStoreDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\/$/, "");
}

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  DISPATCH_API_KEY: z.string().min(16),
  SHOPIFY_STORE_DOMAIN: z.string().min(1),
  SHOPIFY_CLIENT_ID: z.string().min(1),
  SHOPIFY_CLIENT_SECRET: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().min(1).default("2026-10"),
  CORS_ORIGINS: z.string().optional().default(""),
});

export type BackendEnv = z.infer<typeof schema> & {
  SHOPIFY_STORE_DOMAIN: string;
};

let cached: BackendEnv | undefined;

export function getEnv(): BackendEnv {
  if (cached) return cached;

  const parsed = schema.safeParse({
    PORT: process.env.PORT,
    DISPATCH_API_KEY: process.env.DISPATCH_API_KEY,
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
  });

  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(`Invalid backend env:\n${lines.join("\n")}`);
  }

  cached = {
    ...parsed.data,
    SHOPIFY_STORE_DOMAIN: normalizeStoreDomain(parsed.data.SHOPIFY_STORE_DOMAIN),
  };
  return cached;
}
