// @ts-check
/**
 * @file Buying Zephyrly Plus with Stripe.
 *
 * How it stays safe:
 * - Card details never reach Zephyrly: the person pays on Stripe's own
 *   Checkout page, and comes back.
 * - The price is the server's (STRIPE_PRICE_ID). The app never sends an
 *   amount, and a session is only accepted if it holds exactly that price.
 * - Plus is granted only on Stripe's word, server to server: the webhook
 *   Stripe signs (HMAC-SHA256 with the endpoint's secret, checked in
 *   constant time, within five minutes, each event once), or the server
 *   asking Stripe about the session with its own key when the person comes
 *   back. Coming back to the success page grants nothing by itself.
 * - Which account it's for is the server's too: the session carries the
 *   signed-in account's id, set when the server made it. Email is never
 *   used to match a payment to an account.
 * - A full refund or a chargeback takes Plus back; a dispute that's won
 *   gives it back. Stripe doesn't promise to send events in order, so a
 *   refund heard of before the purchase still stops it counting.
 * - Tax (STRIPE_TAX) and invoices (STRIPE_INVOICES) are Stripe's to work
 *   out at checkout; they change what the buyer pays, never what's checked.
 *
 * Plain fetch against Stripe's API: no SDK, so nothing more to trust.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.js";
import { isStripeCheckoutUrl } from "./lib/stripe-url.js";
import { log } from "./log.js";
import { grantPlus, holdPayment, paymentOnHold, plusOf, restorePlus, revokePlus } from "./plans.js";

const STRIPE_API = "https://api.stripe.com/v1";
/**
 * The API version these requests are written for, so changing the
 * account's default in Stripe's dashboard can't change them. Managed
 * Payments needs this one or later.
 */
export const STRIPE_API_VERSION = "2025-03-31.basil";
/** How old a signed webhook may be, in seconds. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

/**
 * @typedef {{ stripeSecretKey?: string, stripeWebhookSecret?: string, stripePriceId?: string, stripeTax?: "off" | "automatic" | "managed", stripeInvoices?: boolean, publicAppUrl: string, appId: string }} BillingConfig
 */

/**
 * Buying is on only with all three Stripe settings in the server's .env.
 * @param {BillingConfig} config
 */
export function billingEnabled(config) {
  return Boolean(config.stripeSecretKey && config.stripeWebhookSecret && config.stripePriceId);
}

/**
 * Form-encode Stripe's nested parameters: { a: { b: 1 } } → a[b]=1.
 * @param {Record<string, any>} params
 * @param {string} [prefix]
 * @param {URLSearchParams} [out]
 */
function formEncode(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, i) => (typeof item === "object" ? formEncode(item, `${name}[${i}]`, out) : out.append(`${name}[${i}]`, String(item))));
    else if (typeof value === "object") formEncode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

/**
 * @param {BillingConfig} config
 * @param {"GET" | "POST"} method
 * @param {string} path
 * @param {Record<string, any>} [params]
 */
