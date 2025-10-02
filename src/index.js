import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Se você quer que seu aplicativo funcione offline e carregue mais rápido,
// você pode mudar unregister() para register() abaixo. Note que isso vem com algumas armadilhas.
// Saiba mais sobre service workers: https://cra.link/PWA
serviceWorkerRegistration.unregister();

