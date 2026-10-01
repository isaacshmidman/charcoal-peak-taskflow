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
  back automatically. A dispute you win gives it back. Stripe doesn't
  promise to send events in order, so a refund that arrives before the
  purchase still stops that purchase counting.

## Setting up Stripe

You need a Stripe account in the name of someone 18 or older (a parent
can own it). Do everything first in **test mode** (the toggle in the
Stripe dashboard), then again in live mode.

**Already done in the "Zephyrly sandbox"** (2026-09-30, through Claude's
Stripe connector): the product and price from step 1 and the webhook from
step 4. In live mode, do them again (or connect the live account to
Claude and ask).

1. **Product:** Products → Add product, with id `zephyrly_plus` if the
   form offers one. Name it "Zephyrly Plus", product tax code *Software as
   a service (SaaS) – personal use*, and give it a **one-time** price of
   **$9.00 USD** with tax **included**. Copy the price's id (`price_…`).
   The sandbox one is `price_1ULYK6EYFgf9Lg8SHfVso33o`.
   A subscription price can be added to the same product later, but the
   app only sells the one-time one.
2. **Public details:** Settings → Business → Public details:
   - Terms of service URL: `https://zephyrly.app/terms`
   - Privacy policy URL: `https://zephyrly.app/privacy`
   - Support email: the one the app shows on those pages
     (`TASKFLOW_SUPPORT_EMAIL` in `.env`, else `support@zephyrly.app`).
     For `support@zephyrly.app` to reach you, turn on Cloudflare → your
     zephyrly.app zone → Email → Email Routing, and forward it to your
     inbox.

   Checkout requires buyers to accept the no-refund line, and in live
   mode Stripe won't show that checkbox without a Terms URL. The
   checkbox links to the Terms page.
3. **Restricted key:** Developers → API keys → Create restricted key, named
   "Zephyrly server". Give it these permissions and nothing else:
   - Checkout Sessions: **Write** (write includes read)
   - Prices: **Read**

   Copy the key (`rk_…`). A restricted key limits the damage if it ever
   leaks: it can't move money or see customers.
4. **Webhook:** Developers → Webhooks → Add endpoint.
   - URL: `https://zephyrly.app/api/billing/stripe/webhook`
   - API version: `2025-03-31.basil` (what the server is written for)
   - Events: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`, `charge.refunded`,
     `charge.dispute.created`, `charge.dispute.closed`
   - Copy its signing secret (`whsec_…`). For the sandbox endpoint, roll
     it first (⋯ → Roll secret, expire now): its first secret passed
     through Claude's tool output when Claude made it.
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
7. **Receipts and public details:** Settings → Business → Customer emails →
   turn on **Successful payments** and **Refunds**. Receipts are free. Fill
   in Settings → Business → Public details too: receipts must show a legal
   name, a support email and a privacy policy link.
8. **Tax:** decide which way (next section) before going live.
9. **Going live:** repeat steps 1–4 in live mode (products are separate
   there, so give the live one its tax code and tax behavior too) and swap the three values
   in `.env` for the live ones, then `docker compose up -d --build`.

## Tax, receipts and invoices

Not legal or tax advice. Selling Plus can mean owing sales tax in some US
states, and VAT or GST in other countries. Some places, like the EU and
the UK, tax digital sales to their residents from the very first sale.
`STRIPE_TAX` in `.env` picks who handles that:

| `STRIPE_TAX` | Who's the seller | What Stripe does | Extra cost per $9 sale |
|---|---|---|---|
| `off` (default) | You | Nothing. Any tax owed is yours to sort out. | — |
| `automatic` (Stripe Tax) | You | Works out the tax and adds it at checkout wherever you've **registered**. It also warns you when sales somewhere get near the point where you'd have to register. You register and file returns yourself. | 0.5% (about 5¢), only where you're registered |
| `managed` (Managed Payments) | Stripe, through Link | Works out, collects, files and pays the tax in 80+ countries. It also handles fraud and chargebacks and answers buyers' payment questions. | 3.5% (about 32¢) |

The normal card fee comes first either way: 2.9% + 30¢, about 56¢ of $9.

**What `managed` means in practice.** Stripe has to approve the account,
under Settings → Managed Payments, where you also accept its terms.
Buyers' card statements say `LINK.COM* …`. Stripe can refund a buyer
within 60 days, and applies cooling-off rights where the law requires,
whatever Zephyrly's no-refund line says. When that happens, Zephyrly takes
Plus back automatically.

**Setting either one up:**

1. Give the product a tax code: Products → Zephyrly Plus → Edit → Product
   tax code: *Software as a service (SaaS) – personal use*
   (`txcd_10103000`). Managed Payments refuses products without an
   eligible code.
2. Decide whether $9 includes tax. On the price, set tax behavior to
   **inclusive** so $9 is exactly what everyone pays, and you keep less
   where tax applies. With **exclusive**, tax goes on top and the app tells
   buyers it may be added. Managed Payments adds it on top if you set
   neither.
3. For `automatic` only: Settings → Tax → add your head office address,
   and add registrations as you get them.
4. Add `STRIPE_TAX=automatic` or `STRIPE_TAX=managed` to `.env`, rebuild,
   and do a test-mode purchase with a few different billing addresses.

**Invoices.** `STRIPE_INVOICES=on` makes Stripe email a paid invoice
(a PDF) after each purchase, for buyers who need one. It costs 0.4%, about
4¢ a sale. With `managed`, Stripe sends receipts and invoices itself and
this setting is ignored.

If Checkout stops opening after you change either setting, the server log
says why in Stripe's words, for example a permission the restricted key
lacks. Add exactly that permission to the key.

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
Coupons); Checkout has a box for it. A 100%-off code works too, but
anyone who learns it gets Plus free, so set a redemption limit on it.
For one person, `plus.mjs grant` is simpler.

## If something looks wrong

- **Someone paid but has no Plus.** In Stripe → Webhooks, check the
  endpoint's recent deliveries. A failure there means the webhook secret
  or URL is off. Coming back from Checkout also confirms the payment by
  itself, so reopening Settings → Zephyrly Plus usually fixes it. As a
  last resort, `plus.mjs grant` them.
- **A key may have leaked.** Roll it in Stripe (Developers → API keys),
  put the new one in `.env`, and rebuild. The old key stops working
  straight away.
