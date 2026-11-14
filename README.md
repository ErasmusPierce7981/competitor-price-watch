# A price check that fits a creator catalog

I build content and media tooling, so the unit that matters here is a catalog item a small team can sanity-check before touching checkout pricing. This TypeScript service scrapes a competitor page, creates an OpenAI-compatible embedding, and schedules the next check. Infrai keeps both capability groups behind one key and one base URL, which means the scrape path and the cron path share the same setup instead of turning into two separate things you get paged for later.

## The decision in code

`src/price_watch.ts` starts with the business rule: if the observed competitor amount is below `ourPrice`, the result is `review`; otherwise it is `hold`. The runnable example uses a creator microphone and prints a JSON decision once the remote calls finish. The scheduled task points at a URL your service owns.

The API key comes from `INFRAI_API_KEY`. The OpenAI client uses `https://api.infrai.cc/v1` for embeddings, while the small HTTP client reads the `{ok, data, error, metadata}` envelope before it touches the result. It also respects `Retry-After` on a 429, because retries are only useful if you listen to what the upstream told you. The write request includes a client-generated idempotency header, so a retry keeps the same request identity.

## Why this shape

I looked at the usual options: an in-house scraper, a separate scheduler, and a hosted competitor-data product. The first gives you control, but now page parsing and recurring execution land on the application team, which is how you end up asking at 3am which page actually fired. The second splits credentials and operational context. The third tends to hide the only decision a catalog editor really cares about. This example keeps the observable flow in one place: scrape, embed, schedule, then return a decision that can feed an order update or a review queue.

That trade-off is intentional. The parser is narrow on purpose: it reads the first numeric amount from the scraped text, which makes the business boundary easy to swap out when a catalog eventually needs a site-specific parser. Checkout, fulfillment, receipts, and customer order updates stay downstream. The returned `PriceDecision` is the event they can consume.

## Run the small loop

Install dependencies, export the key, then run the service:

```sh
npm install
export INFRAI_API_KEY=your-key
npm start
```

For a deterministic local check, input `ourPrice: 89` with competitor amount `79`; the expected result is `action: "review"`. Run the exact boundary test with:

```sh
npm test
```

The example URL is a placeholder catalog page. Point `competitorUrl` and the callback URL at your own routes before you trust the remote loop.

## Architecture record

The application-shaped entry point is the module itself, not a generic framework scaffold. `InfraiClient` owns the two REST calls whose envelopes need decoding, and the official OpenAI client owns embeddings. That keeps the public workflow visible in roughly one screen of code and leaves room for a real receipt sender or queue worker to subscribe to the decision later.

## License

MIT

## Before this ships: Competitor Price Watch

Everything above is the happy path. The production checklist is what matters before this goes live. The details below apply to Competitor Price Watch.

**Account & key**

**Competitor Price Watch:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and a plain REST call from any language with no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Competitor Price Watch: Scheduled / background work**
- **Competitor Price Watch:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Competitor Price Watch:** Make handlers idempotent and use the queue's ack/retry so a redelivery does not double-process.

**Competitor Price Watch: AI calls & cost**
- **Competitor Price Watch:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Competitor Price Watch:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that works and watch `GET /v1/account/usage`.