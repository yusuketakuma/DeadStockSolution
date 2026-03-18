import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { initSentry } from './config/sentry';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/sections/header.css';
import './styles/sections/layout-sidebar.css';
import './styles/sections/content.css';
import './styles/sections/mobile.css';
import './styles/sections/gesture.css';
import './styles/sections/mobile-sheets.css';
import './styles/design-language.css';
import App from './App';

initSentry();

function shouldAttachManifest(vercelEnv: string, hostname: string): boolean {
  if (vercelEnv === 'preview') {
    return false;
  }
  return hostname.length > 0;
}

if (shouldAttachManifest(__VERCEL_ENV__, window.location.hostname)) {
  const manifestLink = document.createElement('link');
  manifestLink.rel = 'manifest';
  manifestLink.href = '/manifest.json';
  document.head.appendChild(manifestLink);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
