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
import { Input } from "@/components/ui/input";
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

  /** @param {boolean} next */
  const handleClose = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  /** @param {import("react").FormEvent<HTMLFormElement>} e */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    try {
      await connectApple({ email: email.trim(), password });
      handleClose(false);
    } catch (err) {
      // Backend distinguishes invalid_credentials vs caldav_unreachable;
      // we surface the human message either way.
      const error = /** @type {{ body?: { message?: string }, message?: string }} */ (err);
      const msg =
        error?.body?.message ||
        error?.message ||
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
            iCloud needs a password made just for Zephyrly, not your Apple ID password.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="rounded-lg border border-border-hairline bg-ink-50 dark:bg-night-raised p-3 text-xs text-ink-600 dark:text-ink-300 space-y-1.5">
            <p className="font-medium text-ink-700 dark:text-ink-200">How to get an app-specific password</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>
                Sign in at{" "}
                <a
                  href="https://appleid.apple.com/account/manage"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-ink-900 underline decoration-sun-600 decoration-[1.5px] underline-offset-2 dark:text-ink-100 dark:decoration-sun-400"
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
            <label htmlFor="apple-id" className="text-xs font-medium text-ink-700 dark:text-ink-200">Apple ID</label>
            <Input
              id="apple-id"
              type="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@icloud.com"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="apple-app-password" className="text-xs font-medium text-ink-700 dark:text-ink-200">App-specific password</label>
            <Input
              id="apple-app-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              className="font-mono"
            />
            <p className="text-[11px] text-ink-400 dark:text-ink-500">
              Stored encrypted, and only ever used to reach your iCloud calendars.
            </p>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-night-warn p-2 text-xs text-amber-700 dark:text-amber-300">
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
