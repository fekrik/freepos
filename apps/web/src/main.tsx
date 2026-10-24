import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { LaneLogin } from './pages/LaneLogin';
import { Lane } from './pages/Lane';
import { AdminLogin } from './pages/AdminLogin';
import { BackOffice } from './pages/BackOffice';
import { CustomerDisplay } from './pages/CustomerDisplay';
import { session } from './api';

function RequireAuth({ children, to, scope }: { children: React.ReactElement; to: string; scope: 'lane' | 'admin' }) {
  return session.get(scope) ? children : <Navigate to={to} replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/lane/login" replace />} />
        <Route path="/lane/login" element={<LaneLogin />} />
        <Route path="/lane" element={<RequireAuth to="/lane/login" scope="lane"><Lane /></RequireAuth>} />
        <Route path="/cfd" element={<CustomerDisplay />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/*" element={<RequireAuth to="/admin/login" scope="admin"><BackOffice /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
