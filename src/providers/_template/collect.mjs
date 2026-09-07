// Report what the provider told you. The core derives the rest.

export async function collect(ctx) {
  const key = await ctx.secrets.get("apiKey");
  if (!key) throw Object.assign(new Error("no api key configured"), { code: "auth_missing" });

  const data = await ctx.http.getJson("https://example.com/api/usage", {
    headers: { authorization: `Bearer ${key}` },
    timeoutMs: 8000,
  });

  return {
    meters: {
      credits: {
        unit: "currency",
        currency: "USD",
        used: data.used,
        total: data.limit,
        confidence: "exact",
        window: { kind: "calendar", seconds: 30 * 86400, resetAt: data.renews_at ?? null },
      },
    },
  };
}
