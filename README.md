# Pubky Shop MCP

A read-only [MCP](https://modelcontextprotocol.io) server for the **Pubky Marketplace**
(`shop.pubky.app`). Any MCP-capable agent — Claude, ChatGPT, a custom bot — can browse
listings, shops, reviews, reputation and drops through the public index, and hand a person a
link to buy. It signs in as nobody, holds no keys, and identifies itself on every request.

Why this exists: Amazon cut off Meta's shopping agent because it never asked, didn't identify
itself and captured credentials. On Pubky a seller owns their shop, every participant is a
public key, and this server is the polite front door: it reads only public, signed records
and says who it is (`User-Agent: pubky-shop-mcp/0.1.0 (MCP; read-only; …)`).

## Tools

| Tool | What it does |
|---|---|
| `about_pubky_shop` | What the marketplace is, what an agent can and cannot do. Read first. |
| `search_listings` | Browse listings with index filters (seller, category, condition, sale format, state, price range + currency, country, tags, sorting) and an optional local text match. |
| `get_listing` | Full listing: price, condition, fulfillment, media, shop link, how a person buys. |
| `get_shop` | A seller's shop record and a page of their listings. |
| `get_seller_reputation` | Attested-review summary for a seller (or "no reviews yet"). |
| `get_reviews` | Reviews for a seller or for one listing. |
| `get_listing_tags` | Community tags on a listing. |
| `list_drops` | Timed drops by owner or time window (upcoming / live / ended, as estimated by the index). |
| `get_drop` | One drop as indexed. |

Writes (cart, offers, bids, checkout) are deliberately absent. Those need a signed-in
identity, and the plan for agents there is a delegated seat with a spend cap, not a shared
session. See `../agentic-commerce-ideas.md`.

## Data sources

- Index: the production Nexus at `https://nexusd-production-95a0.up.railway.app` —
  `/v0/stream/listings`, `/v0/listing/{seller}/{id}`, `/v0/shop/{seller}` (+`/reviews`,
  `/reputation`), `/v0/stream/drops`, `/v0/drop/{owner}/{id}`. All public, no auth.
- Links point at `https://shop.pubky.app/marketplace/...`.

Override with `PUBKY_NEXUS_URL`, `PUBKY_SHOP_URL`, `PUBKY_AGENT_NAME`.

Prices: Bitcoin listings are shown in sats; fiat in major units. Drop "live" buckets are
time-window estimates from the index; the shop page is the authority for stock and claims.

## Run

```
npm install
npm run smoke        # talks JSON-RPC to the server and prints real results
```

### Claude Code

```
claude mcp add pubky-shop -- node C:/Users/Lenovo/Desktop/vibes/pubky-shop-mcp/src/server.mjs
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "pubky-shop": { "command": "node", "args": ["C:/Users/Lenovo/Desktop/vibes/pubky-shop-mcp/src/server.mjs"] }
  }
}
```

Then ask: "What's for sale on the Pubky shop under 20,000 sats?" or "Show me auctions ending
soon" or "Is this seller any good?" with a seller's Pubky ID.

## Roadmap

1. Seller tools behind a session token, via John's `@bitcoinerrorlog/pubky-shop` SDK
   (listings, orders, inventory, events, webhooks) — the seller-side half of agentic commerce.
2. A seller-published agent policy (`agents may browse / offer / buy`) once the specs have it.
3. Buyer actions only through a delegated agent seat with a spend cap (proposal, not built).
