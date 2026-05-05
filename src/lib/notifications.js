// @ts-check

export const DEFAULT_NOTIFICATION_SETTINGS = {
  enabled: false,
  timeZone: "UTC",
  timedOffsetMinutes: 0,
  allDayEnabled: true,
  allDayTime: "9:00AM",
  includeExternalEvents: false,
  missedGraceMinutes: 120,
};

const MAX_OFFSET_MINUTES = 7 * 24 * 60;

export function getBrowserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function normalizeNotificationSettings(settings, { defaulted = false } = {}) {
  const merged = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...settings,
  };
  return {
    enabled: Boolean(merged.enabled),
    timeZone: defaulted ? getBrowserTimeZone() : String(merged.timeZone || getBrowserTimeZone()),
    timedOffsetMinutes: clampInteger(merged.timedOffsetMinutes, -MAX_OFFSET_MINUTES, MAX_OFFSET_MINUTES, 0),
    allDayEnabled: merged.allDayEnabled !== false,
    allDayTime: taskTimeToNativeTime(merged.allDayTime) ? String(merged.allDayTime) : DEFAULT_NOTIFICATION_SETTINGS.allDayTime,
    includeExternalEvents: Boolean(merged.includeExternalEvents),
    missedGraceMinutes: clampInteger(merged.missedGraceMinutes, 0, 24 * 60, DEFAULT_NOTIFICATION_SETTINGS.missedGraceMinutes),
  };
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

export async function getCurrentPushSubscription() {
  const registration = await getServiceWorkerRegistration();
  if (!registration?.pushManager) return null;
  return registration.pushManager.getSubscription();
}

export async function subscribeCurrentDevice(vapidPublicKey) {
  const registration = await getServiceWorkerRegistration();
  if (!registration?.pushManager) throw new Error("Push notifications are not supported in this browser.");
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export async function unsubscribeCurrentDevice() {
  const subscription = await getCurrentPushSubscription();
  if (!subscription) return "";
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function taskTimeToNativeTime(taskTime) {
  const mins = parseTaskTime(taskTime);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function nativeTimeToTaskTime(nativeTime) {
  const match = String(nativeTime || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return DEFAULT_NOTIFICATION_SETTINGS.allDayTime;
  const h24 = Number(match[1]);
  const mins = Number(match[2]);
  if (h24 < 0 || h24 > 23 || mins < 0 || mins > 59) return DEFAULT_NOTIFICATION_SETTINGS.allDayTime;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mins).padStart(2, "0")}${ampm}`;
}

export function offsetToCustomParts(offsetMinutes) {
  const n = clampInteger(offsetMinutes, -MAX_OFFSET_MINUTES, MAX_OFFSET_MINUTES, 0);
  const direction = n < 0 ? "before" : "after";
  const abs = Math.abs(n);
  if (abs % (24 * 60) === 0 && abs !== 0) {
    return { direction, amount: abs / (24 * 60), unit: "days" };
  }
  if (abs % 60 === 0 && abs !== 0) {
    return { direction, amount: abs / 60, unit: "hours" };
  }
  return { direction, amount: abs, unit: "minutes" };
}

export function customPartsToOffset({ direction, amount, unit }) {
  const value = Math.max(0, Number.parseInt(String(amount || "0"), 10) || 0);
  const multiplier = unit === "days" ? 24 * 60 : unit === "hours" ? 60 : 1;
  const signed = value * multiplier * (direction === "before" ? -1 : 1);
  return clampInteger(signed, -MAX_OFFSET_MINUTES, MAX_OFFSET_MINUTES, 0);
}

function parseTaskTime(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  if (h < 1 || h > 12 || mm < 0 || mm > 59) return null;
  if (h === 12) h = 0;
  if (m[3].toUpperCase() === "PM") h += 12;
  return h * 60 + mm;
}

function clampInteger(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
