import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css'; // You can create a simple css file here if you want

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
