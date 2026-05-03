// @ts-nocheck
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useIntegrations } from "@/hooks/useIntegrations";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";

/**
 * Connect-iCloud-via-CalDAV modal.
 *
 * Apple doesn't expose OAuth for iCloud calendars, so we ask the user for an
 * Apple ID + an *app-specific* password generated at appleid.apple.com.
 * Real Apple ID passwords don't work — they require 2FA. App-specific
 * passwords are revocable in one click without changing the user's main
 * password, which is why this is the supported path. We never store the
 * password in plaintext (encrypted-at-rest server-side) and we never log it.
 *
 * @param {{
 *   open: boolean,
 *   onOpenChange: (open: boolean) => void,
 * }} props
 */
export default function ConnectAppleModal({ open, onOpenChange }) {
  const { connectApple, connectingApple } = useIntegrations();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const reset = () => {
    setEmail("");
    setPassword("");
    setErrorMsg("");
  };

  const handleClose = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    try {
      await connectApple({ email: email.trim(), password });
      handleClose(false);
    } catch (err) {
      // Backend distinguishes invalid_credentials vs caldav_unreachable;
      // we surface the human message either way.
      const msg =
        err?.body?.message ||
        err?.message ||
        "Couldn't connect. Check the Apple ID and app-specific password.";
      setErrorMsg(String(msg).slice(0, 300));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect iCloud Calendar</DialogTitle>
          <DialogDescription>
            Sync your iCloud calendars two-way using an app-specific password.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
            <p className="font-medium text-slate-700 dark:text-slate-200">How to get an app-specific password</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>
                Sign in at{" "}
                <a
                  href="https://appleid.apple.com/account/manage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-300 hover:underline inline-flex items-center gap-0.5"
                >
                  appleid.apple.com
                  <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>Open <em>Sign-In and Security</em> → <em>App-Specific Passwords</em></li>
              <li>Generate a new password labeled "Zephyrly"</li>
              <li>Paste the 16-character password below</li>
            </ol>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-200">Apple ID</label>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@icloud.com"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-200">App-specific password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-2.5 py-1.5 text-sm font-mono text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-slate-400 dark:focus:border-slate-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Your password is encrypted at rest and only used for CalDAV calls to iCloud.
            </p>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/45 p-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleClose(false)}
              disabled={connectingApple}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={connectingApple || !email.trim() || !password}
            >
              {connectingApple ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                  Connecting…
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
