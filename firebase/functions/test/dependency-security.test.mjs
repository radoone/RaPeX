import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { once } from 'node:events';
import redirects from 'follow-redirects';
import { glob } from 'glob';

// GHSA-mrwp-f3q8-3g9p: arrays from another realm must still mark custom credentials sensitive.
test('redirects strip cross-realm sensitive custom headers on an origin change', async () => {
  const destination = createServer((req, res) => res.end(JSON.stringify(req.headers)));
  const origin = createServer((_req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${destination.address().port}/` }); res.end(); });
  try {
    destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
    origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
    const headers = await new Promise((resolve, reject) => {
      redirects.http.get({ protocol: 'http:', hostname: '127.0.0.1', port: origin.address().port, path: '/',
        headers: { 'x-private-credential': 'fixture-secret', 'x-public-marker': 'fixture' },
        sensitiveHeaders: vm.runInNewContext('["x-private-credential"]'),
      }, response => { let body = ''; response.on('data', data => { body += data; }); response.on('end', () => resolve(JSON.parse(body))); }).on('error', reject);
    });
    assert.equal(headers['x-private-credential'], undefined);
    assert.equal(headers['x-public-marker'], 'fixture');
  } finally { origin.closeAllConnections();destination.closeAllConnections();await Promise.all([new Promise(resolve => origin.close(resolve)), new Promise(resolve => destination.close(resolve))]); }
});

test('the patched glob still supports file selection and honors cancellation', async () => {
  const selected = await glob('src/monitoring-*.ts', { cwd: process.cwd(), nodir: true });
  assert.ok(selected.includes('src/monitoring-small-catalog.ts'));
  const controller = new AbortController();controller.abort();
  await assert.rejects(glob('**/*', { signal: controller.signal }), { name: 'AbortError' });
});
