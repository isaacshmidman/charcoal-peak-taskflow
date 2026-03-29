import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { createE2EBase44Client } from '@/lib/e2eBackend';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

const liveBase44Client = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

// Create an in-browser mock client for Playwright E2E mode when available.
export const base44 = createE2EBase44Client() || liveBase44Client;
