import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

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
      <div className="flex h-full w-full items-center justify-center p-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary/30" />
      </div>
    );
  }

  if (!session) {
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(location.search);
    const isRecoveryByHash =
      hashParams.get('type') === 'recovery' &&
      Boolean(hashParams.get('access_token')) &&
      Boolean(hashParams.get('refresh_token'));
    const isRecoveryByQuery = searchParams.get('type') === 'recovery';
    const callbackSuffix = `${location.search}${location.hash}`;

    if (isRecoveryByHash || isRecoveryByQuery) {
      return <Navigate to={`/reset-password${callbackSuffix}`} replace />;
    }
    return <Navigate to={`/login${callbackSuffix}`} replace />;
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <AccessDenied message="仅系统所有者或超级管理员可以访问此页面。" />;
  }

  if (permission && !hasPermission(permission)) {
    return <AccessDenied message="当前账号暂未开通此模块权限。" />;
  }

  return <>{children}</>;
};

const AccessDenied = ({ message }: { message: string }) => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-3xl border border-outline-variant/15 bg-surface-container-lowest p-8 text-center animate-in fade-in zoom-in duration-300">
    <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-error/10">
      <ShieldAlert className="h-8 w-8 text-error" />
    </div>
    <h2 className="mb-2 text-2xl font-bold text-on-surface">访问受限</h2>
    <p className="max-w-md text-on-surface-variant">{message}</p>
    <button onClick={() => window.history.back()} className="mt-8 font-bold text-primary hover:underline">
      返回上一页
    </button>
  </div>
);
