import { Suspense, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { ThemeProvider } from "@/lib/ThemeProvider";
import { loadFromCache } from "@/lib/offlineCache";
import { startPath } from "@/lib/navigation";
import { lazyPage } from "@/lib/lazy-page";
import Layout from "@/components/Layout";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageNotFound from "./lib/PageNotFound";

// Each page's code is fetched when the page is first opened (lib/lazy-page.js),
// so the app's first screen doesn't wait for the other nine.
const Home = lazyPage(() => import("@/pages/Home.jsx"));
const Today = lazyPage(() => import("@/pages/Today.jsx"));
const Active = lazyPage(() => import("@/pages/Active"));
const Groupings = lazyPage(() => import("@/pages/Groupings.jsx"));
const Completed = lazyPage(() => import("@/pages/Completed.jsx"));
const Calendar = lazyPage(() => import("@/pages/Calendar.jsx"));
const Notes = lazyPage(() => import("@/pages/Notes.jsx"));
const Settings = lazyPage(() => import("@/pages/Settings.jsx"));
const RecentlyDeleted = lazyPage(() => import("@/pages/RecentlyDeleted.jsx"));
const Login = lazyPage(() => import("@/pages/Login.jsx"));
const AuthCallback = lazyPage(() => import("@/pages/AuthCallback.jsx"));
const Connect = lazyPage(() => import("@/pages/Connect.jsx"));
const TermsPage = lazyPage(() => import("@/pages/Legal.jsx").then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazyPage(() => import("@/pages/Legal.jsx").then((m) => ({ default: m.PrivacyPage })));

/** The app's own pages, by address. */
const PAGES = {
  "/Home": Home,
  "/Today": Today,
  "/Active": Active,
  "/Groupings": Groupings,
  "/Completed": Completed,
  "/Calendar": Calendar,
  "/Notes": Notes,
  "/Settings": Settings,
  "/RecentlyDeleted": RecentlyDeleted,
};

// The page being opened starts downloading now, beside the sign-in check,
// not after it.
try {
  const first = window.location.pathname === "/" ? startPath() : window.location.pathname;
  PAGES[first]?.preload();
} catch { /* it loads when it is drawn */ }

/**
 * Once the first page is up and the browser has a quiet moment, fetch
 * the rest, so going anywhere afterwards is instant (and works offline
 * even before the service worker has kept its copy).
 */
function usePagesFetchedAhead() {
  useEffect(() => {
    const fetchRest = () => Object.values(PAGES).forEach((page) => page.preload());
    // A moment after the first page, so its own data isn't competing with
    // code nobody has asked for yet, and then only when the browser is idle.
    let idle = 0;
    const timer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(fetchRest, { timeout: 4000 });
      else fetchRest();
    }, 1500);
    return () => {
      window.clearTimeout(timer);
      if (idle) window.cancelIdleCallback?.(idle);
    };
  }, []);
}

const spinner = (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-ink-200 border-t-ink-800 rounded-full animate-spin" />
  </div>
);

/** Pages anyone can read, signed in or not (Stripe links to them). */
const LEGAL_PATHS = new Set(["/terms", "/privacy"]);

function DefaultRedirect() {
  return <Navigate to={startPath()} replace />;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, checkAppState } = useAuth();
  const location = useLocation();
  usePagesFetchedAhead();

  const hasCachedData = Boolean(
    (loadFromCache("tasks") || []).length ||
    (loadFromCache("priorities") || []).length ||
    (loadFromCache("savedTags") || []).length ||
    (loadFromCache("deletedTasks") || []).length ||
    loadFromCache("publicSettings")
  );
  const isOffline = !navigator.onLine;
  const isLegalRoute = LEGAL_PATHS.has(location.pathname.toLowerCase());
  const isAuthRoute = location.pathname === "/login" || location.pathname === "/auth/callback" || isLegalRoute;

  useEffect(() => {
    if (authError?.type === "auth_required" && !isOffline && !isAuthRoute) {
      navigateToLogin();
    }
  }, [authError, isAuthRoute, isOffline, navigateToLogin]);

  if ((isLoadingPublicSettings || isLoadingAuth) && !(isOffline && hasCachedData) && !isLegalRoute) {
    return spinner;
  }

  if (authError && !isLegalRoute) {
    if (authError.type === "auth_required" && !isOffline && !isAuthRoute) return null;
    if (authError.type !== "auth_required") {
      return (
        <div className="fixed inset-0 flex items-center justify-center px-4">
          <div className="max-w-sm w-full bg-surface-card border border-border-strong rounded-2xl p-6 text-center shadow-sm">
            <h1 className="text-base font-semibold text-ink-900 dark:text-ink-100">Couldn&apos;t load Zephyrly</h1>
            <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">{authError.message || "Something went wrong while loading the app."}</p>
            <button
              onClick={() => checkAppState()}
              className="mt-4 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-[var(--primary-hover)]"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    // Pages inside the app's frame wait behind Layout's own outline; this
    // one is for the pages outside it (sign-in, Terms, an AI app connecting).
    <Suspense fallback={spinner}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      {/* An AI app asking to connect ("Sign in with Zephyrly"); needs sign-in, outside the app's chrome. */}
      <Route path="/connect/:requestId" element={<Connect />} />
      <Route element={<Layout />}>
        <Route path="/" element={<DefaultRedirect />} />
        <Route path="/Home" element={<Home />} />
        <Route path="/Active" element={<Active />} />
        <Route path="/Today" element={<Today />} />
        <Route path="/Completed" element={<Completed />} />
        <Route path="/Groupings" element={<Groupings />} />
        <Route path="/Calendar" element={<Calendar />} />
        <Route path="/Notes" element={<Notes />} />
        <Route path="/Settings" element={<Settings />} />
        <Route path="/RecentlyDeleted" element={<RecentlyDeleted />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <ThemeProvider>
      {/* The last line of defence: a break in the frame itself. */}
      <ErrorBoundary full>
        <AuthProvider>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <AuthenticatedApp />
            </Router>
          </QueryClientProvider>
        </AuthProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
