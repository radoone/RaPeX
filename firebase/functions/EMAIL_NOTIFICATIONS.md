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
BREVO_SENDER_NAME=Safety Gate Monitor
APP_PUBLIC_URL=https://your-public-shopify-app.example
```

In Brevo, create one transactional webhook for `delivered`, `hardBounce`, `softBounce`, `invalid`, `blocked`, and `error`. Point it to the deployed `brevoEmailWebhook` URL and configure bearer authorization using the same value as `BREVO_WEBHOOK_SECRET`.

Do not place Brevo credentials in a checked-in `.env` file. Use Brevo sandbox mode or a dedicated test recipient before enabling production delivery.
