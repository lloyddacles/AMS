import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { OfflineProvider } from './offline/OfflineProvider.jsx';
import './styles.css';

// A deploy can remove the asset chunks this tab was built with (the server then
// falls back to HTML, which fails the module MIME check). Vite surfaces that as
// vite:preloadError — reload once to pick up the fresh build instead of dying.
const CHUNK_RELOAD_AT = 'chunk-reload-at';
const lastChunkReload = Number(sessionStorage.getItem(CHUNK_RELOAD_AT) || 0);
window.addEventListener('vite:preloadError', (event) => {
  if (Date.now() - lastChunkReload < 60000) return; // already retried this minute
  sessionStorage.setItem(CHUNK_RELOAD_AT, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

// Long-lived tabs should notice deploys when they come back to the foreground,
// rather than waiting for the service worker's periodic update check.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  navigator.serviceWorker?.getRegistration?.()?.update?.().catch(() => {});
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <OfflineProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </OfflineProvider>
    </BrowserRouter>
  </React.StrictMode>
);
