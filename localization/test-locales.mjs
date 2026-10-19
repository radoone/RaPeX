import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const languages = await read('./languages.json');
const authority = await read('./authorities.json');
const source = await read('./catalogs/en.json');
function leaves(object, prefix = '') {
  return Object.fromEntries(Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'object' && value !== null ? Object.entries(leaves(value, path)) : [[path, value]];
  }));
}
const tokens = value => (value.match(/\{\{[^}]+\}\}/g) || []).sort();
const links = value => [...value.matchAll(/(?:href|src)="([^"]+)"/g)].map(x => x[1]).sort();
const expected = leaves(source);

test('all 24 EU languages have complete web/email catalogs and preserved interpolation and privacy links', async () => {
  assert.equal(languages.length, 24);
  for (const { code } of languages) {
    const catalog = await read(`./catalogs/${code}.json`);
    const values = leaves(catalog);
    assert.deepEqual(Object.keys(values).sort(), Object.keys(expected).sort(), code);
    for (const [key, value] of Object.entries(values)) {
      assert.equal(typeof value, 'string', `${code}:${key}`);
      assert.ok(value.trim(), `${code}:${key}`);
      assert.deepEqual(tokens(value), tokens(expected[key]), `${code}:${key}`);
      assert.deepEqual(links(value), links(expected[key]), `${code}:${key}`);
      assert.doesNotMatch(value, /<script|onerror\s*=|javascript:/i);
    }
    assert.match(authority[code].url, /^https:\/\//);
    const generated = await read(`../marketing-site/locales/${code}.json`);
    assert.deepEqual(generated, catalog.web, `stale generated web: ${code}`);
    if (code !== 'en') {
      assert.notEqual(catalog.web.hero.title, source.web.hero.title, code);
      assert.notEqual(catalog.web.scan.requestErrorBody, source.web.scan.requestErrorBody, code);
      assert.notEqual(catalog.email.confirm_email_and_continue, source.email.confirm_email_and_continue, code);
    }
  }
});

test('all public-page translation keys exist and language alternates cover all EU locales', async () => {
  const web = leaves(source.web);
  for (const page of ['index', 'about', 'privacy']) {
    const html = await readFile(new URL(`../marketing-site/${page}.html`, import.meta.url), 'utf8');
    for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) assert.ok(key in web, `${page}:${key}`);
    for (const { code } of languages) assert.ok(html.includes(`hreflang="${code}"`), `${page}:${code}`);
  }
});
