import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { KeyRound, Mail } from "lucide-react";
import { apiClient } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import { safeInAppPath, sanitizeNavRoute } from "@/lib/navigation";

const SIGN_IN_ERRORS = {
  google_not_configured: "Google sign-in isn't set up on this server yet.",
  google_sign_in_failed: "Google sign-in didn't complete. Please try again.",
  google_email_unverified: "Google hasn't confirmed this account's email address, so it can't be used to sign in.",
  google_account_mismatch: "This email address is already linked to a different Google account. Sign in with that one.",
  invalid_oauth_state: "That sign-in link has expired. Please try again.",
  too_many_attempts: "Too many sign-in attempts. Wait a minute and try again.",
};

// Tracks which provider the user successfully signed in with last on this
// device. Per-device only — not synced server-side. Retained because
// AuthCallback records it on Google sign-in; the on-screen "Last used"
// badge was removed since there's effectively a single login method, so
// the hint added noise without value.
const LAST_SIGNIN_KEY = "lastSignInMethod";

export function recordLastSignIn(method) {
  try { localStorage.setItem(LAST_SIGNIN_KEY, method); } catch {}
}

function buildDefaultReturnUrl() {
  const defaultNav = sanitizeNavRoute(localStorage.getItem("defaultNav"));
  return new URL(defaultNav, window.location.origin).toString();
}

function normalizeNextUrl(rawValue) {
  const fallbackUrl = buildDefaultReturnUrl();
  if (!rawValue) return fallbackUrl;

  // Only this site's pages (see safeInAppPath); anything else goes to the default.
  const path = safeInAppPath(rawValue);
  if (!path || new URL(path, window.location.origin).pathname === "/login") return fallbackUrl;
  return new URL(path, window.location.origin).toString();
}

/** Where to go once signed in: the next= page, or the default one. */
function afterSignIn(nextUrl) {
  return safeInAppPath(new URL(nextUrl).pathname) || sanitizeNavRoute(localStorage.getItem("defaultNav"));
}

