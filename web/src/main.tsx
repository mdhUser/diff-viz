import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './index.css';
import { App } from './App';
import { initApiToken } from './api';
import { I18nProvider } from './i18n';
import { SettingsProvider } from './settings';
import { SettingsSync } from './components/SettingsSync';

// Capture `?token=` before the first render: every API call needs it.
initApiToken();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      <I18nProvider>
        <SettingsSync />
        <App />
      </I18nProvider>
    </SettingsProvider>
  </React.StrictMode>,
);
