import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardProvider } from './hooks/BoardProvider.tsx';
import App from './App.tsx';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

createRoot(container).render(
  <StrictMode>
    <BoardProvider>
      <App />
    </BoardProvider>
  </StrictMode>,
);
