// @ts-nocheck
/**
 * @file Settings → Zephyrly Plus: which plan this account has, what each
 * includes, and buying Plus (Stripe's own Checkout page; Zephyrly never
 * sees a card). Coming back from Stripe, the server is asked to confirm
 * the payment with Stripe before anything changes here — the link alone
 * grants nothing (backend/billing.js).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Minus, Sparkles } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { BILLING_KEY, useBilling } from "@/hooks/useBilling";
import { isStripeCheckoutUrl } from "@/lib/stripe-url";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsSection, settingsHint } from "./parts";

const FEATURES = [
  ["Tasks, notes, reminders, Home and the calendar", true, true],
  ["Recently deleted, export and restore", true, true],
  ["Schedules", "One at a time", "As many as you like"],
  ["Room for files", "500 MB", "1 GB"],
  ["Google and Apple Calendar sync", false, true],
  ["AI apps: Claude, ChatGPT, Gemini, Siri", false, true],
];

const dateLabel = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

function Cell({ value }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-ink-900 dark:text-ink-100" aria-label="Included" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-ink-300 dark:text-ink-600" aria-label="Not included" />;
  return <span className="text-xs text-ink-600 dark:text-ink-300">{value}</span>;
}

export default function PlusSection() {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const { billing, isPlus, refetch } = useBilling();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { tone: "info" | "good" | "bad", text }
  const location = useLocation();
  const navigate = useNavigate();
  const handledReturn = useRef(false);

  // Back from Stripe: ?plus=done&session_id=… or ?plus=cancelled.
  useEffect(() => {
    if (handledReturn.current) return;
    const params = new URLSearchParams(location.search);
    const result = params.get("plus");
    if (!result) return;
    handledReturn.current = true;
    const sessionId = params.get("session_id") || "";
    navigate(`${location.pathname}#plus`, { replace: true });
    if (result !== "done" || !sessionId) {
      setNotice({ tone: "info", text: "No payment was made." });
      return;
    }
    setNotice({ tone: "info", text: "Confirming your payment with Stripe…" });
    let tries = 0;
    const confirm = async () => {
      try {
        const status = await apiClient.billing.confirm(sessionId);
        // The plan asked for when this page opened may still be on its way,
        // read before the payment counted: it must not land on top of this.
        await queryClient.cancelQueries({ queryKey: BILLING_KEY });
        queryClient.setQueryData(BILLING_KEY, status);
        if (status.plan === "plus") {
          setNotice({ tone: "good", text: "Welcome to Zephyrly Plus. Thank you!" });
          return;
        }
      } catch {
        // Tried again below.
      }
      tries += 1;
      if (tries < 10) setTimeout(confirm, 3000);
      else setNotice({ tone: "bad", text: "Stripe hasn't confirmed the payment yet. If you were charged, Plus arrives as soon as it does; reopen this page in a few minutes." });
    };
    confirm();
  }, [location.search, location.pathname, navigate, queryClient]);

  const buy = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { url } = await apiClient.billing.checkout();
      // Only ever off to Stripe's own page.
      if (!isStripeCheckoutUrl(url)) throw new Error("bad url");
      window.location.assign(url);
    } catch (error) {
      setBusy(false);
      if (error?.code === "already_plus") refetch();
      setNotice({ tone: "bad", text: error?.code === "already_plus" ? "This account already has Plus." : "Checkout didn't open. Please try again in a moment." });
    }
  };

  const source = billing?.source;
  const price = billing?.buy?.price?.label;

  return (
    <div className="space-y-8" data-testid="plus-section">
      <SettingsSection label="Your plan">
        <div className="ds-list">
          <div className="flex items-start gap-3 px-4 py-3.5">
            {isPlus ? (
              // Sun means done: this account has it.
              <span aria-hidden className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sun-400 text-ink-950">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : (
              <Sparkles aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-ink-400 dark:text-ink-500" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-900 dark:text-ink-100" data-testid="plus-plan">
                {isPlus ? "You have Zephyrly Plus" : "You're on Basic"}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-ink-500 dark:text-ink-400">
                {isPlus
                  ? source === "founding"
                    ? `A founding member${billing?.since ? `, since ${dateLabel(billing.since)}` : ""}: Plus is yours for as long as this account exists. Thank you for being here early.`
                    : source === "gift"
                      ? `A gift${billing?.since ? `, since ${dateLabel(billing.since)}` : ""}: Plus is yours for as long as this account exists.`
                      : `Bought${billing?.since ? ` on ${dateLabel(billing.since)}` : ""}: Plus is yours for as long as this account exists.`
                  : "The whole app, free. Plus connects it to your calendars and AI apps, with more room."}
              </p>
            </div>
          </div>
        </div>
      </SettingsSection>

      {notice && (
        <p
          role={notice.tone === "bad" ? "alert" : "status"}
          data-testid="plus-notice"
          className={cn(
            "flex items-start gap-2 px-1 text-sm leading-5",
            notice.tone === "good" && "font-medium text-ink-900 dark:text-ink-100",
            notice.tone === "bad" && "text-red-600 dark:text-red-300",
            notice.tone === "info" && "text-ink-600 dark:text-ink-300"
          )}
        >
          {notice.tone === "good" && (
            <span aria-hidden className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sun-400 text-ink-950">
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
          )}
          {notice.tone === "info" && busyNotice(notice.text) && <Loader2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
          <span>{notice.text}</span>
        </p>
      )}

      <SettingsSection label="What each includes">
        <div className="ds-list">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-hairline text-xs text-ink-500 dark:text-ink-400">
                <th className="px-4 py-2 font-medium">
                  <span className="sr-only">Feature</span>
                </th>
                <th className="w-[5.5rem] px-2 py-2 text-center font-medium sm:w-24">Basic</th>
                <th className="w-24 px-2 py-2 text-center font-medium sm:w-28">Plus</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-hairline">
              {FEATURES.map(([name, basic, plus]) => (
                <tr key={name}>
                  <td className="px-4 py-2.5 text-ink-700 dark:text-ink-200">{name}</td>
                  <td className="px-2 py-2.5 text-center">
                    <Cell value={basic} />
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <Cell value={plus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      {!isPlus && (
        <div className="space-y-2.5">
          {!online ? (
            <p className={settingsHint}>Buying Plus needs a connection.</p>
          ) : billing?.buy?.available ? (
            <Button type="button" onClick={buy} disabled={busy} data-testid="plus-buy" className="h-10 w-full">
              {busy ? "Opening Stripe…" : `Get Plus: ${price} once`}
            </Button>
          ) : (
            <p className={settingsHint}>Plus can&apos;t be bought here yet.</p>
          )}
          {billing?.buy?.available && billing.buy.price?.tax_added && (
            <p className={settingsHint} data-testid="plus-tax-note">
              Sales tax or VAT may be added at checkout, depending on where you live.
            </p>
          )}
          <p className={settingsHint}>
            One payment, for as long as this account exists. It isn&apos;t refundable. You pay on Stripe&apos;s secure page;
            Zephyrly never sees your card. See the{" "}
            <Link to="/terms" className="underline underline-offset-2">
              Terms
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

/** The one message that means "still waiting on Stripe". */
function busyNotice(text) {
  return /^Confirming/.test(text);
}
