import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { OfflineProvider } from './offline/OfflineProvider.jsx';
import './styles.css';

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
