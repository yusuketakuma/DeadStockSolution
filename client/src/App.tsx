import { Suspense, useEffect, type ReactElement } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { TimelineProvider } from './contexts/TimelineContext';
import { ToastProvider } from './contexts/ToastContext';
import AppToastContainer from './components/ui/AppToastContainer';
import ErrorBoundary, { ErrorFallback } from './components/ui/ErrorBoundary';
import { Sentry, isSentryEnabled } from './config/sentry';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import AppScreen from './components/ui/AppScreen';
import PageLoader from './components/ui/PageLoader';
import { ROUTE_META, type RouteMeta } from './routes/route-config';
import { DESIGN_PRESET_STORAGE_KEY, isDesignPresetId } from './design/genericDesignPresets';

function RouteLoadingFallback() {
  return <PageLoader />;
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

  const protectedContent = route.useLayout
    ? <Layout><Screen /></Layout>
    : (
      <div className="app-theme">
        <AppScreen>
          <Screen />
        </AppScreen>
      </div>
    );
  return <ProtectedRoute adminOnly={route.adminOnly}>{protectedContent}</ProtectedRoute>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageLoader fullHeight />;
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
  useEffect(() => {
    document.body.classList.add('app-theme-root');
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(DESIGN_PRESET_STORAGE_KEY); } catch { /* SSR/test */ }
    const preset = isDesignPresetId(stored) ? stored : 'clinical-calm';
    document.body.setAttribute('data-design-preset', preset);
    return () => document.body.classList.remove('app-theme-root');
  }, []);

  const content = (
    <AuthProvider>
      <TimelineProvider>
        <NotificationProvider>
          <ToastProvider>
            <ErrorBoundary>
              <AppRoutes />
              <AppToastContainer />
            </ErrorBoundary>
          </ToastProvider>
        </NotificationProvider>
      </TimelineProvider>
    </AuthProvider>
  );

  if (isSentryEnabled()) {
    return <Sentry.ErrorBoundary fallback={<ErrorFallback />}>{content}</Sentry.ErrorBoundary>;
  }

  return content;
}
