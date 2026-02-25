import { Suspense, type ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { ROUTE_META, type RouteMeta } from './routes/route-config';

function RouteLoadingFallback() {
  return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">読み込み中...</span>
      </div>
    </div>
  );
}

function withRouteSuspense(element: ReactElement): ReactElement {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      {element}
    </Suspense>
  );
}

function renderRouteElement(route: RouteMeta, authenticated: boolean): ReactElement {
  const Screen = route.component;

  if (route.access === 'public') {
    if (authenticated && route.redirectAuthenticatedTo) {
      return <Navigate to={route.redirectAuthenticatedTo} />;
    }
    return <Screen />;
  }

  const protectedContent = route.useLayout ? <Layout><Screen /></Layout> : <Screen />;
  return <ProtectedRoute adminOnly={route.adminOnly}>{protectedContent}</ProtectedRoute>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center auth-fullscreen">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">読み込み中...</span>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {ROUTE_META.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={withRouteSuspense(renderRouteElement(route, Boolean(user)))}
        />
      ))}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
