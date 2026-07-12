import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { RouterProvider } from '@tanstack/react-router';

import { queryClient, router } from './router';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} context={{ queryClient }} />
  </StrictMode>,
);
