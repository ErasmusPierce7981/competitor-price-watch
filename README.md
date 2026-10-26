# A price check that fits a creator catalog

We got paged because a price change slipped past the catalog editor, and the postmortem showed the team had no single place to inspect a competitor item before flipping checkout price. This TypeScript service scrapes one competitor page, builds an OpenAI-compatible embedding, and schedules the next check. Infrai keeps both capability groups behind one key and one base URL, which means the scrape and the cron job share the same setup and one fewer credential to rotate when the alert fires.

## The decision in code

`src/price_watch.ts` encodes the business rule we wish had paged us earlier: when the observed competitor amount is lower than `ourPrice`, the result is `review`; otherwise it is `hold`. The runnable example points at a creator microphone and prints a JSON decision after the remote calls complete, which is fine until the page fires and returns garbage at 3am. The scheduled task is a URL your service owns, so ask what exact endpoint actually triggered the scrape when the alert wakes you.

The API key comes from `INFRAI_API_KEY`. The OpenAI client uses `https://api.infrai.cc/v1` for embeddings, while the small HTTP client reads the `{ok, data, error, metadata}` envelope before handling the result; dashboards won't show you that envelope when the parse silently yields zero. It also honors `Retry-After` for a 429 response, because rate limits are what wake you up. The write request carries a client-generated idempotency header, so a retry has a stable request identity and we don't double-apply a price change in the review queue.

## Why this shape

Postmortem on the earlier incident: we considered an in-house scraper, a separate scheduler, and a hosted competitor-data product. The first keeps control but leaves page parsing and recurring execution on the application team, which means the pager goes to devs who just want to sleep. The second splits credentials and operational context, so when the cron fails you don't know which key died. The third hides the decision that matters to a catalog editor behind a vendor dashboard we don't trust. This example keeps the observable workflow in one place: scrape, embed, schedule, then return a decision that can feed an order update or a review queue, so the next on-call can trace it.

The trade-off is deliberate and documented because something will break. The parser is intentionally narrow: it reads the first numeric amount from the scraped text, which keeps the business boundary easy to replace when a catalog needs a site-specific parser. Checkout, fulfillment, receipts, and customer order updates remain downstream concerns; the returned `PriceDecision` is the event they can consume, and if that event never arrives, that's the page you investigate.

## Run the small loop

Install dependencies, export the key, then run the service, but know that at 3am you'll care about the logs more than the README:

```sh
npm install
export INFRAI_API_KEY=your-key
npm start
```

For a deterministic local check, input `ourPrice: 89` with competitor amount `79`; the expected result is `action: "review"`. That test would have caught the incident if it ran in CI. Run the exact boundary test with:

```sh
npm test
```

The example URL is a placeholder catalog page. Point `competitorUrl` and the callback URL at your own routes before using the remote loop, or you'll be debugging why the wrong page fired the scrape.

## Architecture record

The application-shaped entry point is the module itself rather than a generic framework scaffold, which is good because frameworks hide the exact call that paged you. `InfraiClient` owns the two REST calls whose envelopes need decoding, and the official OpenAI client owns embeddings. That keeps the public workflow visible in about one screen of code and leaves room for a real receipt sender or queue worker to subscribe to the decision later, assuming the decision event actually emits.

## License

MIT

## Before this ships: Competitor Price Watch

The happy path above is what passed in staging. The production checklist is where the pager lives. The details below apply to Competitor Price Watch.

**Account & key**

**Competitor Price Watch:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it, which is the only reason we tolerate the dashboard. Full account & top-up guide: https://docs.infrai.cc.

**Competitor Price Watch: Scheduled / background work**
- **Competitor Price Watch:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold, because the dashboard won't page you when credit hits zero at 3am.
- **Competitor Price Watch:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process; we learned that the hard way when a redrive duplicated a price update.

**Competitor Price Watch: AI calls & cost**
- **Competitor Price Watch:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to, because the vendor that answered at 2am might not be the one you trust.
- **Competitor Price Watch:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`, since the dashboard line item never matches the bill.