export default function Login() {
  const location = useLocation();
  const navigate = useNavigate();
  const { loginWithEmailPassword, isAuthenticated, isLoadingAuth, appPublicSettings } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  const hasSession = Boolean(isAuthenticated);
  const googleEnabled = !isOffline && appPublicSettings?.auth_providers?.google === true;
  const emailPasswordEnabled = appPublicSettings?.auth_providers?.email_password === true;

  const nextUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return normalizeNextUrl(params.get("next") || params.get("from_url"));
  }, [location.search]);

  // What went wrong, by code: the words are the page's own, never text
  // from the link, which anyone could write and send.
  const routeAuthError = useMemo(() => {
    const code = new URLSearchParams(location.search).get("auth_error");
    if (!code) return "";
    return SIGN_IN_ERRORS[code] || SIGN_IN_ERRORS.google_sign_in_failed;
  }, [location.search]);

  useEffect(() => {
    if (!hasSession) return;
    navigate(afterSignIn(nextUrl), { replace: true });
  }, [hasSession, navigate, nextUrl]);

  useEffect(() => {
    if (!routeAuthError) return;
    setLoginError(routeAuthError);
  }, [routeAuthError]);

  const handleEmailPasswordSignIn = async (event) => {
    event.preventDefault();
    setLoginError("");

    if (!email.trim() || !password) {
      setLoginError("Enter an email and password to sign in.");
      return;
    }

    try {
      await loginWithEmailPassword(email.trim(), password);
      recordLastSignIn("email");
      navigate(afterSignIn(nextUrl), { replace: true });
    } catch (error) {
      setLoginError(error.message || "Sign-in failed. Please try again.");
    }
  };

  const handleGoogleSignIn = () => {
    if (!googleEnabled) {
      setLoginError("Google sign-in isn't configured for this local backend yet.");
      return;
    }

    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", nextUrl);
    apiClient.auth.loginWithProvider("google", callbackUrl.toString());
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200/80 dark:border-[#343434] bg-white/95 dark:bg-[#111111] backdrop-blur dark:backdrop-blur-none p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2.5 mb-6">
          <img
            src="/zephyrly-logo.png"
            alt="Zephyrly"
            className="w-10 h-10 rounded-xl object-cover"
          />
          <span className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Zephyrly
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 leading-snug">
          Your work doesn't stop when you close the app. Neither do we.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Sign in to pick up where you left off.
        </p>

        {emailPasswordEnabled ? (
          <>
            <form className="mt-6 space-y-3" onSubmit={handleEmailPasswordSignIn}>
              <label className="block">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Email</span>
                <div className="mt-1 flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-[#343434] bg-white dark:bg-[#161616] px-4 h-12">
                  <Mail className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  <input
                    data-testid="login-email"
                    type="text"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Enter any email"
                    className="w-full bg-transparent text-base md:text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    autoComplete="username"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Password</span>
                <div className="mt-1 flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-[#343434] bg-white dark:bg-[#161616] px-4 h-12">
                  <KeyRound className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
                  <input
                    data-testid="login-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter any password"
                    className="w-full bg-transparent text-base md:text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    autoComplete="current-password"
                  />
                </div>
              </label>

              {loginError ? <p className="text-sm text-red-600 dark:text-red-300">{loginError}</p> : null}

              <button
                type="submit"
                data-testid="login-submit"
                disabled={isLoadingAuth}
                className="w-full h-12 rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center"
              >
                <span>{isLoadingAuth ? "Signing in..." : "Sign In"}</span>
              </button>
            </form>

            <div className="mt-5 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
              <div className="h-px flex-1 bg-slate-200 dark:bg-[#222222]" />
              <span>or</span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-[#222222]" />
            </div>
          </>
        ) : (
          loginError ? <p className="mt-6 text-sm text-red-600 dark:text-red-300">{loginError}</p> : null
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={!googleEnabled}
          className={`${emailPasswordEnabled ? "mt-5" : "mt-6"} w-full h-12 rounded-2xl border border-slate-200 dark:border-[#343434] bg-white dark:bg-[#161616] text-slate-900 dark:text-slate-100 text-sm font-medium hover:bg-slate-50 dark:hover:bg-[#222222] inline-flex items-center justify-center gap-3 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.7 3.9-5.4 3.9-3.2 0-5.8-2.7-5.8-6s2.6-6 5.8-6c1.8 0 3 .8 3.7 1.5l2.5-2.4C16.6 3.6 14.5 2.7 12 2.7 6.9 2.7 2.8 6.9 2.8 12s4.1 9.3 9.2 9.3c5.3 0 8.8-3.7 8.8-8.9 0-.6-.1-1-.1-1.4H12Z" />
            <path fill="#34A853" d="M2.8 12c0 2 0.7 3.8 1.9 5.2l3.1-2.4c-.8-.6-1.4-1.7-1.4-2.8s.5-2.2 1.4-2.8L4.7 6.8A9.24 9.24 0 0 0 2.8 12Z" />
            <path fill="#FBBC05" d="M12 21.3c2.5 0 4.6-.8 6.1-2.2l-3-2.3c-.8.6-1.9 1-3.1 1-2.4 0-4.5-1.6-5.2-3.9l-3.2 2.5c1.6 3 4.7 4.9 8.4 4.9Z" />
            <path fill="#4285F4" d="M18.1 19.1c1.8-1.7 2.7-4.1 2.7-7.1 0-.6-.1-1-.1-1.4H12v3.9h5.4c-.2 1.1-.8 2.1-1.7 2.8l3 2.3Z" />
          </svg>
          <span>Sign In with Google</span>
        </button>

        <div className="mt-5 rounded-2xl bg-slate-50 dark:bg-[#161616] border border-slate-200 dark:border-[#343434] px-4 py-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-5">
            {googleEnabled
              ? "Google sign-in will bring you right back to this app automatically."
              : isOffline
                ? emailPasswordEnabled
                  ? "Google sign-in needs an internet connection. Email and password login still works offline."
                  : "Google sign-in needs an internet connection. Reconnect to sign in."
                : emailPasswordEnabled
                  ? "Google sign-in is currently disabled on this backend. Email and password login still works."
                  : "Google sign-in is currently disabled on this backend. Contact the administrator for access."}
          </p>
        </div>

        <p className="mt-5 text-center text-xs text-slate-400 dark:text-slate-500">
          <Link to="/terms" className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-slate-300">
            Terms
          </Link>
          {" · "}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-slate-300">
            Privacy
          </Link>
        </p>
      </div>
    </div>
  );
}
