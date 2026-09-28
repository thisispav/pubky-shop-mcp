#!/usr/bin/env node
// Pubky Shop MCP — read-only tools over the public Pubky Marketplace index (Nexus).
// Any MCP-capable agent can browse listings, shops, reputation and drops.
// It never signs in, never holds keys, and identifies itself with a User-Agent.

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const NEXUS = (process.env.PUBKY_NEXUS_URL || 'https://nexusd-production-95a0.up.railway.app').replace(/\/$/, '');
const SHOP = (process.env.PUBKY_SHOP_URL || 'https://shop.pubky.app').replace(/\/$/, '');
const AGENT_NAME = process.env.PUBKY_AGENT_NAME || 'pubky-shop-mcp';
const VERSION = '0.1.0';
const USER_AGENT = `${AGENT_NAME}/${VERSION} (MCP; read-only; +https://github.com/thisispav/pubky-shop-mcp)`;

// ---- HTTP -------------------------------------------------------------------

async function nexus(path, params = {}) {
  const url = new URL(NEXUS + path);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = typeof body === 'object' && body?.error ? body.error : text.slice(0, 200);
    const err = new Error(`${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---- Formatting -------------------------------------------------------------

const listingUrl = (sellerId, listingId) => `${SHOP}/marketplace/listing/${sellerId}/${listingId}`;
const shopUrl = (sellerId) => `${SHOP}/marketplace/shop/${sellerId}`;
const dropUrl = (ownerId, dropId) => `${SHOP}/marketplace/drop/${ownerId}/${dropId}`;

function formatPrice(minor, currency, exponent) {
  if (minor == null) return null;
  if (currency === 'BTC' || currency === 'SAT') {
    const sats = currency === 'BTC' ? Number(minor) * (exponent === 8 ? 1 : 10 ** (8 - (exponent ?? 8))) : Number(minor);
    return `${Math.round(sats).toLocaleString('en-US')} sats`;
  }
  const major = Number(minor) / 10 ** (exponent ?? 2);
  return `${major.toFixed(exponent ?? 2)} ${currency}`;
}

function compactListing(l) {
  return {
    id: l.id,
    seller_id: l.owner_id,
    title: l.title,
    state: l.state,
    sale_format: l.sale_format,
    price: formatPrice(l.price_amount_minor, l.price_currency, l.price_exponent),
    price_raw: { amount_minor: l.price_amount_minor, currency: l.price_currency, exponent: l.price_exponent },
    condition: l.condition,
    category: l.category_id,
    fulfillment: l.fulfillment_methods,
    country: l.country_code,
    tags: l.tags,
    auction: l.sale_format === 'auction' ? {
      starts_at: l.auction_starts_at, ends_at: l.auction_ends_at,
      reserve: formatPrice(l.auction_reserve_price_minor, l.price_currency, l.price_exponent),
      buy_now: formatPrice(l.auction_buy_now_price_minor, l.price_currency, l.price_exponent),
    } : undefined,
    created_at: l.created_at,
    url: listingUrl(l.owner_id, l.id),
    record: l.uri,
  };
}

function fullListing(l) {
  return {
    ...compactListing(l),
    description: l.description,
    region: l.region,
    adult_only: l.adult_only,
    media_records: l.media_urls || [],   // pubky:// record URIs on the seller's homeserver; images render on the listing page

    updated_at: l.updated_at,
    revision: l.revision,
    how_to_buy: `Open ${listingUrl(l.owner_id, l.id)} and sign in with Pubky Ring. Checkout is seller-direct (Bitcoin via Paykit, PayPal). Agents cannot check out yet; a person completes the purchase.`,
  };
}

function compactDrop(d) {
  return {
    id: d.id, owner_id: d.owner_id, title: d.title, format: d.format,
    starts_at: d.starts_at, ends_at: d.ends_at,
    total_quantity: d.total_quantity, per_buyer_limit: d.per_buyer_limit, stock_display: d.stock_display,
    listing_ids: d.listing_ids, url: dropUrl(d.owner_id, d.id), record: d.uri,
  };
}

const ok = (data, note) => ({ content: [{ type: 'text', text: (note ? note + '\n\n' : '') + JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e.message || e}` }] });

