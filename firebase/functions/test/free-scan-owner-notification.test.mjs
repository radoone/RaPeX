import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverOwnerNotification, sendFreeScanOwnerEmail } from '../lib/free-scan-owner-notification.js';
import { renderFreeScanOwnerEmail } from '../lib/email-templates.js';
const data = { domain: 'example.myshopify.com', email: 'owner<test>&@example.com', requestedAt: new Date('2026-10-21T08:00:00Z') };

test('owner email describes a request, escapes applicant details and never exposes confirmation material', () => {
  const content = renderFreeScanOwnerEmail({ ...data, verificationHash: 'NEVER_INCLUDE', confirmationToken: 'NEVER_INCLUDE' });
  assert.match(content.htmlContent, /owner&lt;test&gt;&amp;@example.com/);
  assert.match(content.htmlContent, /Interné upozornenie/);
  assert.doesNotMatch(content.htmlContent, /NEVER_INCLUDE|vašou žiadosťou|#verify=/);
  assert.match(content.textContent, /Sken sa spustí až po potvrdení/);
  assert.match(content.subject, /example.myshopify.com/);
});

test('duplicate trigger claims do not resend; provider failure remains retryable', async () => {
  let status = 'new'; let calls = 0; let rejectSend = true;
  const io = {
    claim: async () => status === 'accepted' ? null : data,
    send: async () => { calls++; if (rejectSend) throw new Error('provider unavailable'); return { messageId: 'accepted-id', duplicateAccepted: false }; },
    accept: async () => { status = 'accepted'; }, fail: async () => { status = 'retry'; },
  };
  await assert.rejects(deliverOwnerNotification(io), /provider unavailable/); assert.equal(status, 'retry');
  rejectSend = false; await deliverOwnerNotification(io); assert.equal(status, 'accepted');
  await deliverOwnerNotification(io); assert.equal(calls, 2);
});

test('owner submission uses configured recipient and sender, a stable provider key, and requires acceptance', async () => {
  const originalFetch = global.fetch; const saved = { ...process.env };
  process.env.BREVO_API_KEY = 'fixture-only'; process.env.BREVO_SENDER_EMAIL = 'info@zerorecall.online'; process.env.BREVO_SENDER_NAME = 'ZeroRecall'; process.env.FREE_SCAN_OWNER_EMAIL = 'radoone@gmail.com';
  try {
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
      assert.deepEqual(body.to, [{ email: 'radoone@gmail.com' }]); assert.equal(body.sender.email, 'info@zerorecall.online');
      assert.equal(body.headers['Idempotency-Key'], 'free-scan-owner-Abcdef12345678901234');
      assert.doesNotMatch(JSON.stringify(body), /#verify=/);
      return { ok: true, status: 201, json: async () => ({ messageId: 'message-1' }) };
    };
    assert.deepEqual(await sendFreeScanOwnerEmail('Abcdef12345678901234', data), { messageId: 'message-1', duplicateAccepted: false });
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ code: 'duplicate_parameter', message: 'Email for the idempotency key has already been processed' }) });
    assert.deepEqual(await sendFreeScanOwnerEmail('Abcdef12345678901234', data), { messageId: null, duplicateAccepted: true });
    global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(sendFreeScanOwnerEmail('Abcdef12345678901234', data), /503/);
    process.env.FREE_SCAN_OWNER_EMAIL = 'invalid'; await assert.rejects(sendFreeScanOwnerEmail('Abcdef12345678901234', data), /not configured/);
  } finally {
    global.fetch = originalFetch;
    for (const key of ['BREVO_API_KEY','BREVO_SENDER_EMAIL','BREVO_SENDER_NAME','FREE_SCAN_OWNER_EMAIL']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});
