# Zephyrly Plus

One payment of **$9**, for as long as the account exists. No subscription,
no refunds.

| | Basic (free) | Plus |
|---|---|---|
| Tasks, subtasks, repeating tasks, priorities, tags, all views | ✓ | ✓ |
| Reminders and notifications | ✓ | ✓ |
| Notes, Make task | ✓ | ✓ |
| Schedules | One at a time | As many as you like |
| Room for files | 500 MB | 1 GB |
| Google and Apple Calendar sync | — | ✓ |
| AI apps: Claude, ChatGPT, Gemini, local models, Siri | — | ✓ |
| Recently Deleted, export and restore | ✓ | ✓ |

Everyone who had an account when Plus launched is a **founding member**,
with Plus for free, for good. Accounts made after that start on Basic.

## How it's kept safe

- **Cards:** people pay on Stripe's own Checkout page. Zephyrly never sees
  or stores a card.
- **What's charged:** the price comes from the server (`STRIPE_PRICE_ID`),
  never from the app. A payment only counts if it holds exactly that
  price, was paid, and was made by the server for that account.
- **When Plus is granted:** only when Stripe confirms, server to server.
  That's either Stripe's signed webhook (checked against the webhook
  secret, within five minutes, each event once), or the server asking
  Stripe about the payment with its own key. The "success" link grants
  nothing by itself.
- **Where Plus is recorded:** in its own table, which no API request can
  write. Only a confirmed payment, the gift script below, or the launch
  grant add to it.
- **Where limits are enforced:** every limit is checked on the server. The
  app's prompts are just courtesy; a modified app gets refused, not the
  feature.
- **Refunds and chargebacks:** a full refund or a chargeback takes Plus
  back automatically. A dispute you win gives it back.

## Setting up Stripe

You need a Stripe account in the name of someone 18 or older (a parent
can own it). Do everything first in **test mode** (the toggle in the
Stripe dashboard), then again in live mode.

1. **Product:** Products → Add product. Name it "Zephyrly Plus" and give
   it a **one-time** price of **$9.00 USD**. Copy the price's id
   (`price_…`).
2. **Terms:** Settings → Public details → add a Terms of service URL.
   Checkout requires buyers to accept the no-refund line, and Stripe
   needs a terms URL to show that checkbox.
3. **Restricted key:** Developers → API keys → Create restricted key, named
   "Zephyrly server". Give it these permissions and nothing else:
   - Checkout Sessions: **Write** (write includes read)
   - Prices: **Read**

   Copy the key (`rk_…`). A restricted key limits the damage if it ever
   leaks: it can't move money or see customers.
4. **Webhook:** Developers → Webhooks → Add endpoint.
   - URL: `https://zephyrly.app/api/billing/stripe/webhook`
   - Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `charge.refunded`,
     `charge.dispute.created`, `charge.dispute.closed`
   - Copy its signing secret (`whsec_…`).
5. **On the Zima box**, add the three values to `.env` next to
   `docker-compose.yml`, and make the file readable only by you:

   ```
   STRIPE_SECRET_KEY=rk_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_ID=price_...
   ```

   ```
   chmod 600 .env
   docker compose up -d --build
   ```

   Never paste these into chat, a commit, or the app.

6. **Test purchase:** with the test-mode keys, sign in with a Basic
   account, go to Settings → Zephyrly Plus → Get Plus, and pay with
   Stripe's test card `4242 4242 4242 4242` (any future date, any CVC).
   You should come back to "Welcome to Zephyrly Plus". In Stripe →
   Webhooks, the endpoint should show the events delivered with 200.
7. **Going live:** repeat steps 1–4 in live mode and swap the three values
   in `.env` for the live ones, then `docker compose up -d --build`.

With any of the three values missing, buying is switched off: the app
says "Plus can't be bought here yet", and nothing else changes.

## Gifting Plus, or taking it back

On the Zima box, in the repo folder. The person must have signed in once:

```
docker compose exec taskflow node backend/scripts/plus.mjs grant friend@example.com
docker compose exec taskflow node backend/scripts/plus.mjs revoke friend@example.com
docker compose exec taskflow node backend/scripts/plus.mjs list
```

Discount codes also work: create a promotion code in Stripe (Products →
Coupons); Checkout has a box for it.

## If something looks wrong

- **Someone paid but has no Plus.** In Stripe → Webhooks, check the
  endpoint's recent deliveries. A failure there means the webhook secret
  or URL is off. Coming back from Checkout also confirms the payment by
  itself, so reopening Settings → Zephyrly Plus usually fixes it. As a
  last resort, `plus.mjs grant` them.
- **A key may have leaked.** Roll it in Stripe (Developers → API keys),
  put the new one in `.env`, and rebuild. The old key stops working
  straight away.
