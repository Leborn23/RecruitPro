import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert, Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: string;
  requireSuperAdmin?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  permission,
  requireSuperAdmin,
}) => {
  const { session, loading, hasPermission, isSuperAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary/30" />
      </div>
    );
  }

  if (!session) {
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(location.search);
    const isRecoveryByHash =
      hashParams.get('type') === 'recovery' &&
      !!hashParams.get('access_token') &&
      !!hashParams.get('refresh_token');
    const isRecoveryByQuery = searchParams.get('type') === 'recovery';
    const callbackSuffix = `${location.search}${location.hash}`;

    if (isRecoveryByHash || isRecoveryByQuery) {
      return <Navigate to={`/reset-password${callbackSuffix}`} replace />;
    }
    return <Navigate to={`/login${callbackSuffix}`} replace />;
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <AccessDenied message="仅系统所有者或超级管理员可访问此页面。" />;
  }

  if (permission && !hasPermission(permission)) {
    return <AccessDenied message="你当前没有访问该模块的权限，请联系管理员开通。" />;
  }

  return <>{children}</>;
};

const AccessDenied = ({ message }: { message: string }) => (
  <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 bg-surface-container-lowest rounded-3xl border border-outline-variant/15 text-center animate-in fade-in zoom-in duration-300">
    <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-6">
      <ShieldAlert className="w-8 h-8 text-error" />
    </div>
    <h2 className="text-2xl font-bold text-on-surface mb-2">访问受限</h2>
    <p className="text-on-surface-variant max-w-md">{message}</p>
    <button onClick={() => window.history.back()} className="mt-8 text-primary font-bold hover:underline">
      返回上一页
    </button>
  </div>
);