// ---- Server -----------------------------------------------------------------

const server = new McpServer({ name: 'pubky-shop', version: VERSION });

const pubkyId = z.string().regex(/^[a-z0-9]{52}$/, '52-character z-base-32 Pubky ID');
const hexId = z.string().regex(/^[0-9a-f]{32}$/, '32-character hex id');

server.registerTool(
  'search_listings',
  {
    description:
      'Browse Pubky Marketplace listings from the public index. Filters run on the index (seller, category, condition, ' +
      'sale format, state, price range, country, community tags). `query` is a plain-text match on title and description ' +
      'applied locally over the fetched page, since the index has no full-text search. Returns compact listings with a ' +
      'link a person can open. Default state is active.',
    inputSchema: z.object({
      query: z.string().optional().describe('Words to match in title or description (local match)'),
      seller_id: pubkyId.optional(),
      category: z.string().optional().describe('kebab-case category id, e.g. apparel-shoes'),
      condition: z.enum(['new', 'like_new', 'excellent', 'good', 'fair', 'for_parts']).optional(),
      sale_format: z.enum(['fixed_price', 'auction']).optional(),
      state: z.enum(['active', 'paused', 'ended', 'removed']).default('active'),
      min_price: z.number().optional().describe('Major units of `currency`; requires currency'),
      max_price: z.number().optional().describe('Major units of `currency`; requires currency'),
      currency: z.string().optional().describe('Uppercase asset code, e.g. USD or SAT'),
      country: z.string().length(2).optional().describe('ISO-3166-1 alpha-2, e.g. HR'),
      tags: z.array(z.string()).optional().describe('Community tag labels; matches any'),
      sorting: z.enum(['timeline', 'ends_at']).optional().describe('ends_at = auctions only, by end time'),
      order: z.enum(['ascending', 'descending']).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      skip: z.number().int().min(0).default(0),
    }),
  },
  async ({ query, tags, limit, skip, ...filters }) => {
    try {
      const fetchLimit = query ? 100 : limit;
      const rows = await nexus('/v0/stream/listings', { ...filters, tags, limit: fetchLimit, skip });
      let list = Array.isArray(rows) ? rows : [];
      if (query) {
        const q = query.toLowerCase().split(/\s+/).filter(Boolean);
        list = list.filter((l) => { const hay = `${l.title} ${l.description}`.toLowerCase(); return q.every((w) => hay.includes(w)); }).slice(0, limit);
      }
      return ok({ count: list.length, listings: list.map(compactListing) },
        query ? `Text match applied locally over the latest ${fetchLimit} indexed listings.` : undefined);
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'get_listing',
  {
    description: 'Full details of one listing by seller Pubky ID and listing id, with media links, the shop URL and how a person buys it.',
    inputSchema: z.object({ seller_id: pubkyId, listing_id: hexId }),
  },
  async ({ seller_id, listing_id }) => {
    try { return ok(fullListing(await nexus(`/v0/listing/${seller_id}/${listing_id}`))); }
    catch (e) { return fail(e); }
  },
);

server.registerTool(
  'get_shop',
  {
    description: "A seller's shop record plus a page of their listings. 404 means the seller has not published a shop record (they may still have listings; use search_listings with seller_id).",
    inputSchema: z.object({ seller_id: pubkyId, limit: z.number().int().min(1).max(50).default(20), skip: z.number().int().min(0).default(0) }),
  },
  async ({ seller_id, limit, skip }) => {
    try {
      const shop = await nexus(`/v0/shop/${seller_id}`, { limit, skip });
      if (Array.isArray(shop?.listings)) shop.listings = shop.listings.map(compactListing);
      return ok({ url: shopUrl(seller_id), ...shop });
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'get_seller_reputation',
  {
    description: 'Reputation summary for a seller (counts, verified counts, star average) from attested reviews. Returns a clear "no reviews yet" when none are indexed.',
    inputSchema: z.object({
      seller_id: pubkyId,
      role: z.enum(['buyer_reviewing_seller', 'seller_reviewing_buyer']).default('buyer_reviewing_seller'),
    }),
  },
  async ({ seller_id, role }) => {
    try { return ok(await nexus(`/v0/shop/${seller_id}/reputation`, { role })); }
    catch (e) {
      if (e.status === 404) return ok({ seller_id, role, reviews: 0, note: 'No indexed reviews yet for this seller in this role.' });
      return fail(e);
    }
  },
);

server.registerTool(
  'get_reviews',
  {
    description: 'Attested reviews for a seller, or for one listing when listing_id is given.',
    inputSchema: z.object({
      seller_id: pubkyId, listing_id: hexId.optional(),
      role: z.enum(['buyer_reviewing_seller', 'seller_reviewing_buyer']).optional(),
      limit: z.number().int().min(1).max(50).default(20), skip: z.number().int().min(0).default(0),
    }),
  },
  async ({ seller_id, listing_id, role, limit, skip }) => {
    try {
      const path = listing_id ? `/v0/listing/${seller_id}/${listing_id}/reviews` : `/v0/shop/${seller_id}/reviews`;
      const rows = await nexus(path, { role, limit, skip });
      return ok({ count: Array.isArray(rows) ? rows.length : 0, reviews: rows });
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'get_listing_tags',
  {
    description: 'Community tags on a listing (label and how many people applied it).',
    inputSchema: z.object({ seller_id: pubkyId, listing_id: hexId }),
  },
  async ({ seller_id, listing_id }) => {
    try { return ok(await nexus(`/v0/listing/${seller_id}/${listing_id}/tags`)); }
    catch (e) { return fail(e); }
  },
);

server.registerTool(
  'list_drops',
  {
    description:
      'Timed drops (limited releases). `bucket` is a time-window estimate from the index (upcoming / live_window / ended_window); ' +
      'a drop can be sold out or cancelled inside its window, so treat "live" as "scheduled to be live" and send a person to the link to confirm.',
    inputSchema: z.object({
      owner: pubkyId.optional(),
      bucket: z.enum(['upcoming', 'live_window', 'ended_window']).optional(),
      order: z.enum(['ascending', 'descending']).optional(),
      limit: z.number().int().min(1).max(50).default(20), skip: z.number().int().min(0).default(0),
    }),
  },
  async (args) => {
    try {
      const rows = await nexus('/v0/stream/drops', args);
      return ok({ count: Array.isArray(rows) ? rows.length : 0, drops: (rows || []).map(compactDrop) });
    } catch (e) { return fail(e); }
  },
);

server.registerTool(
  'get_drop',
  {
    description: 'One drop by owner Pubky ID and drop id, as indexed. Live stock and claim state come from the shop page, not the index.',
    inputSchema: z.object({ owner_id: pubkyId, drop_id: hexId }),
  },
  async ({ owner_id, drop_id }) => {
    try { return ok(compactDrop(await nexus(`/v0/drop/${owner_id}/${drop_id}`))); }
    catch (e) { return fail(e); }
  },
);

server.registerTool(
  'about_pubky_shop',
  {
    description: 'What this marketplace is and what an agent can and cannot do here. Read this first.',
    inputSchema: z.object({}),
  },
  async () => ok({
    marketplace: SHOP,
    index: NEXUS,
    identifies_as: USER_AGENT,
    what_it_is: 'A peer-to-peer marketplace on Pubky. Sellers publish listings on their own homeservers; the index (Nexus) is a replaceable view of those signed records. Checkout is seller-direct: Bitcoin via Paykit, PayPal. No platform holds funds.',
    agents_can: ['browse and filter listings', 'read a listing, a shop, reviews and reputation', 'see drops and their schedule', 'hand a person a link to buy'],
    agents_cannot_yet: ['sign in', 'add to cart, make offers, bid or check out', 'hold anyone\'s keys or session'],
    how_a_person_buys: 'Open the listing URL, sign in with Pubky Ring, pay the seller directly.',
    identity_note: 'Every Pubky user, seller or agent is a 52-character public key. This server acts under no key; it only reads public records.',
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => { console.error(e); process.exit(1); });
