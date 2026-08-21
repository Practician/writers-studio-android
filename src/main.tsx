import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installDirectApiBridge, isAutonomousApk } from './lib/directLlmClient';

// В Android APK серверные маршруты заменяются прямыми запросами к выбранному
// ИИ-провайдеру. В web-версии исходное поведение сохраняется.
installDirectApiBridge();

// Внутри APK web bundle уже находится локально; service worker нужен только web/PWA-версии.
if (!isAutonomousApk() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('PWA Service Worker registered successfully:', reg.scope))
      .catch((err) => console.error('PWA Service Worker registration failed:', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
