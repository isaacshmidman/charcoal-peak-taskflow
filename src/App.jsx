import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { queryClientInstance } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { loadFromCache } from "@/lib/offlineCache";
import { sanitizeNavRoute } from "@/lib/navigation";
import UserNotRegisteredError from "@/components/UserNotRegisteredError";
import Layout from "@/components/Layout";
import PageNotFound from "./lib/PageNotFound";
import Active from "@/pages/Active";
import AuthCallback from "@/pages/AuthCallback.jsx";
import Today from "@/pages/Today.jsx";
import Completed from "@/pages/Completed.jsx";
import Groupings from "@/pages/Groupings.jsx";
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
    if (authError.type === "user_not_registered") return <UserNotRegisteredError />;
    if (authError.type === "auth_required" && !isOffline && !isAuthRoute) return null;
    if (authError.type !== "auth_required") {
      return (
        <div className="fixed inset-0 flex items-center justify-center px-4">
          <div className="max-w-sm w-full bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-sm">
            <h1 className="text-base font-semibold text-slate-900">Couldn&apos;t load Taskflow</h1>
            <p className="text-sm text-slate-500 mt-2">{authError.message || "Something went wrong while loading the app."}</p>
            <button
              onClick={() => checkAppState()}
              className="mt-4 h-9 px-4 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
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
        <Route path="/Settings" element={<Settings />} />
        <Route path="/RecentlyDeleted" element={<RecentlyDeleted />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
