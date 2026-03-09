import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { initSentry } from './config/sentry';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/sections/header.css';
import './styles/sections/layout-sidebar.css';
import './styles/sections/content.css';
import './styles/sections/mobile.css';
import './styles/design-language.css';
import App from './App';

initSentry();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
