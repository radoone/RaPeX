import { URL } from "node:url";
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

const SHOP = /^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function publicIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export function parseStoreHost(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !HOST.test(url.hostname) || url.hostname.endsWith('.local')) return null;
    return url.hostname.toLowerCase();
  } catch { return null; }
}
async function safeFetch(url: URL): Promise<{status: number; location?: string; body: string}> {
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !HOST.test(url.hostname)) throw new Error('Invalid host');
  const addresses = await lookup(url.hostname, {all: true, family: 4});
  if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw new Error('Non-public address');
  const ip = addresses[0].address;
  return new Promise((resolve, reject) => {
    const req = request(url, {method:'GET', headers:{'accept':'text/html','user-agent':'ZeroRecall domain verification'}, lookup: (_host, _options, callback) => callback(null, ip, 4), timeout: 7000}, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 524288) req.destroy(new Error('Response too large')); else chunks.push(chunk); });
      res.on('end', () => resolve({status:res.statusCode || 0, location:res.headers.location, body:Buffer.concat(chunks).toString('utf8')}));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Timeout'))); req.on('error', reject); req.end();
  });
}
type Fetcher = typeof safeFetch;
async function follow(start: URL, fetcher: Fetcher): Promise<{url: URL; body: string}> {
  let url = start;
  for (let i = 0; i < 4; i++) {
    const result = await fetcher(url);
    if (result.status >= 300 && result.status < 400 && result.location) { url = new URL(result.location, url); continue; }
    if (result.status !== 200) throw new Error('Store unavailable');
    return {url,body:result.body};
  }
  throw new Error('Too many redirects');
}
/** A public storefront must name a shop and that Shopify shop must redirect back to the same storefront. */
export async function resolveShopDomain(value: unknown, fetcher: Fetcher = safeFetch): Promise<string | null> {
  const host = parseStoreHost(value); if (!host) return null;
  if (SHOP.test(host)) return host;
  try {
    const site = await follow(new URL(`https://${host}/`), fetcher);
    const matches = [...site.body.matchAll(/(?:Shopify\.shop\s*=\s*|["']myshopifyDomain["']\s*:\s*)["']([a-z0-9][a-z0-9-]{1,60}\.myshopify\.com)["']/gi)].map(m => m[1].toLowerCase());
    const candidates = [...new Set(matches)]; if (candidates.length !== 1) return null;
    const candidate = candidates[0]; const reverse = await follow(new URL(`https://${candidate}/`), fetcher);
    return reverse.url.hostname === site.url.hostname ? candidate : null;
  } catch { return null; }
}
