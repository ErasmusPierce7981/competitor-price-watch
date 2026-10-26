import assert from "node:assert/strict";
import { decidePrice } from "./price_watch.ts";

const item = { sku: "creator-mic", name: "Creator microphone", ourPrice: 89, competitorUrl: "https://example.com/catalog/creator-mic" };
assert.deepEqual(decidePrice(item, 79), { sku: "creator-mic", competitorPrice: 79, ourPrice: 89, action: "review" });
assert.equal(decidePrice(item, 99).action, "hold");
console.log("price decision test passed");
