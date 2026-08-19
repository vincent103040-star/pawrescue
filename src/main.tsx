import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {initLiff} from './utils/liff';

// Fire-and-forget: only does anything when opened inside LINE via a LIFF URL.
initLiff();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
