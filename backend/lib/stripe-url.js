// @ts-check
/**
 * @file Whether a link is a Stripe Checkout page. The server checks what
 * Stripe hands back and the app checks what the server hands it, so a
 * buyer is only ever sent to Stripe. Managed Payments checkouts are sold
 * through Link, which is Stripe's too.
 */

const STRIPE_HOSTS = ["stripe.com", "link.com"];

/**
 * @param {unknown} url
 * @returns {boolean}
 */
export function isStripeCheckoutUrl(url) {
  if (typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return false;
  return STRIPE_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
}
