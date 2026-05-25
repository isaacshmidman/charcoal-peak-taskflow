// @ts-check
/**
 * @file Integrations runtime gate. Called by every route that touches an
 * integration to fail fast if the feature flag is off or encryption is
 * unavailable. Tiny module on purpose — it's the most-imported sibling.
 */
import { HttpError } from "../http.js";
import {
  isEncryptionAvailable,
  getEncryptionUnavailableReason,
} from "../crypto.js";

export function ensureIntegrationsRuntimeReady(config) {
  if (!config.integrationsEnabled) {
    throw new HttpError(
      503,
      "Calendar integrations are disabled on this backend.",
      "integrations_disabled"
    );
  }
  if (!isEncryptionAvailable()) {
    throw new HttpError(
      503,
      `Calendar integrations unavailable: ${getEncryptionUnavailableReason()}`,
      "encryption_key_missing"
    );
  }
}
