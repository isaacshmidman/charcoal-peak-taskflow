/**
 * @file What Settings says under a connected calendar when something isn't
 * right, in words a person can act on.
 *
 * The server keeps the provider's own error text ("Google events list
 * failed (403): {…}"), which is for the log. Shown raw it told nobody
 * whether to wait, reconnect, or worry.
 */

/**
 * @param {string} provider
 */
export function providerLabel(provider) {
  if (provider === "google") return "Google Calendar";
  if (provider === "apple") return "iCloud Calendar";
  return provider;
}

/**
 * The lines to show, most important first. Empty when all is well.
 *
 * @param {{ provider: string, status?: string, last_error?: string | null, waiting_changes?: number }} integration
 * @returns {Array<{ kind: "reconnect" | "waiting" | "sync", text: string }>}
 */
export function integrationNotices(integration) {
  const name = providerLabel(integration.provider);
  const error = String(integration.last_error || "");
  const refused = /\((401)\)|invalid_grant|rejected the credentials|no refresh token/i.test(error);

  if (integration.status === "needs_reauth" || refused) {
    return [
      {
        kind: "reconnect",
        text:
          integration.provider === "apple"
            ? `${name} no longer accepts the app-specific password. Disconnect, then connect again with a new one.`
            : `${name} no longer accepts this connection. Disconnect, then connect again to carry on syncing.`,
      },
    ];
  }

  const notices = [];
  const waiting = Number(integration.waiting_changes || 0);
  if (waiting > 0) {
    notices.push({
      kind: /** @type {"waiting"} */ ("waiting"),
      text: `${waiting} ${waiting === 1 ? "change" : "changes"} made here ${waiting === 1 ? "hasn't" : "haven't"} reached ${name} yet. Zephyrly keeps trying.`,
    });
  }
  if (error) notices.push({ kind: /** @type {"sync"} */ ("sync"), text: syncProblem(error, name) });
  return notices;
}

/**
 * @param {string} error
 * @param {string} name
 */
function syncProblem(error, name) {
  if (/didn't answer|couldn't reach/i.test(error)) return `${name} couldn't be reached just now. Zephyrly will try again in a minute.`;
  const status = Number(/\((\d{3})\)/.exec(error)?.[1] || 0);
  if (status === 403 || status === 429) return `${name} is limiting how often Zephyrly can ask. It will try again shortly.`;
  if (status >= 500) return `${name} had a problem of its own. Zephyrly will try again in a minute.`;
  if (status === 404 || status === 410) return `A calendar that was being synced is no longer at ${name}. Open Configure to choose again.`;
  return `The last sync with ${name} didn't go through. Zephyrly will try again in a minute.`;
}