async function stripe(config, method, path, params) {
  const body = params && method === "POST" ? formEncode(params).toString() : undefined;
  const query = params && method === "GET" ? `?${formEncode(params).toString()}` : "";
  const response = await fetch(`${STRIPE_API}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Stripe's message stays in the server log.
    log.warn(`[billing] Stripe ${method} ${path} failed (${response.status}): ${data?.error?.message || "no message"}`);
    throw new HttpError(502, "The payment service didn't answer. Please try again in a moment.", "billing_unavailable");
  }
  return data;
}

/** @type {{ at: number, price: { amount: number, currency: string, label: string, taxBehavior: string } | null }} */
let priceCache = { at: 0, price: null };

/**
 * Plus's price, as Stripe has it (so what's shown is what's charged).
 * Asked for at most once an hour; null when Stripe can't be reached.
 * @param {BillingConfig} config
 */
export async function plusPrice(config) {
  if (!billingEnabled(config)) return null;
  if (priceCache.price && Date.now() - priceCache.at < 60 * 60 * 1000) return priceCache.price;
  try {
    const price = await stripe(config, "GET", `/prices/${encodeURIComponent(String(config.stripePriceId))}`);
    const amount = Number(price.unit_amount);
    const currency = String(price.currency || "usd");
    const label = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100);
    priceCache = { at: Date.now(), price: { amount, currency, label, taxBehavior: String(price.tax_behavior || "unspecified") } };
    return priceCache.price;
  } catch {
    return null;
  }
}

/**
 * Whether tax may be added on top of the price at checkout. With tax on,
 * only a price marked "inclusive" in Stripe is the whole amount.
 * @param {BillingConfig} config
 * @param {{ taxBehavior: string } | null} price
 */
export function taxAddedAtCheckout(config, price) {
  return Boolean(price) && (config.stripeTax || "off") !== "off" && price?.taxBehavior !== "inclusive";
}

/**
 * What the server's tax and invoice settings add to a Checkout session.
 * Managed Payments works out tax and sends invoices itself, and refuses
 * sessions that ask for either.
 * @param {BillingConfig} config
 */
export function checkoutExtras(config) {
  if (config.stripeTax === "managed") return { managed_payments: { enabled: true } };
  return {
    ...(config.stripeTax === "automatic" ? { automatic_tax: { enabled: true } } : {}),
    ...(config.stripeInvoices ? { invoice_creation: { enabled: true, invoice_data: { description: "Zephyrly Plus, for as long as the account exists." } } } : {}),
  };
}

/** For tests. */
export function resetBillingCache() {
  priceCache = { at: 0, price: null };
}

/**
 * Start buying Plus: a Stripe Checkout session for this account, at the
 * server's price, with the no-refund terms to accept.
 * @param {any} db
 * @param {BillingConfig} config
 * @param {{ appId: string, user: { id: string, email: string } }} input
 * @returns {Promise<{ url: string }>}
 */
export async function startCheckout(db, config, { appId, user }) {
  if (!billingEnabled(config)) throw new HttpError(503, "Buying Plus isn't set up on this server yet.", "billing_not_configured");
  if (plusOf(db, { appId, userId: user.id })) throw new HttpError(409, "This account already has Zephyrly Plus.", "already_plus");
  const base = new URL("/Settings", config.publicAppUrl);
  const session = await stripe(config, "POST", "/checkout/sessions", {
    mode: "payment",
    line_items: [{ price: config.stripePriceId, quantity: 1 }],
    client_reference_id: user.id,
    customer_email: user.email || undefined,
    metadata: { user_id: user.id, app_id: appId },
    payment_intent_data: { metadata: { user_id: user.id, app_id: appId } },
    // Stripe fills in {CHECKOUT_SESSION_ID}.
    success_url: `${base.toString()}?plus=done&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base.toString()}?plus=cancelled`,
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: {
        // Stripe turns the Markdown link into a link to our own Terms.
        message: `Zephyrly Plus is a one-time purchase for this Zephyrly account, for as long as the account exists. It isn't refundable, and I want it to start right away. I agree to the [Terms of Service](${new URL("/terms", config.publicAppUrl)}).`,
      },
    },
    allow_promotion_codes: true,
    ...checkoutExtras(config),
  });
  if (!isStripeCheckoutUrl(session.url)) {
    throw new HttpError(502, "The payment service didn't answer. Please try again in a moment.", "billing_unavailable");
  }
  return { url: session.url };
}

/**
 * Grant Plus for a Checkout session, if it truly paid for it: our price,
 * our app, a real account — and that account, when one is expected.
 * @param {any} db
 * @param {BillingConfig} config
 * @param {any} session  as Stripe has it, with line_items expanded
 * @param {{ expectUserId?: string }} [opts]
 * @returns {{ granted: boolean, userId?: string, why?: string }}
 */
export function applyPaidSession(db, config, session, { expectUserId } = {}) {
  const userId = String(session?.client_reference_id || "");
  if (session?.mode !== "payment") return { granted: false, why: "not a payment" };
  // A promotion code for the whole price leaves nothing to pay; Stripe then
  // says so instead of "paid". Only a code made in our Stripe can do that.
  const settled = session.payment_status === "paid" || (session.payment_status === "no_payment_required" && Number(session.amount_total) === 0);
  if (!settled) return { granted: false, why: "not paid yet" };
  if (session.metadata?.app_id && session.metadata.app_id !== config.appId) return { granted: false, why: "another app" };
  if (!userId || (expectUserId && userId !== expectUserId)) return { granted: false, why: "another account" };
  const items = session.line_items?.data || [];
  if (items.length !== 1 || items[0]?.price?.id !== config.stripePriceId || Number(items[0]?.quantity) !== 1) {
    return { granted: false, why: "not our price" };
  }
  const user = db.prepare(`SELECT id FROM users WHERE id = ? AND app_id = ?`).get(userId, config.appId);
  if (!user) return { granted: false, why: "no such account" };
  // A session buys Plus once: if that Plus was taken back, it stays taken back.
  if (db.prepare(`SELECT revoked_at FROM entitlements WHERE stripe_session_id = ?`).get(String(session.id))?.revoked_at) {
    return { granted: false, why: "taken back" };
  }
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  // Stripe doesn't promise event order: a refund or chargeback can be heard
  // of before the purchase is.
  if (paymentOnHold(db, paymentIntent)) return { granted: false, why: "refunded or disputed" };
  grantPlus(db, {
    appId: config.appId,
    userId,
    source: "stripe",
    stripeSessionId: String(session.id),
    stripePaymentIntent: paymentIntent,
    amountTotal: Number(session.amount_total),
    currency: String(session.currency || ""),
  });
  return { granted: true, userId };
}

