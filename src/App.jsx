import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { ThemeProvider } from "@/lib/ThemeProvider";
import { loadFromCache } from "@/lib/offlineCache";
import { sanitizeNavRoute } from "@/lib/navigation";
import Layout from "@/components/Layout";
import PageNotFound from "./lib/PageNotFound";
import Active from "@/pages/Active";
import AuthCallback from "@/pages/AuthCallback.jsx";
import Today from "@/pages/Today.jsx";
import Completed from "@/pages/Completed.jsx";
import Groupings from "@/pages/Groupings.jsx";
import Calendar from "@/pages/Calendar.jsx";
import Login from "@/pages/Login.jsx";
import Settings from "@/pages/Settings.jsx";
import RecentlyDeleted from "@/pages/RecentlyDeleted.jsx";

function DefaultRedirect() {
  const defaultNav = sanitizeNavRoute(localStorage.getItem("defaultNav"));
  return <Navigate to={defaultNav} replace />;
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, checkAppState } = useAuth();
  const location = useLocation();

  const hasCachedData = Boolean(
    (loadFromCache("tasks") || []).length ||
    (loadFromCache("priorities") || []).length ||
    (loadFromCache("savedTags") || []).length ||
    (loadFromCache("deletedTasks") || []).length ||
    loadFromCache("publicSettings")
  );
  const isOffline = !navigator.onLine;
  const isAuthRoute = location.pathname === "/login" || location.pathname === "/auth/callback";

  useEffect(() => {
    if (authError?.type === "auth_required" && !isOffline && !isAuthRoute) {
      navigateToLogin();
    }
  }, [authError, isAuthRoute, isOffline, navigateToLogin]);

  if ((isLoadingPublicSettings || isLoadingAuth) && !(isOffline && hasCachedData)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (authError) {
    if (authError.type === "auth_required" && !isOffline && !isAuthRoute) return null;
    if (authError.type !== "auth_required") {
      return (
        <div className="fixed inset-0 flex items-center justify-center px-4">
          <div className="max-w-sm w-full bg-surface-card border border-border-strong rounded-2xl p-6 text-center shadow-sm">
            <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Couldn&apos;t load Zephyrly</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">{authError.message || "Something went wrong while loading the app."}</p>
            <button
              onClick={() => checkAppState()}
              className="mt-4 h-9 px-4 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-200"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<Layout />}>
        <Route path="/" element={<DefaultRedirect />} />
        <Route path="/Active" element={<Active />} />
        <Route path="/Today" element={<Today />} />
        <Route path="/Completed" element={<Completed />} />
        <Route path="/Groupings" element={<Groupings />} />
        <Route path="/Calendar" element={<Calendar />} />
        <Route path="/Settings" element={<Settings />} />
        <Route path="/RecentlyDeleted" element={<RecentlyDeleted />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
