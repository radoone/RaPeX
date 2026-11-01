import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStoreHost,publicIPv4,resolveShopDomain} from '../lib/shop-domain-resolver.js';
test('rejects local, non-public and unsafe URL forms', () => {
  assert.equal(parseStoreHost('shop.example.com/products/x'),'shop.example.com');
  for (const s of ['http://example.com','https://localhost','https://127.0.0.1','https://user:pass@example.com','https://example.com:444','https://test.local']) assert.equal(parseStoreHost(s),null,s);
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.2','100.64.1.1','172.16.0.1','::1']) assert.equal(publicIPv4(ip),false,ip);
  assert.equal(publicIPv4('8.8.8.8'),true);
});
test('requires one claimed shop with an independently matching redirect', async () => {
  const pages = {'shop.example.com': {status:200,body:'<script>Shopify.shop = "verified.myshopify.com";</script>'},'verified.myshopify.com':{status:302,location:'https://shop.example.com/',body:''}};
  const fetcher=async url => pages[url.hostname] || {status:404,body:''};
  assert.equal(await resolveShopDomain('https://shop.example.com/products',fetcher),'verified.myshopify.com');
  pages['verified.myshopify.com'].location='https://other.example.com/';
  assert.equal(await resolveShopDomain('shop.example.com',fetcher),null);
  pages['shop.example.com'].body='Shopify.shop="a-shop.myshopify.com"; Shopify.shop="b-shop.myshopify.com"';
  assert.equal(await resolveShopDomain('shop.example.com',fetcher),null);
  assert.equal(await resolveShopDomain('verified.myshopify.com',fetcher),'verified.myshopify.com');
});
