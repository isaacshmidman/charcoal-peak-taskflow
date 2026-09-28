// @ts-nocheck
/**
 * @file Settings → Connected apps: AI apps (Claude, ChatGPT, local
 * models…) that can read this account's tasks and notes, and — only when
 * allowed here — change them (backend/ai/).
 *
 * Three parts: the connections (allow changes, disconnect), making a
 * token for an app set up by hand (shown once, with setup lines for each
 * app), and what AI apps changed recently, each with Undo.
 *
 * Online only. Granting or changing access is never queued.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { setupSnippets } from "@/lib/ai-setup";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import SettingsToggle from "@/components/settings/SettingsToggle";
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

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

/** "just now", "5 minutes ago", "3 hours ago", "on 28 Sep" */
export function lastUsedLabel(iso, now = Date.now()) {
  if (!iso) return "Not used yet";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 2) return "Used just now";
  if (minutes < 60) return `Used ${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Used ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Used on ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (e.g. not a secure context); the text is selectable.
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5" aria-label={label}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Mono({ children, testId }) {
  return (
    <pre
      data-testid={testId}
      className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border-hairline bg-slate-50 px-2.5 py-2 font-mono text-xs text-slate-800 dark:bg-[#161616] dark:text-slate-200"
    >
      {children}
    </pre>
  );
}

function NewToken({ created, onDone }) {
  const snippets = setupSnippets(created.mcp_url, created.token);
  const [app, setApp] = useState(snippets[0].id);
  const chosen = snippets.find((s) => s.id === app) || snippets[0];
  return (
    <div className="space-y-4 rounded-lg bg-slate-50 px-3 py-3 dark:bg-[#252525]" data-testid="ai-new-token">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Copy this token now. It won't be shown again.</p>
        <div className="flex items-start gap-2">
          <Mono testId="ai-token-value">{created.token}</Mono>
          <CopyButton text={created.token} label="Copy token" />
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-slate-500 dark:text-slate-400">Server address</p>
        <div className="flex items-start gap-2">
          <Mono>{created.mcp_url}</Mono>
          <CopyButton text={created.mcp_url} label="Copy server address" />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">Set it up in</p>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="AI app">
          {snippets.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === chosen.id}
              onClick={() => setApp(s.id)}
              className={
                s.id === chosen.id
                  ? "rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                  : "rounded-full border border-border-strong px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
              }
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300">{chosen.where}</p>
        <div className="flex items-start gap-2">
          <Mono testId="ai-setup-snippet">{chosen.text}</Mono>
          <CopyButton text={chosen.text} label={`Copy ${chosen.label} setup`} />
        </div>
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function GrantRow({ grant, online, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e?.message || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 px-4 py-3" data-testid={`ai-grant-${grant.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{grant.label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {grant.can_write ? "Can read and change tasks" : "Can read"} · {lastUsedLabel(grant.last_used_at)}
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button" disabled={!online || busy} className="shrink-0 pt-0.5 text-xs font-medium text-red-600 hover:underline disabled:opacity-40 dark:text-red-400">
              Disconnect
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {grant.label}?</AlertDialogTitle>
              <AlertDialogDescription>It stops working straight away. Changes it already made stay, and can still be undone below.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => apiClient.ai.revoke(grant.id))}>Disconnect</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-700 dark:text-slate-200">Allow changes to tasks</p>
        <SettingsToggle
          checked={grant.can_write}
          disabled={!online || busy}
          label={`Allow ${grant.label} to change tasks`}
          onChange={(next) => run(() => apiClient.ai.setCanWrite(grant.id, next))}
        />
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function ActivityRow({ entry, online, onUndone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const undo = async () => {
    setBusy(true);
    setError("");
    try {
      await apiClient.ai.undo(entry.id);
      await onUndone();
    } catch (e) {
      setError(e?.message || "That couldn't be undone.");
    } finally {
      setBusy(false);
    }
  };
  const time = new Date(entry.created_date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <li className="space-y-1 px-4 py-3" data-testid={`ai-activity-${entry.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-900 dark:text-slate-100">{entry.summary}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {entry.app} · {time}
          </p>
        </div>
        {entry.undo === "available" && (
          <Button type="button" variant="outline" size="sm" disabled={!online || busy} onClick={undo}>
            Undo
          </Button>
        )}
        {entry.undo === "undone" && <span className="shrink-0 pt-1 text-xs text-slate-400 dark:text-slate-500">Undone</span>}
        {entry.undo === "recently_deleted" && (
          <Link to="/RecentlyDeleted" className="shrink-0 pt-1 text-xs font-medium text-slate-600 underline dark:text-slate-300">
            In Recently Deleted
          </Link>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}

/** Group log entries under a heading per day, newest first. */
function byDay(activity) {
  const groups = [];
  for (const entry of activity) {
    const day = new Date(entry.created_date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}

export default function ConnectedAppsSection() {
  const online = useOnlineStatus();
  const [grants, setGrants] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [label, setLabel] = useState("");
  const [allowChanges, setAllowChanges] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState(null);

  const load = useCallback(async () => {
    try {
      const [list, log] = await Promise.all([apiClient.ai.grants(), apiClient.ai.activity()]);
      setGrants(list.grants || []);
      setActivity(log || []);
      setLoadError("");
    } catch (e) {
      setLoadError(e?.message || "Couldn't load connected apps.");
    }
  }, []);

  useEffect(() => {
    if (online) load();
  }, [online, load]);

  const create = async (event) => {
    event.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const result = await apiClient.ai.createToken({ label: label.trim(), can_write: allowChanges, time_zone: browserTimeZone() });
      setCreated(result);
      setLabel("");
      setAllowChanges(false);
      await load();
    } catch (e) {
      setCreateError(e?.message || "The token wasn't made. Try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI apps</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Let Claude, ChatGPT and other AI apps read your tasks and notes, and change them only if you allow it. They can't
          change events from your calendars or delete anything for good, and you can undo what they change.
        </p>
        {!online && <p className="text-xs text-slate-400 dark:text-slate-500">You're offline. Connected apps need a connection.</p>}
        {loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}
        {grants && grants.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500" data-testid="ai-no-grants">Nothing connected yet.</p>}
        {grants && grants.length > 0 && (
          <Card className="divide-y divide-slate-100 dark:divide-[#303030]" data-testid="ai-grants">
            {grants.map((grant) => (
              <GrantRow key={grant.id} grant={grant} online={online} onChanged={load} />
            ))}
          </Card>
        )}
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-[#303030]">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Connect an app with a token</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          For apps you set up yourself: Claude Code, Claude Desktop, Cursor, LM Studio, Gemini CLI and Open WebUI.
        </p>
        {created ? (
          <NewToken created={created} onDone={() => setCreated(null)} />
        ) : (
          <form onSubmit={create} className="space-y-3">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Name it, e.g. Claude Code"
              maxLength={100}
              aria-label="Token name"
              data-testid="ai-token-label"
            />
            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              <Checkbox checked={allowChanges} onCheckedChange={setAllowChanges} aria-label="Allow changes to tasks" data-testid="ai-token-allow-changes" />
              Allow changes to tasks
            </label>
            <Button type="submit" className="w-full" disabled={!online || creating || !label.trim()} data-testid="ai-token-create">
              {creating ? "Making the token…" : "Create token"}
            </Button>
            {createError && <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>}
          </form>
        )}
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-5 dark:border-[#303030]">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent changes by AI apps</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No changes yet.</p>
        ) : (
          byDay(activity).map((group) => (
            <div key={group.day} className="space-y-1.5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{group.day}</p>
              <Card>
                <ul className="divide-y divide-slate-100 dark:divide-[#303030]">
                  {group.entries.map((entry) => (
                    <ActivityRow key={entry.id} entry={entry} online={online} onUndone={load} />
                  ))}
                </ul>
              </Card>
            </div>
          ))
        )}
      </div>
    </>
  );
}
