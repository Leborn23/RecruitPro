import { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronDown,
  FileCheck2,
  FileText,
  Hourglass,
  LayoutDashboard,
  LogOut,
  Mail,
  Settings,
  Settings2,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import BrandMark from '../BrandMark';
import './AppLayout.css';

const NAV_LINKS = [
  { icon: LayoutDashboard, label: '决策看板', path: '/', permission: 'VIEW_DASHBOARD' },
  { icon: Settings2, label: '岗位管理', path: '/positions', permission: 'MANAGE_POSITIONS' },
  { icon: FileCheck2, label: '简历筛选', path: '/screening', permission: 'SCREEN_RESUMES' },
  { icon: Users, label: '候选人库', path: '/candidates', permission: 'VIEW_CANDIDATES' },
  { icon: CalendarDays, label: '面试安排', path: '/interviews', permission: 'MANAGE_INTERVIEWS' },
  { icon: Settings, label: '系统设置', path: '/settings', permission: 'MANAGE_SETTINGS' },
];

export function AppLayout() {
  const { session, loading, signOut, hasPermission, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isUserMenuOpen) return;

    const onWindowClick = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', onWindowClick);
    window.addEventListener('keydown', onWindowKeyDown);
    return () => {
      window.removeEventListener('mousedown', onWindowClick);
      window.removeEventListener('keydown', onWindowKeyDown);
    };
  }, [isUserMenuOpen]);

  if (loading) {
    return (
      <div className="app-layout app-layout--loading">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <p className="animate-pulse text-sm font-bold uppercase tracking-widest text-primary">正在初始化系统...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  const metadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    typeof metadata.display_name === 'string' && metadata.display_name.trim()
      ? metadata.display_name
      : session.user.email?.split('@')[0] ?? '用户';
  const avatarUrl = typeof metadata.avatar_url === 'string' && metadata.avatar_url.trim() ? metadata.avatar_url : '';

  const visibleNavLinks = NAV_LINKS.filter((link) => !link.permission || hasPermission(link.permission));
  const orderedNavLinks = hasPermission('MANAGE_INTERVIEWS')
    ? visibleNavLinks.flatMap((link) =>
        link.path === '/settings'
          ? [{ icon: FileText, label: '面试报告', path: '/interview-reports', permission: 'MANAGE_INTERVIEWS' }, link]
          : [link]
      )
    : visibleNavLinks;
  const hasPendingAuth = false;
  const openProfile = () => {
    setIsUserMenuOpen(false);
    navigate('/profile');
  };

  const openSecurity = () => {
    setIsUserMenuOpen(false);
    navigate('/profile?tab=security');
  };

  const handleSignOut = async () => {
    setIsUserMenuOpen(false);
    await signOut();
    navigate('/login');
  };

  if (hasPendingAuth) {
    return (
      <div className="app-layout app-layout--pending">
        <div className="w-full max-w-md text-center">
          <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-3xl border border-amber-500/20 bg-amber-500/10 shadow-[0_20px_60px_-28px_rgba(251,191,36,0.35)]">
            <Hourglass className="h-10 w-10 animate-pulse text-amber-400" />
          </div>
          <h2 className="mb-3 text-2xl font-bold text-white">等待管理员授权</h2>
          <p className="mb-6 text-gray-400">
            当前账号已登录，但尚未分配可访问模块。请联系系统管理员开通权限后再刷新页面。
          </p>
          <div className="mb-8 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
            <Mail className="h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-[11px] uppercase tracking-widest text-gray-500">当前账号</p>
              <p className="text-sm font-medium text-white">{session.user.email}</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="mx-auto flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-white">
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className="app-layout__sidebar">
        <div className="app-layout__brand-shell">
          <div className="app-layout__brand-card">
            <div className="flex items-center gap-3">
              <div className="app-layout__brand-mark">
                <BrandMark className="h-7 w-7 text-white" />
              </div>
              <div>
                <h1 className="app-layout__brand-title">RecruitPro</h1>
                <p className="app-layout__brand-subtitle">智能招聘后台</p>
              </div>
            </div>
          </div>
        </div>

        <nav className="app-layout__nav">
          {orderedNavLinks.map(({ icon: Icon, label, path }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              className={({ isActive }) => `app-layout__nav-link ${isActive ? 'is-active' : ''}`}
            >
              {({ isActive }) => (
                <>
                  <div className={`app-layout__nav-icon ${isActive ? 'is-active' : ''}`}>
                    <Icon className="h-5 w-5 transition-transform group-hover:scale-105" />
                  </div>
                  <span className="app-layout__nav-label">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="app-layout__user-shell">
          <div ref={userMenuRef} className="relative">
            <button type="button" onClick={() => setIsUserMenuOpen((prev) => !prev)} className="app-layout__user-button">
              <div className="flex min-w-0 items-center gap-3">
                <div className="app-layout__avatar">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="用户头像" className="h-full w-full object-cover" />
                  ) : (
                    <UserRound className="h-5 w-5 text-[#6b86a4]" />
                  )}
                </div>
                <div className="min-w-0 text-left">
                  <p className="app-layout__user-name" title={session.user.email}>
                    {displayName}
                  </p>
                  <p className="app-layout__user-role">
                    {isSuperAdmin ? '超级管理员' : '普通用户'}
                  </p>
                </div>
              </div>
              <ChevronDown className={`h-4 w-4 text-[#6b86a4] transition-transform ${isUserMenuOpen ? 'rotate-180 text-[#16355f]' : ''}`} />
            </button>

            {isUserMenuOpen ? (
              <div className="app-layout__user-menu">
                <button type="button" onClick={openProfile} className="app-layout__user-menu-item">
                  个人资料
                </button>
                <button type="button" onClick={openSecurity} className="app-layout__user-menu-item">
                  安全设置
                </button>
                <button type="button" onClick={handleSignOut} className="app-layout__user-menu-item app-layout__user-menu-item--danger">
                  <LogOut className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="app-layout__main">
        <div className="app-layout__content-shell">
          <div className="app-layout__content-frame">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
