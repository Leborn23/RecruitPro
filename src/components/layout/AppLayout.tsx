import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  Settings2,
  Users,
  FileCheck2,
  CalendarDays,
  LineChart,
  Settings,
  Bell,
  MessageSquare,
  LogOut,
  ShieldCheck,
  Hourglass,
  Mail,
  ChevronDown,
  UserRound,
} from 'lucide-react';

const NAV_LINKS = [
  { icon: LayoutDashboard, label: '决策看板', path: '/', permission: 'VIEW_DASHBOARD' },
  { icon: Settings2, label: '岗位管理', path: '/positions', permission: 'MANAGE_POSITIONS' },
  { icon: FileCheck2, label: '简历筛选', path: '/screening', permission: 'SCREEN_RESUMES' },
  { icon: Users, label: '候选人库', path: '/candidates', permission: 'VIEW_CANDIDATES' },
  { icon: CalendarDays, label: '面试安排', path: '/interviews', permission: 'MANAGE_INTERVIEWS' },
  { icon: LineChart, label: '薪资数据', path: '/salary', permission: 'VIEW_SALARY' },
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
      <div className="h-screen w-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-sm font-bold text-primary animate-pulse tracking-widest uppercase">正在初始化系统...</p>
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
  const hasPendingAuth = !isSuperAdmin && visibleNavLinks.length === 0;

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
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-amber-500/10 border border-amber-500/20 mb-6">
            <Hourglass className="w-10 h-10 text-amber-400 animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-3">等待管理员授权</h2>
          <p className="text-gray-400 mb-6">
            当前账号已登录，但还没有被分配可访问模块。请联系系统管理员在后台给你开通权限后再刷新页面。
          </p>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center gap-3 text-left mb-8">
            <Mail className="w-5 h-5 text-primary flex-shrink-0" />
            <div>
              <p className="text-[11px] text-gray-500 uppercase tracking-widest">当前账号</p>
              <p className="text-white font-medium text-sm">{session.user.email}</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="flex items-center gap-2 mx-auto text-sm text-gray-500 hover:text-white transition-colors">
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-surface font-sans text-on-surface scroll-smooth selection:bg-primary-container selection:text-primary overflow-hidden">
      <aside className="w-[280px] bg-surface-container-low border-r border-outline-variant/15 flex flex-col relative z-20">
        <div className="p-6 h-[88px] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-lg leading-none">R</span>
          </div>
          <div>
            <h1 className="font-semibold text-[17px] tracking-tight text-on-surface">RecruitPro</h1>
            <p className="text-[11px] text-on-surface-variant font-medium tracking-widest uppercase">智能招聘后台</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-8 space-y-1">
          {NAV_LINKS.filter((link) => !link.permission || hasPermission(link.permission)).map(({ icon: Icon, label, path }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-md transition-all duration-200 group ${
                  isActive
                    ? 'bg-primary-container/40 text-primary font-medium shadow-[inset_4px_0_0_0_var(--color-primary)]'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`
              }
            >
              <Icon className="w-5 h-5 transition-transform group-hover:scale-110" />
              <span className="text-[15px]">{label}</span>
            </NavLink>
          ))}

        </nav>

        <div className="p-6 border-t border-outline-variant/15 bg-surface-container-low">
          <div ref={userMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((prev) => !prev)}
              className="w-full flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-container"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-surface-container ring-2 ring-primary-container flex items-center justify-center text-on-surface font-medium overflow-hidden">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="用户头像" className="w-full h-full object-cover" />
                  ) : (
                    <UserRound className="w-5 h-5 text-on-surface-variant" />
                  )}
                </div>
                <div className="text-left min-w-0">
                  <p className="font-bold text-[13px] text-on-surface truncate max-w-[148px]" title={session.user.email}>
                    {displayName}
                  </p>
                  <p className="text-[10px] font-bold text-on-surface-variant flex items-center gap-1 uppercase tracking-tighter">
                    {isSuperAdmin && <ShieldCheck className="w-3 h-3 text-primary" />}
                    {isSuperAdmin ? '超级管理员' : '普通用户'}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform ${isUserMenuOpen ? 'rotate-180 text-on-surface' : ''}`} />
            </button>

            {isUserMenuOpen && (
              <div className="absolute bottom-[calc(100%+10px)] left-0 right-0 bg-surface-container-lowest border border-outline-variant/20 rounded-xl shadow-sm overflow-hidden z-30">
                <button type="button" onClick={openProfile} className="w-full text-left px-4 py-3 text-sm text-on-surface hover:bg-surface-container-low transition-colors cursor-pointer">
                  个人资料
                </button>
                <button
                  type="button"
                  onClick={openSecurity}
                  className="w-full text-left px-4 py-3 text-sm text-on-surface hover:bg-surface-container-low transition-colors border-t border-outline-variant/10 cursor-pointer"
                >
                  安全设置
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full text-left px-4 py-3 text-sm text-error hover:bg-error/10 transition-colors border-t border-outline-variant/10 flex items-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-surface">
        <header className="h-[88px] bg-surface/80 backdrop-blur-md border-b border-outline-variant/10 flex flex-shrink-0 items-center justify-between px-8 z-10 sticky top-0">
          <div className="flex items-center gap-4">
            {isSuperAdmin && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border border-primary/20 rounded-full">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] font-bold text-primary tracking-widest uppercase">管理员在线</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button className="relative p-2 text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors">
              <MessageSquare className="w-5 h-5" />
            </button>
            <button className="relative p-2 text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors">
              <span className="absolute top-2 right-2.5 w-2 h-2 bg-error rounded-full ring-2 ring-surface" />
              <Bell className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
