import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { appConfig, getStoredAccessToken } from "@/lib/app-config";
import { useAuth } from "@/lib/AuthContext";
import { safeInAppPath, sanitizeNavRoute } from "@/lib/navigation";
import { recordLastSignIn } from "@/pages/Login";

function buildFallbackRoute() {
  return sanitizeNavRoute(localStorage.getItem("defaultNav"));
}

function resolveNextPath(rawValue) {
  // Only this site's pages, never "//elsewhere" (see safeInAppPath).
  return safeInAppPath(rawValue) || buildFallbackRoute();
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
      <div className="w-full max-w-md rounded-[20px] border border-border-hairline bg-surface-card p-8 shadow-hero text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center">
          <LoaderCircle className="w-5 h-5 animate-spin" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-ink-900 dark:text-ink-100">Finishing sign-in</h1>
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
          We&apos;re connecting your Google session and bringing you back into Zephyrly.
        </p>
      </div>
    </div>
  );
}
