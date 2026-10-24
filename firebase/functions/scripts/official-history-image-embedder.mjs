/** Same pinned image model/dimension as production, with bounded per-region pacing. */
import { execFileSync } from 'node:child_process';
import { Agent } from 'node:https';
import { lookup } from 'node:dns/promises';
import axios from 'axios';
import { publicImageAddress, validatePublicImageUrl } from '../lib/public-image.js';

let accessToken, tokenExpiresAt = 0;
const nextSlot = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Keep a bounded connection pool to the Commission instead of opening a TLS
// connection for each of 100,000+ photos. Validate DNS on every new connection.
const agent = new Agent({ keepAlive: true, maxSockets: 32, maxFreeSockets: 16, lookup(hostname, options, callback) {
  lookup(hostname, { all: true }).then(addresses => {
    if (!addresses.length || addresses.some(item => !publicImageAddress(item.address))) return callback(Error('Non-public image host'), '', 4);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }).catch(error => callback(error, '', 4));
} });

export async function embedOfficialImage(url, regions) {
  if (!/^https:\/\/ec\.europa\.eu\/safety-gate-alerts\/public\/api\/notification\/image\/-?\d+$/.test(url)) throw Error('Unexpected official image URL');
  let image;
  let sourceUrl = url;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      image = await axios.get(validatePublicImageUrl(url).href, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 5 * 1024 * 1024, maxBodyLength: 5 * 1024 * 1024, maxRedirects: 3, httpsAgent: agent, proxy: false, beforeRedirect: options => { validatePublicImageUrl(`${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ''}${options.path || '/'}`); } });
      break;
    } catch (error) {
      if (String(error.message).includes('maxContentLength') || (attempt === 2 && error.response?.status >= 500)) {
        sourceUrl = url.replace('/image/', '/thumbnail/');
        image = await axios.get(validatePublicImageUrl(sourceUrl).href, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 5 * 1024 * 1024, maxBodyLength: 5 * 1024 * 1024, maxRedirects: 0, httpsAgent: agent, proxy: false });
        break;
      }
      if (attempt === 2 || (error.response?.status && error.response.status < 500 && error.response.status !== 429)) throw error;
      await sleep(1500 * (attempt + 1));
    }
  }
  const bytesBase64Encoded = Buffer.from(image.data).toString('base64');
  for (let attempt = 0; attempt < 4; attempt++) {
    const region = regions.reduce((best, item) => (nextSlot.get(item) || 0) < (nextSlot.get(best) || 0) ? item : best);
    const slot = Math.max(Date.now(), nextSlot.get(region) || 0);
    // Live quota inspection: European regions 120/min; American regions 600/min.
    nextSlot.set(region, slot + (region.startsWith('europe-') ? 600 : 130));
    if (slot > Date.now()) await sleep(slot - Date.now());
    if (Date.now() >= tokenExpiresAt) {
      accessToken = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', env: { ...process.env, CLOUDSDK_PYTHON: '/opt/homebrew/bin/python3.14' } }).trim();
      tokenExpiresAt = Date.now() + 40 * 60 * 1000;
    }
    const response = await fetch(`https://${region}-aiplatform.googleapis.com/v1/projects/rapex-99a2c/locations/${region}/publishers/google/models/multimodalembedding@001:predict`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ image: { bytesBase64Encoded } }], parameters: { dimension: 1408 } }),
      signal: AbortSignal.timeout(60000),
    });
    if (response.ok) {
      const data = await response.json();
      const vector = data.predictions?.[0]?.imageEmbedding;
      if (vector?.length !== 1408 || vector.some(value => !Number.isFinite(value))) throw Error('Invalid image vector');
      return { vector, sourceUrl };
    }
    await response.arrayBuffer();
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) throw Error(`Image embedding HTTP ${response.status} in ${region}`);
    await sleep(1000 * (attempt + 1));
  }
}
