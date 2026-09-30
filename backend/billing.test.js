// @ts-nocheck
/* @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "./db.js";
import { planOf } from "./plans.js";
import { applyPaidSession, handleStripeEvent, verifyWebhook } from "./billing.js";

const SECRET = "whsec_test_secret";
const config = { appId: "test-app", appName: "Test", deletedTaskRetentionDays: 7, publicAppUrl: "https://zephyrly.app", stripeSecretKey: "rk_test_x", stripeWebhookSecret: SECRET, stripePriceId: "price_plus" };
let dir;
let db;

const addUser = (id) =>
  db
    .prepare(`INSERT INTO users (id, app_id, full_name, email, role, auth_provider, preferences_json, created_date, updated_date) VALUES (?, 'test-app', '', ?, 'user', 'google', '{}', ?, ?)`)
    .run(id, `${id}@example.com`, new Date().toISOString(), new Date().toISOString());
const who = (userId) => ({ appId: "test-app", userId });
const sign = (body, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
const paidSession = (overrides = {}) => ({
  id: "cs_test_a1b2c3d4e5f6g7h8",
  mode: "payment",
  payment_status: "paid",
  client_reference_id: "user_buyer",
  metadata: { app_id: "test-app", user_id: "user_buyer" },
  payment_intent: "pi_123",
  amount_total: 900,
  currency: "usd",
  line_items: { data: [{ price: { id: "price_plus" }, quantity: 1 }] },
  ...overrides,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "billing-test-"));
  db = createDatabase({ ...config, dbFile: join(dir, "t.sqlite") });
  addUser("user_buyer");
  addUser("user_other");
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accept only our secret, the exact body, within five minutes", () => {
    expect(verifyWebhook(body, sign(body), SECRET).id).toBe("evt_1");
    // Stripe may send several signatures while a secret is being rolled.
    expect(verifyWebhook(body, `${sign(body)},v1=${"0".repeat(64)}`, SECRET).id).toBe("evt_1");
    for (const [header, raw] of [
      [sign(body, { secret: "whsec_someone_else" }), body],
      [sign(body), body.replace("evt_1", "evt_2")],
      [sign(body, { t: Math.floor(Date.now() / 1000) - 301 }), body],
      [sign(body, { t: Math.floor(Date.now() / 1000) + 301 }), body],
      ["", body],
      ["t=123", body],
      ["v1=abc", body],
    ]) {
      expect(() => verifyWebhook(raw, header, SECRET)).toThrow("Webhook signature doesn't check out.");
    }
  });
});

describe("granting Plus for a payment", () => {
  it("only for a paid session with exactly our price, for a real account of this app", () => {
    for (const [session, why] of [
      [paidSession({ payment_status: "unpaid" }), "not paid yet"],
      [paidSession({ mode: "subscription" }), "not a payment"],
      [paidSession({ line_items: { data: [{ price: { id: "price_cheaper" }, quantity: 1 }] } }), "not our price"],
      [paidSession({ line_items: { data: [{ price: { id: "price_plus" }, quantity: 2 }] } }), "not our price"],
      [paidSession({ line_items: { data: [] } }), "not our price"],
      [paidSession({ metadata: { app_id: "another-app" } }), "another app"],
      [paidSession({ client_reference_id: "user_nobody" }), "no such account"],
      [paidSession({ client_reference_id: "" }), "another account"],
    ]) {
      expect(applyPaidSession(db, config, session)).toEqual({ granted: false, why });
    }
    expect(planOf(db, who("user_buyer"))).toBe("basic");

    // Back from Checkout, the session must be the signed-in account's own.
    expect(applyPaidSession(db, config, paidSession(), { expectUserId: "user_other" })).toEqual({ granted: false, why: "another account" });
    expect(applyPaidSession(db, config, paidSession()).granted).toBe(true);
    expect(planOf(db, who("user_buyer"))).toBe("plus");
    expect(planOf(db, who("user_other"))).toBe("basic");
    // Twice is once.
    applyPaidSession(db, config, paidSession());
    expect(db.prepare(`SELECT COUNT(*) AS n FROM entitlements WHERE user_id = 'user_buyer'`).get().n).toBe(1);
    expect(db.prepare(`SELECT source, amount_total, currency, stripe_payment_intent FROM entitlements WHERE user_id = 'user_buyer'`).get()).toEqual({
      source: "stripe",
      amount_total: 900,
      currency: "usd",
      stripe_payment_intent: "pi_123",
    });
  });
});

describe("Stripe events", () => {
  const stripeSays = (session) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.stripe.com/v1/checkout/sessions/cs_test_a1b2c3d4e5f6g7h8?expand%5B0%5D=line_items");
      expect(init.headers.Authorization).toBe("Bearer rk_test_x");
      return new Response(JSON.stringify(session), { status: 200 });
    });

  it("a completed checkout grants Plus from Stripe's own copy of the session, once", async () => {
    const fetchSpy = stripeSays(paidSession());
    // The event's copy is trimmed (and could be anything): only its id is used.
    const event = { id: "evt_paid", type: "checkout.session.completed", data: { object: { id: "cs_test_a1b2c3d4e5f6g7h8", payment_status: "paid" } } };
    await handleStripeEvent(db, config, event);
    expect(planOf(db, who("user_buyer"))).toBe("plus");
    expect(await handleStripeEvent(db, config, event)).toEqual({ handled: false, repeat: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("a session Stripe says isn't paid grants nothing", async () => {
    stripeSays(paidSession({ payment_status: "unpaid" }));
    await handleStripeEvent(db, config, { id: "evt_unpaid", type: "checkout.session.completed", data: { object: { id: "cs_test_a1b2c3d4e5f6g7h8" } } });
    expect(planOf(db, who("user_buyer"))).toBe("basic");
  });

  it("a full refund or a chargeback takes Plus back; a dispute won gives it back", async () => {
    applyPaidSession(db, config, paidSession());
    await handleStripeEvent(db, config, { id: "evt_part", type: "charge.refunded", data: { object: { refunded: false, payment_intent: "pi_123" } } });
    expect(planOf(db, who("user_buyer"))).toBe("plus");
    await handleStripeEvent(db, config, { id: "evt_dispute", type: "charge.dispute.created", data: { object: { payment_intent: "pi_123" } } });
    expect(planOf(db, who("user_buyer"))).toBe("basic");
    await handleStripeEvent(db, config, { id: "evt_won", type: "charge.dispute.closed", data: { object: { status: "won", payment_intent: "pi_123" } } });
    expect(planOf(db, who("user_buyer"))).toBe("plus");
    await handleStripeEvent(db, config, { id: "evt_refund", type: "charge.refunded", data: { object: { refunded: true, payment_intent: "pi_123" } } });
    expect(planOf(db, who("user_buyer"))).toBe("basic");
    // A dispute won after a refund doesn't bring it back.
    await handleStripeEvent(db, config, { id: "evt_won2", type: "charge.dispute.closed", data: { object: { status: "won", payment_intent: "pi_123" } } });
    expect(planOf(db, who("user_buyer"))).toBe("basic");
  });

  it("a founding member's or a gift's Plus isn't touched by someone else's payment events", async () => {
    const { grantPlus } = await import("./plans.js");
    grantPlus(db, { ...who("user_other"), source: "gift" });
    await handleStripeEvent(db, config, { id: "evt_x", type: "charge.dispute.created", data: { object: { payment_intent: "pi_999" } } });
    expect(planOf(db, who("user_other"))).toBe("plus");
  });
});
