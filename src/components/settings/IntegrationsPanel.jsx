// @ts-nocheck
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Loader2, AlertTriangle } from "lucide-react";
import { ClearButton } from "@/components/ui/clear-button";
import { cn } from "@/lib/utils";
import { SettingRow, SettingsSection, settingsTag } from "./parts";
import ConfigureCalendarsModal from "./ConfigureCalendarsModal";
import ConnectAppleModal from "./ConnectAppleModal";
import { integrationNotices, providerLabel } from "@/lib/integrationNotices";

const PROVIDERS = [
  { id: "google", label: "Google Calendar" },
  { id: "apple", label: "Apple Calendar" },
];

function ConnectedRow({
  integration,
  onDisconnect,
  onConfigure,
  isDisconnecting,
  showDefaultControl,
  onMakeDefault,
  settingDefault,
  offline,
}) {
  const notices = integrationNotices(integration);
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-ink-100">
              {providerLabel(integration.provider)}
            </p>
            {integration.is_default && showDefaultControl && (
              <span className={settingsTag} title="New tasks made in Zephyrly go to this calendar.">
                Default
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-ink-400">
            {integration.external_account_email}
          </p>
        </div>
        {showDefaultControl && !integration.is_default && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1 px-2 text-xs text-ink-600 dark:text-ink-300"
            onClick={() => onMakeDefault(integration.id)}
            disabled={settingDefault || offline || integration.status !== "active"}
            title="Send new tasks to this calendar"
          >
            {settingDefault && <Loader2 className="h-3 w-3 animate-spin" />}
            Make default
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => onConfigure(integration)}
          disabled={integration.status !== "active"}
          title="Choose which calendars to sync"
        >
          Configure
        </Button>
        {isDisconnecting ? (
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-ink-400 dark:text-ink-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        ) : (
          <ClearButton
            label={`Disconnect ${providerLabel(integration.provider)}`}
            onClick={() => { if (!offline) onDisconnect(integration.id); }}
            className={cn("h-7 w-7", offline && "pointer-events-none opacity-40")}
          />
        )}
      </div>
      {/* What's wrong, if anything, in words that say what to do about it
          (src/lib/integrationNotices.js). The server's own error text is for
          the log. */}
      {notices.length > 0 && (
        <div className="mt-2 space-y-1">
          {notices.map((notice) => (
            <p
              key={notice.kind}
              data-testid={`integration-notice-${notice.kind}`}
              className="flex items-start gap-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300"
            >
              {notice.kind === "reconnect" && <AlertTriangle className="mt-1 h-3 w-3 shrink-0" />}
              <span>{notice.text}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectCard({ provider, onConnect, connecting, disabled }) {
  return (
    <SettingRow label={provider.label} hint="Not connected">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || connecting}
        onClick={() => onConnect(provider.id)}
      >
        {connecting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
        Connect
      </Button>
    </SettingRow>
  );
}

export default function IntegrationsPanel() {
  const online = useOnlineStatus();
  const offline = !online;
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
    <SettingsSection
      id="calendar-integrations"
      label="Connected calendars"
      hint="Tasks with a date show up in your calendar, and your calendar's events show up here."
    >
      <div className="space-y-2.5">
      {offline && (
        <p className="rounded-lg border border-amber-100 dark:border-night-warn-line bg-amber-50 dark:bg-night-warn px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          You're offline. This is the last list this device saw; connecting, disconnecting
          and changing calendars need a connection.
        </p>
      )}
      {integrationError && (
        <p className="text-xs text-red-600 dark:text-red-300">
          Connection failed: {integrationError.replace(/_/g, " ")}
        </p>
      )}
      {error && (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          Couldn't load your calendars: {error.message || "network error"}
        </p>
      )}
      {isLoading ? (
        <div className="flex items-center gap-2 px-1 text-xs text-ink-500 dark:text-ink-400">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="ds-list">
          {googleRow ? (
            <ConnectedRow
              integration={googleRow}
              onConfigure={setConfiguring}
              onDisconnect={handleDisconnect}
              isDisconnecting={disconnecting && pendingDisconnectId === googleRow.id}
              showDefaultControl={showDefaultControl}
              onMakeDefault={setDefault}
              settingDefault={settingDefault}
              offline={offline}
            />
          ) : (
            <ConnectCard
              provider={PROVIDERS[0]}
              onConnect={handleConnect}
              connecting={false}
              disabled={offline}
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
              offline={offline}
            />
          ) : (
            <ConnectCard
              provider={PROVIDERS[1]}
              onConnect={handleConnect}
              connecting={false}
              disabled={offline}
            />
          )}
        </div>
      )}
      </div>
      <ConfigureCalendarsModal
        open={!!configuring}
        onOpenChange={(open) => { if (!open) setConfiguring(null); }}
        integration={configuring}
      />
      <ConnectAppleModal
        open={showAppleConnect}
        onOpenChange={setShowAppleConnect}
      />
    </SettingsSection>
  );
}
