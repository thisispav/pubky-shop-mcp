// Smoke test: speak JSON-RPC to the server over stdio, no client library needed.
//   node scripts/smoke.mjs
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.mjs');
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
let nextId = 1;
const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
const call = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); send({ jsonrpc: '2.0', id, method, params }); });

const t0 = Date.now();
const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
console.log('initialize →', init.result?.serverInfo, init.result?.protocolVersion);
send({ jsonrpc: '2.0', method: 'notifications/initialized' });

const tools = await call('tools/list', {});
console.log('tools →', tools.result.tools.map((t) => t.name).join(', '));

const show = (label, r) => {
  const text = r.result?.content?.[0]?.text || JSON.stringify(r.error);
  console.log(`\n== ${label}${r.result?.isError ? ' (isError)' : ''}\n` + text.slice(0, 700) + (text.length > 700 ? ' …' : ''));
};
show('about', await call('tools/call', { name: 'about_pubky_shop', arguments: {} }));
show('search active, limit 3', await call('tools/call', { name: 'search_listings', arguments: { limit: 3 } }));
show('search query "canary"', await call('tools/call', { name: 'search_listings', arguments: { query: 'canary', limit: 3 } }));
show('auctions ending soon', await call('tools/call', { name: 'search_listings', arguments: { sorting: 'ends_at', order: 'ascending', limit: 2 } }));
const first = JSON.parse((await call('tools/call', { name: 'search_listings', arguments: { limit: 1 } })).result.content[0].text).listings[0];
show('get_listing', await call('tools/call', { name: 'get_listing', arguments: { seller_id: first.seller_id, listing_id: first.id } }));
show('reputation', await call('tools/call', { name: 'get_seller_reputation', arguments: { seller_id: first.seller_id } }));
show('get_shop', await call('tools/call', { name: 'get_shop', arguments: { seller_id: first.seller_id, limit: 2 } }));
show('drops', await call('tools/call', { name: 'list_drops', arguments: { limit: 2 } }));
show('bad id (validation)', await call('tools/call', { name: 'get_listing', arguments: { seller_id: 'nope', listing_id: '123' } }));
console.log(`\ndone in ${Date.now() - t0} ms`);
child.kill();
