# Brevo email notifications

Safety Gate alert email is sent only by Firebase Functions:

- `sendImmediateSafetyGateAlertEmail` runs when a new merchant alert document is created.
- `weeklyClearSafetyGateSummary` runs every Monday at 08:00 in `Europe/Bratislava` and sends only when the previous local calendar week contains no new merchant alert.
- `brevoEmailWebhook` records delivery, bounce, and blocked events.

## Required configuration

Create and verify a dedicated sending domain in Brevo. Publish the SPF and DKIM records supplied by Brevo and publish a DMARC policy for the domain.

Set the two Firebase secrets:

```sh
firebase functions:secrets:set BREVO_API_KEY
firebase functions:secrets:set BREVO_WEBHOOK_SECRET
```

Set these non-secret runtime environment variables for the Functions deployment:

```text
BREVO_SENDER_EMAIL=alerts@example.com
BREVO_SENDER_NAME=ZeroRecall
APP_PUBLIC_URL=https://your-public-shopify-app.example
```

In Brevo, create one transactional webhook for `delivered`, `hardBounce`, `softBounce`, `invalid`, `blocked`, and `error`. Point it to the deployed `brevoEmailWebhook` URL and configure bearer authorization using the same value as `BREVO_WEBHOOK_SECRET`.

Do not place Brevo credentials in a checked-in `.env` file. Use Brevo sandbox mode or a dedicated test recipient before enabling production delivery.

## ZeroRecall sender

The verified Brevo sender is `ZeroRecall <info@zerorecall.online>`. Incoming mail is forwarded by Cloudflare Email Routing to `radoone@gmail.com`; Brevo authenticates outgoing mail with the `brevo1._domainkey` and `brevo2._domainkey` CNAME records. Keep these records DNS-only. Retain the existing Cloudflare MX/SPF records and the DMARC policy; do not replace them with a second SPF record.

Set `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and `MARKETING_SITE_URL` for `freeScanRequestAPI`, `processFreeScanRequestJob`, `sendImmediateSafetyGateAlertEmail`, and `weeklyClearSafetyGateSummary`. Store the same non-secret values in the untracked deployment-local `.env.rapex-99a2c` file for subsequent Firebase CLI deploys. Domain authentication and a verified sender do not by themselves prove production delivery; verify receipt of a test message.
