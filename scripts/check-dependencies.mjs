import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const paths = ['package.json', 'firebase/package.json', 'firebase/functions/package.json',
  'shopify-client/package.json',
  'shopify-client/extensions/safety-gate-product-action/package.json',
  'shopify-client/extensions/safety-gate-product-block/package.json'];
const versions = new Map();
const rootLock = read('package-lock.json');
const functionLock = read('firebase/functions/package-lock.json');

for (const [manifest, lock] of [[read('package.json'), rootLock], [read('firebase/functions/package.json'), functionLock]]) {
  for (const [name, expected] of Object.entries(manifest.overrides ?? {})) {
    if (typeof expected !== 'string') continue;
    for (const [path, installed] of Object.entries(lock.packages)) {
      if (path.endsWith(`node_modules/${name}`)) {
        assert.equal(installed.version, expected, `Stale override for ${name} at ${path}; regenerate the lockfile`);
      }
    }
  }
}

for (const path of paths) {
  const manifest = read(path);
  const directory = path.replace(/\/?package.json$/, '');
  const lock = directory === 'firebase/functions' ? functionLock : rootLock;
  const lockPath = directory === 'firebase/functions' ? '' : directory;
  for (const group of ['dependencies', 'devDependencies']) {
    assert.deepEqual(lock.packages[lockPath]?.[group] ?? {}, manifest[group] ?? {}, `${path}: stale lockfile ${group}`);
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `${path}: ${name} must pin a stable exact version`);
      if (versions.has(name)) assert.equal(version, versions.get(name), `${path}: inconsistent ${name}`);
      versions.set(name, version);
    }
  }
}

for (const path of ['shopify-client/package-lock.json',
  'shopify-client/extensions/safety-gate-product-action/package-lock.json',
  'shopify-client/extensions/safety-gate-product-block/package-lock.json']) {
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, `Use the root lockfile, not ${path}`);
}
console.log(`Dependency versions and deployment lockfiles agree across ${paths.length} manifests.`);
