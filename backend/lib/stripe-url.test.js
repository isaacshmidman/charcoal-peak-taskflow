// @ts-nocheck
/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { isStripeCheckoutUrl } from "./stripe-url.js";

describe("isStripeCheckoutUrl", () => {
  it("is true only for https pages on Stripe's own hosts", () => {
    for (const url of ["https://checkout.stripe.com/c/pay/cs_test_x", "https://checkout.link.com/c/pay/cs_live_x", "https://link.com/pay"]) {
      expect(isStripeCheckoutUrl(url)).toBe(true);
    }
    for (const url of [
      "http://checkout.stripe.com/c/pay/cs_test_x",
      "https://checkout.stripe.com.example.net/c/pay",
      "https://evilstripe.com/c/pay",
      "https://checkout.stripe.com@example.net/c/pay",
      "https://someone:pw@checkout.stripe.com/c/pay",
      "https://checkout.stripe.com:8443/c/pay",
      "javascript:alert(1)//checkout.stripe.com",
      "/c/pay",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(isStripeCheckoutUrl(url)).toBe(false);
    }
  });
});
