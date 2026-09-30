// @ts-nocheck
/**
 * @file The consent page for "Sign in with Zephyrly": an AI app (claude.ai,
 * ChatGPT, Gemini…) sent the person here to be allowed in
 * (backend/ai/oauth.js). Reached as /connect/<id> from /api/oauth/authorize;
 * sign-in comes first if needed, and returns here (it keeps the path).
 *
 * The app's name is its own claim, so the page also says where the person
 * will be sent back to: a look-alike name can't hide that. Changes are off
 * unless ticked here.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "@/api/apiClient";
import { Checkbox } from "@/components/ui/checkbox";
import PlusPrompt from "@/components/PlusPrompt";
import { useBilling } from "@/hooks/useBilling";

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export default function Connect() {
  // AI apps are Plus: a Basic account can only say no here (and the server
  // would refuse a yes anyway).
  const { isBasic } = useBilling();
  const { requestId } = useParams();
  // loading | ready (request) | gone (message) | sending | failed (message)
  const [state, setState] = useState({ phase: "loading" });
  const [allowChanges, setAllowChanges] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient.ai
      .connectRequest(requestId)
      .then((request) => !cancelled && setState({ phase: "ready", request }))
      .catch((error) => !cancelled && setState({ phase: "gone", message: error?.message || "This sign-in can't be used." }));
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const answer = async (approve) => {
    const request = state.request;
    setState({ phase: "sending", request });
    try {
      const { redirect_to } = await apiClient.ai.decide(requestId, { approve, can_write: approve && allowChanges, time_zone: browserTimeZone() });
      window.location.assign(redirect_to);
    } catch (error) {
      setState({ phase: "failed", request, message: error?.message || "That didn't go through. Start again from the app." });
    }
  };

  const request = state.request;
  const busy = state.phase === "sending";
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200/80 dark:border-[#343434] bg-white/95 dark:bg-[#111111] backdrop-blur dark:backdrop-blur-none p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2.5 mb-6">
          <img src="/zephyrly-logo.png" alt="Zephyrly" className="w-10 h-10 rounded-xl object-cover" />
          <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Zephyrly</span>
        </div>

        {state.phase === "loading" && <p className="text-sm text-slate-500 dark:text-slate-400">Checking this sign-in…</p>}

        {state.phase === "gone" && (
          <div data-testid="connect-gone">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">This sign-in can't be used</h1>
            <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">{state.message}</p>
          </div>
        )}

        {request && (
          <div data-testid="connect-request">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 leading-snug break-words">
              Connect “{request.client_name}” to your Zephyrly account?
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              It will be able to read your tasks and notes. When you're done you'll go back to{" "}
              <strong className="font-semibold text-slate-900 dark:text-slate-100" data-testid="connect-host">
                {request.redirect_host}
              </strong>
              . If that isn't the app you were using, don't allow this.
            </p>

            <label className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-[#343434] bg-slate-50 dark:bg-[#161616] px-4 py-3">
              <Checkbox
                checked={allowChanges}
                onCheckedChange={setAllowChanges}
                disabled={busy}
                aria-label="Also let it change tasks"
                data-testid="connect-allow-changes"
                className="mt-0.5"
              />
              <span className="text-sm leading-5 text-slate-700 dark:text-slate-200">
                Also let it change tasks
                <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                  It can't change events from your calendars or delete anything for good, and you can undo its changes in
                  Settings → Connected apps.
                </span>
              </span>
            </label>

            {state.phase === "failed" && <p className="mt-4 text-sm text-red-600 dark:text-red-300">{state.message}</p>}

            {isBasic && <PlusPrompt className="mt-5" feature="Connecting AI apps" />}

            <div className="mt-6 space-y-2">
              {!isBasic && (
              <button
                type="button"
                data-testid="connect-allow"
                disabled={busy}
                onClick={() => answer(true)}
                className="w-full h-12 rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? "Connecting…" : "Allow"}
              </button>
              )}
              <button
                type="button"
                data-testid="connect-deny"
                disabled={busy}
                onClick={() => answer(false)}
                className="w-full h-12 rounded-2xl border border-slate-200 dark:border-[#343434] bg-white dark:bg-[#161616] text-slate-900 dark:text-slate-100 text-sm font-medium hover:bg-slate-50 dark:hover:bg-[#222222] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Don't allow
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
