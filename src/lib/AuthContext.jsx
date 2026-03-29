// @ts-nocheck
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiClient } from "@/api/apiClient";
import { appConfig, getStoredAccessToken, getStoredLocalSession, removeAccessToken, removeLocalSession, saveLocalSession } from "@/lib/app-config";
import { syncOfflineQueryCache } from "@/lib/query-client";
import { isRecoverableConnectionError } from "@/lib/network";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  const syncStoredToken = useCallback(() => {
    const token = getStoredAccessToken() || appConfig.token;
    if (token) {
      apiClient.setToken(token, false);
    }
    return token;
  }, []);

  const checkUserAuth = useCallback(async ({ manageLoading = true } = {}) => {
    if (manageLoading) setIsLoadingAuth(true);

    try {
      const currentUser = await apiClient.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setAuthError(null);
      saveLocalSession(currentUser);
      syncOfflineQueryCache();
      return { currentUser, errorType: null };
    } catch (error) {
      console.error("User auth check failed:", error);
      setUser(null);
      setIsAuthenticated(false);

      if (error.status === 401 || error.status === 403) {
        if (navigator.onLine) {
          apiClient.setToken(null, false);
          removeAccessToken();
          removeLocalSession();
          syncOfflineQueryCache();
        }
        setAuthError({
          type: "auth_required",
          message: "Authentication required",
        });
        return { currentUser: null, errorType: "auth_required" };
      } else {
        const errorType = isRecoverableConnectionError(error) ? "offline" : "unknown";
        setAuthError({
          type: errorType,
          message: error.message || "Failed to authenticate",
        });
        return { currentUser: null, errorType };
      }
    } finally {
      if (manageLoading) setIsLoadingAuth(false);
    }
  }, []);

  const checkAppState = useCallback(async () => {
    setIsLoadingPublicSettings(true);
    setIsLoadingAuth(true);
    setAuthError(null);

    try {
      const publicSettings = await apiClient.getPublicSettings();
      setAppPublicSettings(publicSettings);

      syncStoredToken();
      const { currentUser, errorType } = await checkUserAuth({ manageLoading: false });
      if (!currentUser && errorType === "offline") {
        const cachedSession = getStoredLocalSession();
        if (cachedSession) {
          syncOfflineQueryCache();
          setUser(cachedSession);
          setIsAuthenticated(true);
          setAuthError(null);
        }
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
      } else if (isRecoverableConnectionError(appError)) {
        const cachedSession = getStoredLocalSession();
        if (cachedSession) {
          syncOfflineQueryCache();
          setUser(cachedSession);
          setIsAuthenticated(true);
          setAuthError(null);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
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
  }, [checkUserAuth, syncStoredToken]);

  const completeLogin = useCallback(async (token) => {
    if (token) {
      apiClient.setToken(token);
    } else {
      syncStoredToken();
    }

    const result = await checkUserAuth({ manageLoading: false });
    return result.currentUser;
  }, [checkUserAuth, syncStoredToken]);

  const loginWithEmailPassword = useCallback(async (email, password) => {
    setAuthError(null);
    setIsLoadingAuth(true);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      const response = await apiClient.auth.loginWithEmailPassword(normalizedEmail, password);
      const currentUser = await completeLogin(response?.access_token);
      if (!currentUser) {
        throw new Error("Sign-in failed");
      }
      saveLocalSession(currentUser);
      setUser(currentUser);
      setIsAuthenticated(true);
      return response;
    } catch (error) {
      if (isRecoverableConnectionError(error)) {
        const cachedSession = getStoredLocalSession();
        const offlineUser =
          cachedSession?.email?.toLowerCase() === normalizedEmail
            ? cachedSession
            : {
                id: cachedSession?.id || `offline-${normalizedEmail || Date.now()}`,
                email: normalizedEmail,
                role: cachedSession?.role || "member",
                auth_provider: "offline-local",
              };

        saveLocalSession(offlineUser);
        syncOfflineQueryCache();
        setUser(offlineUser);
        setIsAuthenticated(true);
        setAuthError(null);
        return { access_token: null, user: offlineUser, offline: true };
      }

      setUser(null);
      setIsAuthenticated(false);
      setAuthError({
        type: error.status === 401 || error.status === 403 ? "auth_required" : "unknown",
        message: error.message || "Sign-in failed",
      });
      throw error;
    } finally {
      setIsLoadingAuth(false);
    }
  }, [completeLogin]);

  useEffect(() => {
    checkAppState();
  }, [checkAppState]);

  const logout = async (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    setAuthError(null);
    removeLocalSession();
    syncOfflineQueryCache();

    const loginUrl = new URL("/login", window.location.origin).toString();
    if (shouldRedirect) {
      await apiClient.auth.logout(loginUrl);
      window.location.href = loginUrl;
    } else {
      await apiClient.auth.logout(false);
    }
  };

  const navigateToLogin = useCallback((nextUrl = window.location.href) => {
    const loginUrl = new URL("/login", window.location.origin);
    loginUrl.searchParams.set("next", nextUrl);
    window.location.href = loginUrl.toString();
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
        completeLogin,
        loginWithEmailPassword,
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
