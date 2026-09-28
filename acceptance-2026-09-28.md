# Acceptance test — llms.txt, 28 Sep 2026

Per the brief: a fresh agent with only a fetch tool, no prior knowledge of the shop or its hosts,
given the single URL of the draft guide (the raw copy of `llms.txt` in this repo, standing in for
`https://shop.pubky.app/llms.txt`), asked three questions against production.

Result: all three answered correctly, with working links. The agent dropped the three auctions
whose end dates had passed, flagged the test listings, checked the attestor key, and read the
reviewed listing before judging the seller. Its "document gaps" list drove the edits in the same
commit (auction price meaning, reviews shape, `state=active` rule, histogram order, unvalidated
`country_code`, the empty-auctions case, the User-Agent line).

Process note from the agent: the summarising fetch tool would not return the guide verbatim, so
the document itself was pulled once with `curl -s`; all index responses came back as clean JSON.
It could not set a User-Agent header with either tool.

## 1. "What's for sale under 20,000 sats?"

Fetched: `INDEX/v0/stream/listings?state=active&currency=BTC&max_price=0.0002&limit=30`

Three active Bitcoin-priced listings, all at 1,000 sats; only one is a real item:

1. "pebbles" — 1,000 sats, fixed price, condition good, category art, ships physically, seller-entered country "UK".
   https://shop.pubky.app/marketplace/listing/f4konhpk8wdubqh9zk5n9cpy76m7sf6jsn6osmc9x9kywijxid7y/663706c92bff46c8bf770c608715e46f
2. "Canary test — do not buy" — test listing; the title says not to buy it.
   https://shop.pubky.app/marketplace/listing/adjnbqbam6b6nkcjp8iarxorjmqycxo6cwfzxspeyxaqjxmnjdcy/5d277f7f913f48659cbc6822362c8deb
3. "Cutover test 3 — do not buy" — test listing.
   https://shop.pubky.app/marketplace/listing/n3pfudgxncn8i1e6icuq7umoczemjuyi6xdfrfczk3o8ej3e55my/cd1024aee1064fc2aee822f9bfb1a753

Applied: the test-listing rule. Observed: `country_code: "UK"` is not ISO alpha-2 (GB), so a
`country=` filter would miss it.

## 2. "Which auctions are ending soon?"

Fetched: `INDEX/v0/stream/listings?state=active&sorting=ends_at&order=ascending&limit=30`
(cross-checked with `sale_format=auction`; same three rows)

All three auctions have `auction_ends_at` in the past (29 Aug, 17 Sep, 20 Sep) while still
`state: active`; one is a test listing. Answer given: none — no auctions are open for bidding
right now; browse https://shop.pubky.app/marketplace for anything newer.

Applied: "ended auctions can still be state=active"; test-listing rule; current bid not in index.

## 3. "Is this seller any good?" — gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo

Fetched: `/v0/shop/{id}/reputation`, `/v0/shop/{id}?limit=30&skip=0`, `/v0/shop/{id}/reviews`,
and `/v0/stream/listings?seller_id={id}` as a cross-check.

Reputation: 1 review, verified, 5.0 average, attestor = the production Shop attestor named in the
guide, so it counts as marketplace-attested. Shop "Tar & Feathers" (US), created 22 Sep, ships
within three business days, 30-day returns. Listings: "American Thugs test image" ($2.50, active,
pickup only, self-described test item) and "Chainsaw Man shirt" ($10.00, paused). The one review
("Very happy with the purchase", 5/5) is on the test-item listing.

Answer given: nothing negative on record, but almost nothing to go on — one attested 5-star
review on a $2.50 self-declared test item, a six-day-old shop, one other listing paused. Not
enough to call the seller good or bad. Shop page:
https://shop.pubky.app/marketplace/shop/gujx6qd8ksydh1makdphd3bxu351d9b8waqka8hfg6q7hnqkxexo

Applied: attestor rule (passes); "no reviews yet" rule did not trigger; test-listing rule
applied indirectly.

## Document gaps reported by the agent, and what was done

| # | Gap | Done |
|---|---|---|
| 1 | Recipe 2: no definition of "soon" and no instruction when every auction has ended | Added: say the end time; if nothing ends in the future, say none are open and offer the marketplace link |
| 2 | Recipe 2: `price_amount_minor` unlabelled for auctions | Added: it is the starting price (specs `primary_price()`), not the current bid |
| 3 | `sorting=ends_at` vs `sale_format=auction` | Added: both list auctions; `ends_at` orders by end time |
| 4 | Reputation whose only review is on a test-item listing | Added: one review is thin; read the reviewed listing; a review on a self-declared test item counts for little |
| 5 | Shop view and seller stream include non-active listings | Added: shop view is all states; `state=active` on the stream |
| 6 | Embedded `reputation` / `listing_reputation` shortcut lacks `attestors` | Added, with the caveat |
| 7 | `/reviews` shape not shown | Added a trimmed real response |
| 8 | `histogram` order not stated | Added: index 0 = 1 star (from the index source) |
| 9 | `country_code` not validated ("UK") | Added warning |
| 10 | User-Agent not settable from a plain fetch tool | Softened: send one if you can; requests without one are fine |
| 11 | Omitting `state` returns all states | Added as a rule (verified: first page had 29 active + 1 paused) |
