import test from 'node:test';
import assert from 'node:assert/strict';
import { publicImageAddress, validatePublicImageUrl } from '../lib/public-image.js';
test('image transport rejects private addresses, credentials, HTTP and unexpected ports', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.1.2', '192.168.1.1', '100.64.0.1', '::1', 'fc00::1', '::ffff:127.0.0.1']) assert.equal(publicImageAddress(ip), false, ip);
  assert.equal(publicImageAddress('8.8.8.8'), true);
  assert.equal(publicImageAddress('2606:4700:4700::1111'), true);
  for (const url of ['http://cdn.shopify.com/a.jpg', 'https://127.0.0.1/a.jpg', 'https://[::1]/a', 'https://user:pass@cdn.shopify.com/a', 'https://cdn.shopify.com:8443/a']) assert.throws(() => validatePublicImageUrl(url));
  assert.equal(validatePublicImageUrl('https://cdn.shopify.com/a.jpg').hostname, 'cdn.shopify.com');
});
