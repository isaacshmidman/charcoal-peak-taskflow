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
import { Check, Minus, Sparkles } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { BILLING_KEY, useBilling } from "@/hooks/useBilling";
import { isStripeCheckoutUrl } from "@/lib/stripe-url";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const FEATURES = [
  ["Tasks, notes, reminders, calendar view", true, true],
  ["Recently Deleted, export and restore", true, true],
  ["Schedules", "One at a time", "As many as you like"],
  ["Room for files", "500 MB", "1 GB"],
  ["Google and Apple Calendar sync", false, true],
  ["AI apps: Claude, ChatGPT, Gemini, Siri", false, true],
];

const dateLabel = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

function Cell({ value }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-slate-900 dark:text-slate-100" aria-label="Included" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-600" aria-label="Not included" />;
  return <span className="text-xs text-slate-600 dark:text-slate-300">{value}</span>;
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
    <div className="space-y-5" data-testid="plus-section">
      <Card className="space-y-2 px-4 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100" data-testid="plus-plan">
            {isPlus ? "You have Zephyrly Plus" : "You're on Basic"}
          </p>
        </div>
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
          {isPlus
            ? source === "founding"
              ? `A founding member${billing?.since ? `, since ${dateLabel(billing.since)}` : ""}: Plus is yours for as long as this account exists. Thank you for being here early.`
              : source === "gift"
                ? `A gift${billing?.since ? `, since ${dateLabel(billing.since)}` : ""}: Plus is yours for as long as this account exists.`
                : `Bought${billing?.since ? ` on ${dateLabel(billing.since)}` : ""}: Plus is yours for as long as this account exists.`
            : "The whole app, free. Plus connects it to your calendars and AI apps, with more room."}
        </p>
      </Card>

      {notice && (
        <p
          role="status"
          data-testid="plus-notice"
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            notice.tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-[#0d1f17] dark:text-emerald-200",
            notice.tone === "bad" && "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-[#2a1116] dark:text-red-200",
            notice.tone === "info" && "border-border-hairline bg-slate-50 text-slate-600 dark:bg-[#161616] dark:text-slate-300"
          )}
        >
          {notice.text}
        </p>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-hairline text-xs text-slate-500 dark:text-slate-400">
              <th className="px-4 py-2 font-medium" />
              <th className="w-24 px-2 py-2 text-center font-medium">Basic</th>
              <th className="w-28 px-2 py-2 text-center font-medium">Plus</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#303030]">
            {FEATURES.map(([name, basic, plus]) => (
              <tr key={name}>
                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{name}</td>
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
      </Card>

      {!isPlus && (
        <div className="space-y-2">
          {!online ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Buying Plus needs a connection.</p>
          ) : billing?.buy?.available ? (
            <Button
              type="button"
              onClick={buy}
              disabled={busy}
              data-testid="plus-buy"
              className="h-10 w-full bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {busy ? "Opening Stripe…" : `Get Plus — ${price} once`}
            </Button>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">Plus can’t be bought here yet.</p>
          )}
          {billing?.buy?.available && billing.buy.price?.tax_added && (
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="plus-tax-note">
              Sales tax or VAT may be added at checkout, depending on where you live.
            </p>
          )}
          <p className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
            One payment, for as long as this account exists. It isn’t refundable. You pay on Stripe’s secure page; Zephyrly
            never sees your card. See the{" "}
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
