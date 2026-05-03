import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { appConfig, getStoredAccessToken } from "@/lib/app-config";
import { useAuth } from "@/lib/AuthContext";
import { sanitizeNavRoute } from "@/lib/navigation";
import { recordLastSignIn } from "@/pages/Login";

function buildFallbackRoute() {
  return sanitizeNavRoute(localStorage.getItem("defaultNav"));
}

function resolveNextPath(rawValue) {
  const fallback = buildFallbackRoute();
  if (!rawValue) return fallback;

  try {
    const nextUrl = new URL(rawValue, window.location.origin);
    if (nextUrl.origin !== window.location.origin) {
      return fallback;
    }
    return `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` || fallback;
  } catch {
    return fallback;
  }
}

export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const { completeLogin } = useAuth();

  const token = appConfig.token || getStoredAccessToken();

  const nextPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return resolveNextPath(params.get("next"));
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;

    const finishLogin = async () => {
      try {
        const user = await completeLogin(token);
        if (!cancelled && user) {
          // Google is currently the only OAuth provider that lands here.
          // If/when more are added, the callback URL should carry a
          // `provider=` param and we'd record that instead.
          recordLastSignIn("google");
          navigate(nextPath, { replace: true });
          return;
        }
      } catch {}

      if (!cancelled) {
        navigate(`/login?next=${encodeURIComponent(nextPath)}`, { replace: true });
      }
    };

    finishLogin();

    return () => {
      cancelled = true;
    };
  }, [completeLogin, navigate, nextPath, token]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-[#343434] bg-white dark:bg-[#111111] p-8 shadow-sm text-center">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center">
          <LoaderCircle className="w-5 h-5 animate-spin" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-slate-900 dark:text-slate-100">Finishing sign-in</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          We&apos;re connecting your Google session and bringing you back into Zephyrly.
        </p>
      </div>
    </div>
  );
}