/**
 * Stripe's own copy of a session, line items included.
 * @param {BillingConfig} config
 * @param {string} sessionId
 */
async function fetchSession(config, sessionId) {
  if (!SESSION_ID.test(sessionId)) throw new HttpError(400, "That isn't a payment session.", "invalid_session");
  return stripe(config, "GET", `/checkout/sessions/${sessionId}`, { expand: ["line_items"] });
}

/**
 * Back from Checkout: ask Stripe about the session (never trusting the
 * link) and grant Plus if this account paid. The webhook does the same on
 * its own; whichever comes first wins, and the other finds it done.
 * @param {any} db
 * @param {BillingConfig} config
 * @param {{ appId: string, user: { id: string }, sessionId: unknown }} input
 */
export async function confirmCheckout(db, config, { appId, user, sessionId }) {
  if (!billingEnabled(config)) throw new HttpError(503, "Buying Plus isn't set up on this server yet.", "billing_not_configured");
  if (plusOf(db, { appId, userId: user.id })) return { plus: true };
  const session = await fetchSession(config, String(sessionId || ""));
  const result = applyPaidSession(db, config, session, { expectUserId: user.id });
  return { plus: result.granted };
}

/**
 * Check a webhook's Stripe-Signature and return its event. Throws 400 for
 * anything not signed with our endpoint's secret in the last five minutes.
 * @param {string} rawBody  exactly as received
 * @param {unknown} header  the Stripe-Signature header
 * @param {string} secret
 * @param {number} [nowSeconds]
 */
export function verifyWebhook(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = String(header || "").split(",").map((part) => part.trim().split("="));
  const timestamp = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v || "");
  const bad = () => new HttpError(400, "Webhook signature doesn't check out.", "bad_signature");
  if (!Number.isInteger(timestamp) || !signatures.length) throw bad();
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw bad();
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  const matches = signatures.some((hex) => {
    if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
    return timingSafeEqual(Buffer.from(hex, "hex"), expected);
  });
  if (!matches) throw bad();
  try {
    return JSON.parse(rawBody);
  } catch {
    throw bad();
  }
}

/**
 * Act on one verified Stripe event, once.
 * @param {any} db
 * @param {BillingConfig} config
 * @param {any} event
 */
export async function handleStripeEvent(db, config, event) {
  const id = String(event?.id || "");
  if (!id) return { handled: false };
  if (db.prepare(`SELECT 1 FROM billing_events WHERE id = ?`).get(id)) return { handled: false, repeat: true };
  const object = event.data?.object || {};
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      // Stripe's own copy, line items and all: the event's is trimmed.
      const session = await fetchSession(config, String(object.id || ""));
      const result = applyPaidSession(db, config, session);
      if (!result.granted && result.why !== "not paid yet") log.warn(`[billing] session ${object.id} not granted: ${result.why}`);
      break;
    }
    case "charge.refunded": {
      // Only a full refund takes Plus back.
      if (object.refunded === true && object.payment_intent) {
        holdPayment(db, { stripePaymentIntent: String(object.payment_intent), reason: "refund" });
        const n = revokePlus(db, { stripePaymentIntent: String(object.payment_intent), reason: "refund" });
        if (n) log.info(`[billing] Plus taken back after a refund (${object.payment_intent}).`);
      }
      break;
    }
    case "charge.dispute.created": {
      if (object.payment_intent) {
        holdPayment(db, { stripePaymentIntent: String(object.payment_intent), reason: "dispute" });
        const n = revokePlus(db, { stripePaymentIntent: String(object.payment_intent), reason: "dispute" });
        if (n) log.info(`[billing] Plus paused for a chargeback (${object.payment_intent}).`);
      }
      break;
    }
    case "charge.dispute.closed": {
      if (object.status === "won" && object.payment_intent) restorePlus(db, { stripePaymentIntent: String(object.payment_intent) });
      break;
    }
    default:
      break;
  }
  db.prepare(`INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?, ?, ?)`).run(id, String(event.type || ""), new Date().toISOString());
  return { handled: true };
}
