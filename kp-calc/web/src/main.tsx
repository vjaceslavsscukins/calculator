import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { AppProvider, useApp } from './app.tsx';
import { Layout } from './components/Layout.tsx';
import { LoginPage } from './pages/Login.tsx';
import { InvitePage } from './pages/Invite.tsx';
import { ClientsPage } from './pages/Clients.tsx';
import { ClientPage } from './pages/Client.tsx';
import { CalculationPage } from './pages/Calculation.tsx';
import { CalculationsPage } from './pages/Calculations.tsx';
import { PricesPage } from './pages/Prices.tsx';
import { CoefficientsPage } from './pages/Coefficients.tsx';
import { UsersPage } from './pages/Users.tsx';
import { AuditPage } from './pages/Audit.tsx';
import { KpBuildPage } from './pages/KpBuild.tsx';
import { KpPage } from './pages/Kp.tsx';
import { CompanyPage } from './pages/Company.tsx';
import { SpecPage } from './pages/Spec.tsx';
import type { Role } from './api.ts';

function Guard({ roles, children }: { roles?: Role[]; children: JSX.Element }) {
  const { user } = useApp();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/clients" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useApp();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/clients" replace /> : <LoginPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:id" element={<ClientPage />} />
        <Route path="/clients/:id/kp/new" element={<KpBuildPage />} />
        <Route path="/kp/:id" element={<KpPage />} />
        <Route path="/calculations" element={<CalculationsPage />} />
        <Route path="/calculations/:id" element={<CalculationPage />} />
        <Route path="/calculations/:id/spec" element={<SpecPage />} />
        <Route path="/prices" element={<Guard roles={['owner', 'head']}><PricesPage /></Guard>} />
        <Route path="/audit" element={<Guard roles={['owner', 'head']}><AuditPage /></Guard>} />
        <Route path="/settings" element={<Navigate to="/settings/coefficients" replace />} />
        <Route path="/settings/coefficients" element={<Guard roles={['owner']}><CoefficientsPage /></Guard>} />
        <Route path="/settings/users" element={<Guard roles={['owner']}><UsersPage /></Guard>} />
        <Route path="/settings/company" element={<Guard roles={['owner']}><CompanyPage /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/clients' : '/login'} replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <AppRoutes />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
