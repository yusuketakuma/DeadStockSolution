import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import PageLoader from './ui/PageLoader';

interface Props {
  children: React.ReactNode;
  adminOnly?: boolean;
  userOnly?: boolean;
}

export default function ProtectedRoute({ children, adminOnly = false, userOnly = false }: Props) {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageLoader minHeightClassName="route-loading-min-height" />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !user.isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (userOnly && user.isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
