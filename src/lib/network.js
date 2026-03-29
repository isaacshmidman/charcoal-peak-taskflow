export function isRecoverableConnectionError(error) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }

  const status = error?.status;
  return status == null || status >= 500;
}
