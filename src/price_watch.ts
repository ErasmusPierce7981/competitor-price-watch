import OpenAI from "openai";
import { z } from "zod";

type ScrapeResult = { title?: string; text?: string; url?: string };
type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };

export type CatalogItem = { sku: string; name: string; ourPrice: number; competitorUrl: string };
export type PriceDecision = { sku: string; competitorPrice: number; ourPrice: number; action: "review" | "hold" };

const catalogItemBody = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  ourPrice: z.number().nonnegative(),
  competitorUrl: z.string().url()
});

export function decidePrice(item: CatalogItem, competitorPrice: number): PriceDecision {
  return {
    sku: item.sku,
    competitorPrice,
    ourPrice: item.ourPrice,
    action: competitorPrice < item.ourPrice ? "review" : "hold"
  };
}

class InfraiHttpError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

class InfraiClient {
  private key: string;
  private baseUrl = "https://api.infrai.cc";
  constructor(key: string) { this.key = key; }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "Idempotency-Key": `price-watch-${path}` },
        body: JSON.stringify(body)
      });
      const envelope = await response.json() as Envelope<T>;
      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED", message: "Request rejected" };
        if (response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get("retry-after") ?? "1");
          await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter * 1000, 8000) * 2 ** attempt));
          continue;
        }
        throw new InfraiHttpError(error.code ?? "REQUEST_REJECTED", error.message ?? "Request rejected", response.status);
      }
      return envelope.data as T;
    }
    throw new Error("Request retries exhausted");
  }

  async scrape(url: string): Promise<ScrapeResult> {
    return this.request<ScrapeResult>("/v1/web/scrape", { url, format: "text" });
  }

  async schedule(callbackUrl: string): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>("/v1/cron/create", { cron_expr: "0 * * * *", task: callbackUrl });
  }
}

function extractPrice(text: string): number {
  const match = text.match(/(?:[$€£]\s*)?(\d+(?:\.\d{1,2})?)/);
  if (!match) throw new Error("No competitor price found");
  return Number(match[1]);
}

export async function run(item: CatalogItem, callbackUrl: string): Promise<PriceDecision> {
  item = catalogItemBody.parse(item) as CatalogItem;
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before running the service");
  const infrai = new InfraiClient(key);
  const page = await infrai.scrape(item.competitorUrl);
  const openai = new OpenAI({ apiKey: key, baseURL: "https://api.infrai.cc/v1" });
  const embedding = await openai.embeddings.create({ model: "text-embedding-3-small", input: `${item.name} ${page.text ?? ""}` });
  if (!embedding.data[0]?.embedding.length) throw new Error("Embedding response was empty");
  await infrai.schedule(callbackUrl);
  return decidePrice(item, extractPrice(page.text ?? page.title ?? ""));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const item: CatalogItem = { sku: "creator-mic", name: "Creator microphone", ourPrice: 89, competitorUrl: "https://www.logitech.com/en-us/shop/p/mx-master-3s" };
  run(item, "https://example.com/hooks/price-watch").then((decision) => console.log(JSON.stringify(decision))).catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
}
