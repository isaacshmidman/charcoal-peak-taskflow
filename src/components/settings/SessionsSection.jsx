// @ts-nocheck
/**
 * @file Settings → Signed-in devices: every place this account is signed
 * in, newest first, with this one marked. Sign one out, or everywhere
 * else — what to do after losing a phone or signing in on a shared
 * computer. AI apps have their own list (Connected apps).
 */
import { useCallback, useEffect, useState } from "react";
import { Laptop, Smartphone } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** "Active now", "Active 5 minutes ago", "Active on 28 Sep" */
export function activeLabel(iso, now = Date.now()) {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 15) return "Active now";
  if (minutes < 60) return `Active ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Active ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Active on ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

const signedInOn = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function SessionsSection() {
  const online = useOnlineStatus();
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await apiClient.sessions.list());
      setError("");
    } catch {
      setError("Couldn’t load your signed-in devices. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    if (online) load();
  }, [online, load]);

  const signOut = async (id) => {
    setBusy(true);
    try {
      await apiClient.sessions.signOut(id);
      await load();
    } catch {
      setError("Couldn’t sign that device out. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const signOutOthers = async () => {
    setBusy(true);
    try {
      await apiClient.sessions.signOutOthers();
      await load();
    } catch {
      setError("Couldn’t sign the other devices out. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!online) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">Signed-in devices need a connection.</p>;
  }

  const others = (sessions || []).filter((s) => !s.current);

  return (
    <div className="space-y-4" data-testid="sessions-section">
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        Everywhere your account is signed in. If you don’t recognise one, sign it out: it has to sign in with Google again to
        get back in.
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {sessions === null && !error ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">Loading…</p>
      ) : (
        <Card className="divide-y divide-slate-100 dark:divide-[#303030]">
          {(sessions || []).map((session) => {
            const Icon = /iPhone|Android|iPad/.test(session.device) ? Smartphone : Laptop;
            return (
              <div key={session.id} className="flex items-center gap-3 px-4 py-3" data-testid="session-row">
                <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {session.device}
                    {session.current && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-[#1f1f1f] dark:text-slate-300">
                        This device
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                    {session.current ? "Active now" : activeLabel(session.last_active_at)} · Signed in {signedInOn(session.signed_in_at)}
                    {session.ip_address ? ` · ${session.ip_address}` : ""}
                  </p>
                </div>
                {!session.current && (
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => signOut(session.id)} aria-label={`Sign out ${session.device}`}>
                    Sign out
                  </Button>
                )}
              </div>
            );
          })}
        </Card>
      )}
      {others.length > 0 && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" disabled={busy} className="w-full" data-testid="sign-out-others">
              Sign out everywhere else
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out everywhere else?</AlertDialogTitle>
              <AlertDialogDescription>
                {others.length === 1 ? "The other device" : `The other ${others.length} devices`} will have to sign in with Google
                again. This one stays signed in.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={signOutOthers}>Sign out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
