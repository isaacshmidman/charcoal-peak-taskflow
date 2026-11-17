import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/styles/zephyrly.css'
import '@/index.css'
import { listenForErrors } from '@/lib/report-error'
import { hydrateOfflineCopy } from '@/lib/offlineCache'
import { syncOfflineQueryCache } from '@/lib/query-client'

listenForErrors();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// The lists kept on this device are read into memory first (they are in
// IndexedDB, which answers a moment later), so the first screen is drawn
// with them rather than empty and then filled.
const root = ReactDOM.createRoot(document.getElementById('root'));
hydrateOfflineCopy().then((fromDisk) => {
  if (fromDisk) syncOfflineQueryCache();
  root.render(<App />);
});
