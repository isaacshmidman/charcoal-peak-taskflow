// @ts-nocheck
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createAxiosClient } from "@base44/sdk/dist/utils/axios-client";
import { base44 } from "@/api/base44Client";
import { appParams } from "@/lib/app-params";
import { getE2EBackend } from "@/lib/e2eBackend";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  const checkUserAuth = useCallback(async ({ manageLoading = true } = {}) => {
    if (manageLoading) setIsLoadingAuth(true);

    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
      return currentUser;
    } catch (error) {
      console.error("User auth check failed:", error);
      setUser(null);
      setIsAuthenticated(false);

      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: "auth_required",
          message: "Authentication required",
        });
      } else {
        setAuthError({
          type: "unknown",
          message: error.message || "Failed to authenticate",
        });
      }

      return null;
    } finally {
      if (manageLoading) setIsLoadingAuth(false);
    }
  }, []);

  const checkAppState = useCallback(async () => {
    setIsLoadingPublicSettings(true);
    setIsLoadingAuth(true);
    setAuthError(null);

    try {
      const e2eBackend = getE2EBackend();
      if (e2eBackend) {
        setAppPublicSettings(
          e2eBackend.publicSettings || {
            id: "public-settings",
            name: "Taskflow E2E",
            app_id: appParams.appId,
          }
        );

        if (appParams.token) {
          await checkUserAuth({ manageLoading: false });
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
        return;
      }

      const appClient = createAxiosClient({
        baseURL: "/api/apps/public",
        headers: {
          "X-App-Id": appParams.appId,
        },
        token: appParams.token,
        interceptResponses: true,
      });

      const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
      setAppPublicSettings(publicSettings);

      if (appParams.token) {
        await checkUserAuth({ manageLoading: false });
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (appError) {
      console.error("App state check failed:", appError);

      if (appError.status === 403 && appError.data?.extra_data?.reason) {
        const reason = appError.data.extra_data.reason;

        if (reason === "auth_required") {
          setAuthError({ type: "auth_required", message: "Authentication required" });
        } else if (reason === "user_not_registered") {
          setAuthError({ type: "user_not_registered", message: "User not registered for this app" });
        } else {
          setAuthError({ type: reason, message: appError.message });
        }
      } else if (!navigator.onLine) {
        setUser(null);
        setIsAuthenticated(false);
      } else {
        setAuthError({
          type: "unknown",
          message: appError.message || "Failed to load app",
        });
      }
    } finally {
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  }, [checkUserAuth]);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);

    if (shouldRedirect) {
      base44.auth.logout(window.location.href);
    } else {
      base44.auth.logout();
    }
  };

  const navigateToLogin = useCallback(() => {
    base44.auth.redirectToLogin(window.location.href);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        logout,
        navigateToLogin,
        checkAppState,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
