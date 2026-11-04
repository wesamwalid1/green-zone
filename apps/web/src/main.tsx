import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { EditPasswordPrompt } from './components/EditPasswordPrompt';
import { AuthProvider } from './lib/auth';
import { FeedbackProvider } from './lib/feedback';
import { ThemeProvider } from './lib/theme';
import './index.css';
import './lib/appearance';
import { installPrintPrep } from './lib/printPrep';

installPrintPrep();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <FeedbackProvider>
        <BrowserRouter>
          <AuthProvider>
            <ErrorBoundary>
              <App />
              <EditPasswordPrompt />
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </FeedbackProvider>
    </ThemeProvider>
  </StrictMode>,
);
