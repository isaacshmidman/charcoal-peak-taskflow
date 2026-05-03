// @ts-nocheck
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useIntegrations } from "@/hooks/useIntegrations";
import { Loader2, AlertTriangle, Settings2, X, Star } from "lucide-react";
import ConfigureCalendarsModal from "./ConfigureCalendarsModal";
import ConnectAppleModal from "./ConnectAppleModal";

const PROVIDERS = [
  { id: "google", label: "Google Calendar" },
  { id: "apple", label: "Apple Calendar" },
];

function providerLabel(p) {
  if (p === "google") return "Google Calendar";
  if (p === "apple") return "iCloud Calendar";
  return p;
}

function ConnectedRow({
  integration,
  onDisconnect,
  onConfigure,
  isDisconnecting,
  showDefaultControl,
  onMakeDefault,
  settingDefault,
}) {
  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-3 space-y-1.5">
      {/* Header row: provider title + Default badge on the left, disconnect X
          on the far right. The title flex-shrinks via `truncate` so a long
          provider/account name ellipses BEFORE pushing the badge into the X. */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
              {providerLabel(integration.provider)}
            </p>
            {integration.is_default && (
              <span
                className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-amber-50 dark:bg-amber-950/45 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                title="New tasks created in Zephyrly are pushed here."
              >
                <Star className="w-2.5 h-2.5 fill-current" /> Default
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
            {integration.external_account_email}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-7 w-7 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
          onClick={() => onDisconnect(integration.id)}
          disabled={isDisconnecting}
          title="Disconnect"
          aria-label="Disconnect"
        >
          {isDisconnecting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <X className="w-3.5 h-3.5" strokeWidth={2.5} />
          )}
        </Button>
      </div>

      {/* Action buttons span the full card width now that the X has moved up.
          Configure is always shown; "Make default" only when there's >1 active
          integration to choose between, and renders as a second full-width row. */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-full text-xs gap-1"
        onClick={() => onConfigure(integration)}
        disabled={integration.status !== "active"}
        title="Choose which calendars to sync"
      >
        <Settings2 className="w-3 h-3" />
        Configure
      </Button>
      {showDefaultControl && !integration.is_default && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full text-xs gap-1"
          onClick={() => onMakeDefault(integration.id)}
          disabled={settingDefault || integration.status !== "active"}
          title="Make this the default destination for new tasks"
        >
          {settingDefault ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Star className="w-3 h-3" />
          )}
          Make default
        </Button>
      )}
      {integration.status === "needs_reauth" && (
        <p className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300 pt-0.5">
          <AlertTriangle className="w-3 h-3" /> Needs reauth — reconnect to resume syncing.
        </p>
      )}
      {integration.last_error && (
        <p className="text-[11px] text-amber-600 dark:text-amber-300 pt-0.5">{integration.last_error}</p>
      )}
    </div>
  );
}

function ConnectCard({ provider, onConnect, connecting, disabled }) {
  return (
    <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-3 flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{provider.label}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {provider.comingSoon ? "Coming soon" : "Not connected"}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || connecting || provider.comingSoon}
        onClick={() => onConnect(provider.id)}
        title={provider.comingSoon ? "Coming soon" : undefined}
        className={provider.comingSoon ? "cursor-not-allowed opacity-60" : undefined}
      >
        {connecting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
        Connect
      </Button>
    </div>
  );
}

export default function IntegrationsPanel() {
  const {
    integrations,
    isLoading,
    error,
    connectGoogle,
    disconnect,
    disconnecting,
    setDefault,
    settingDefault,
  } = useIntegrations();
  const [pendingDisconnectId, setPendingDisconnectId] = useState(null);
  const [configuring, setConfiguring] = useState(/** @type {any} */ (null));
  const [showAppleConnect, setShowAppleConnect] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const integrationError = params.get("integration_error");

  // Auto-clear the `?integration_error=...` query param after a few seconds so a
  // stale OAuth-failure message from a previous attempt doesn't keep resurfacing
  // on every visit to /Settings. The param is set by the backend's OAuth
  // callback redirect; once we've shown it once, it's done its job.
  useEffect(() => {
    if (!integrationError) return;
    const t = setTimeout(() => {
      navigate(location.pathname + location.hash, { replace: true });
    }, 8000);
    return () => clearTimeout(t);
  }, [integrationError, navigate, location.pathname, location.hash]);

  const googleRow = integrations.find((i) => i.provider === "google");
  const appleRow = integrations.find((i) => i.provider === "apple");
  const showDefaultControl =
    integrations.filter((i) => i.status === "active").length > 1;

  const handleConnect = (providerId) => {
    if (providerId === "google") connectGoogle("/Settings#calendar-integrations");
    if (providerId === "apple") setShowAppleConnect(true);
  };

  const handleDisconnect = async (id) => {
    if (!window.confirm("Disconnect this calendar? Imported calendar events will be removed from Zephyrly. Zephyrly tasks will remain.")) return;
    setPendingDisconnectId(id);
    try {
      await disconnect(id);
    } finally {
      setPendingDisconnectId(null);
    }
  };

  return (
    <section id="calendar-integrations" className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Calendar Integrations</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          Sync your tasks with Google Calendar or iCloud Calendar. Google uses OAuth; iCloud uses
          an app-specific password encrypted on the backend.
        </p>
      </div>
      {integrationError && (
        <p className="text-xs text-red-600 dark:text-red-300">
          Connection failed: {integrationError.replace(/_/g, " ")}
        </p>
      )}
      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          Couldn't load integrations: {error.message || "network error"}
        </p>
      )}
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {googleRow ? (
            <ConnectedRow
              integration={googleRow}
              onConfigure={setConfiguring}
              onDisconnect={handleDisconnect}
              isDisconnecting={disconnecting && pendingDisconnectId === googleRow.id}
              showDefaultControl={showDefaultControl}
              onMakeDefault={setDefault}
              settingDefault={settingDefault}
            />
          ) : (
            <ConnectCard
              provider={PROVIDERS[0]}
              onConnect={handleConnect}
              connecting={false}
            />
          )}
          {appleRow ? (
            <ConnectedRow
              integration={appleRow}
              onConfigure={setConfiguring}
              onDisconnect={handleDisconnect}
              isDisconnecting={disconnecting && pendingDisconnectId === appleRow.id}
              showDefaultControl={showDefaultControl}
              onMakeDefault={setDefault}
              settingDefault={settingDefault}
            />
          ) : (
            <ConnectCard
              provider={PROVIDERS[1]}
              onConnect={handleConnect}
              connecting={false}
            />
          )}
        </div>
      )}
      <ConfigureCalendarsModal
        open={!!configuring}
        onOpenChange={(open) => { if (!open) setConfiguring(null); }}
        integration={configuring}
      />
      <ConnectAppleModal
        open={showAppleConnect}
        onOpenChange={setShowAppleConnect}
      />
    </section>
  );
}
