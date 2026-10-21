import { getEnv } from "./env.js";
import { forceRefreshToken, getAccessToken } from "./token.js";

export function stripGraphQLComments(query: string): string {
  let out = query.replace(/"""[\s\S]*?"""/g, "");
  out = out.replace(/#[^\n]*/g, "");
  return out;
}

export function assertReadOnlyQuery(query: string): void {
  const stripped = stripGraphQLComments(query);
  if (/^\s*mutation\b/m.test(stripped)) {
    throw new Error("Dispatch backend is read-only: mutations are blocked.");
  }
  if (/^\s*subscription\b/m.test(stripped)) {
    throw new Error("Dispatch backend is read-only: subscriptions are blocked.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Forward a GraphQL query to Shopify Admin API. Mutations never leave this process.
 */
export async function proxyShopifyGraphql(body: {
  query: string;
  variables?: Record<string, unknown>;
}): Promise<{ status: number; payload: unknown }> {
  assertReadOnlyQuery(body.query);

  const env = getEnv();
  const endpoint = `https://${env.SHOPIFY_STORE_DOMAIN}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`;

  let tokenRefreshed = false;
  let http5xxAttempts = 0;

  while (true) {
    const token = await getAccessToken();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: body.query,
        variables: body.variables,
      }),
    });

    if (res.status === 401 && !tokenRefreshed) {
      tokenRefreshed = true;
      await forceRefreshToken();
      continue;
    }

    if (res.status >= 500 && res.status < 600 && http5xxAttempts < 2) {
      http5xxAttempts += 1;
      await sleep(500 * http5xxAttempts);
      continue;
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      payload = { errors: [{ message: "Invalid JSON from Shopify" }] };
    }

    return { status: res.status, payload };
  }
}
