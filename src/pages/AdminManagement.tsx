import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Shield, User, Check, X, AlertTriangle, RefreshCcw, Crown, Search } from 'lucide-react';

interface UserRole {
  id: string;
  username: string;
  email: string;
  role: 'owner' | 'super_admin' | 'admin' | 'user';
  permissions: string[];
  created_at?: string;
}

const ALL_PERMISSIONS = [
  { key: 'VIEW_DASHBOARD', label: '决策看板' },
  { key: 'MANAGE_POSITIONS', label: '岗位管理' },
  { key: 'SCREEN_RESUMES', label: '简历筛选' },
  { key: 'VIEW_CANDIDATES', label: '候选人库' },
  { key: 'MANAGE_INTERVIEWS', label: '面试安排' },
  { key: 'VIEW_SALARY', label: '薪资数据' },
  { key: 'MANAGE_SETTINGS', label: '系统设置' },
] as const;

const PRESETS = [
  { name: '基础招聘专员', perms: ['VIEW_DASHBOARD', 'VIEW_CANDIDATES', 'MANAGE_INTERVIEWS'], icon: '招' },
  {
    name: '全能招聘管理',
    perms: ['VIEW_DASHBOARD', 'MANAGE_POSITIONS', 'SCREEN_RESUMES', 'VIEW_CANDIDATES', 'MANAGE_INTERVIEWS'],
    icon: '全',
  },
  { name: '薪资分析专员', perms: ['VIEW_DASHBOARD', 'VIEW_SALARY'], icon: '薪' },
];

const ROLE_LABEL: Record<UserRole['role'], string> = {
  owner: '系统所有者',
  super_admin: '超级管理员',
  admin: '管理员',
  user: '普通用户',
};

const ROLE_ORDER: Record<UserRole['role'], number> = {
  owner: 4,
  super_admin: 3,
  admin: 2,
  user: 1,
};

export default function AdminManagement() {
  const { isSuperAdmin, user: currentUser, profile } = useAuth();
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [hasAnySuperAdmin, setHasAnySuperAdmin] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const currentOperatorRole = profile?.role ?? 'user';
  const isOwner = currentOperatorRole === 'owner';

  const toFriendlyError = (raw: string) => {
    if (raw.includes('Could not find the function public.admin_list_user_roles')) {
      return '数据库缺少用户列表 RPC（admin_list_user_roles）。请先执行迁移：supabase db push。';
    }
    if (raw.includes('Could not find the function public.admin_update_user_permissions')) {
      return '数据库缺少权限更新 RPC（admin_update_user_permissions）。请先执行迁移：supabase db push。';
    }
    if (raw.includes('Could not find the function public.admin_update_user_role')) {
      return '数据库缺少角色更新 RPC（admin_update_user_role）。请先执行迁移：supabase db push。';
    }
    if (raw.includes('Could not find the function public.claim_initial_super_admin')) {
      return '数据库缺少初始接管 RPC（claim_initial_super_admin）。请先执行迁移：supabase db push。';
    }
    return raw;
  };

  const deriveUsernameFromEmail = (email?: string | null) => {
    const value = (email ?? '').trim();
    if (!value) return '未命名用户';
    return value.split('@')[0] || '未命名用户';
  };

  const deriveUsernameFromCurrentUser = () => {
    const metadata = (currentUser?.user_metadata ?? {}) as Record<string, unknown>;
    const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
    const fullName = typeof metadata.full_name === 'string' ? metadata.full_name.trim() : '';
    return name || fullName || deriveUsernameFromEmail(currentUser?.email);
  };

  const normalizeUsers = (rows: any[]): UserRole[] =>
    rows.map((row) => ({
      id: row.id,
      username:
        (typeof row.username === 'string' && row.username.trim()) ||
        deriveUsernameFromEmail(row.email),
      email: row.email ?? '',
      role: (row.role ?? 'user') as UserRole['role'],
      permissions: Array.isArray(row.permissions) ? row.permissions : [],
      created_at: row.created_at,
    }));

  const fetchUsers = async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    setFetchError(null);

    const { data, error } = await supabase.rpc('admin_list_user_roles');
    if (error) {
      console.error('Error fetching users:', error);
      setFetchError(toFriendlyError(error.message));

      const { data: fallbackRows, error: fallbackError } = await supabase
        .from('user_roles')
        .select('id, email, role, permissions, created_at')
        .order('created_at', { ascending: true });

      if (!fallbackError && fallbackRows && fallbackRows.length > 0) {
        setUsers(normalizeUsers(fallbackRows));
      } else if (currentUser?.id && currentUser.email && profile) {
        setUsers([
          {
            id: currentUser.id,
            username: deriveUsernameFromCurrentUser(),
            email: currentUser.email,
            role: profile.role,
            permissions: profile.permissions,
          },
        ]);
      }
    } else {
      const rows = normalizeUsers(data ?? []);
      if (rows.length === 0 && currentUser?.id && currentUser.email && profile) {
        setUsers([
          {
            id: currentUser.id,
            username: deriveUsernameFromCurrentUser(),
            email: currentUser.email,
            role: profile.role,
            permissions: profile.permissions,
          },
        ]);
      } else {
        setUsers(rows);
      }
    }
    setLoading(false);
  };

  const fetchSuperAdminStatus = async () => {
    const { data, error } = await supabase.rpc('has_super_admin');
    if (error) {
      console.error('Error checking super admin status:', error);
      return;
    }
    setHasAnySuperAdmin(Boolean(data));
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetchUsers();
      return;
    }
    fetchSuperAdminStatus().finally(() => setLoading(false));
  }, [isSuperAdmin]);

  const displayedUsers = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();

    const filtered = !keyword
      ? users
      : users.filter((u) => {
          const roleLabel = ROLE_LABEL[u.role];
          return (
            u.username.toLowerCase().includes(keyword) ||
            u.email.toLowerCase().includes(keyword) ||
            u.id.toLowerCase().includes(keyword) ||
            roleLabel.includes(keyword)
          );
        });

    return [...filtered].sort((a, b) => {
      const roleDiff = ROLE_ORDER[b.role] - ROLE_ORDER[a.role];
      if (roleDiff !== 0) return roleDiff;

      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (ta !== tb) return ta - tb;

      return a.email.localeCompare(b.email);
    });
  }, [users, searchTerm]);

  const togglePermission = async (user: UserRole, permission: string) => {
    if (!isSuperAdmin || user.role !== 'admin') return;
    setUpdating(`${user.id}-${permission}`);

    const newPermissions = user.permissions.includes(permission)
      ? user.permissions.filter((p) => p !== permission)
      : [...user.permissions, permission];

    const { error } = await supabase.rpc('admin_update_user_permissions', {
      target_user_id: user.id,
      new_permissions: newPermissions,
    });

    if (!error) {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, permissions: newPermissions } : u)));
    } else {
      alert(`操作失败：${toFriendlyError(error.message)}`);
    }
    setUpdating(null);
  };

  const applyPreset = async (user: UserRole, perms: string[]) => {
    if (!isSuperAdmin || user.role !== 'admin') return;
    setUpdating(`preset-${user.id}`);

    const { error } = await supabase.rpc('admin_update_user_permissions', {
      target_user_id: user.id,
      new_permissions: perms,
    });

    if (!error) {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, permissions: perms } : u)));
    } else {
      alert(`操作失败：${toFriendlyError(error.message)}`);
    }
    setUpdating(null);
  };

  const changeUserRole = async (
    userId: string,
    newRole: UserRole['role'],
    confirmMessage: string
  ) => {
    if (!confirm(confirmMessage)) return;

    setUpdating(`role-${userId}`);
    const { error } = await supabase.rpc('admin_update_user_role', {
      target_user_id: userId,
      new_role: newRole,
    });

    if (!error) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    } else {
      alert(`操作失败：${toFriendlyError(error.message)}`);
    }
    setUpdating(null);
  };

  const handleInitialPromote = async () => {
    if (!currentUser) return;
    const { data, error } = await supabase.rpc('claim_initial_super_admin');

    if (!error) {
      if (data) {
        window.location.reload();
      } else {
        setHasAnySuperAdmin(true);
        alert('系统中已存在高权限账号，接管失败。');
      }
    } else {
      alert(`操作失败：${toFriendlyError(error.message)}`);
    }
  };

  if (!isSuperAdmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 bg-surface-container-lowest rounded-3xl border border-outline-variant/15 text-center">
        <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8 text-error" />
        </div>
        <h2 className="text-2xl font-bold text-on-surface mb-2">权限受限</h2>
        <p className="text-on-surface-variant max-w-md">
          此页面仅对系统所有者/超级管理员开放。若当前环境尚无高权限账号，可在下方执行初始接管。
        </p>

        {!hasAnySuperAdmin && !loading && (
          <button
            onClick={handleInitialPromote}
            className="mt-8 bg-primary text-white px-6 py-3 rounded-xl font-bold hover:bg-primary/90 transition-all shadow-lg flex items-center gap-2"
          >
            <Shield className="w-5 h-5" /> 立即接管超级管理员
          </button>
        )}
      </div>
    );
  }

  const hasOwner = users.some((u) => u.role === 'owner');

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.35fr_0.85fr] lg:px-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-[#426a9a]">
              <Shield className="h-3.5 w-3.5" />
              权限治理
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[#16355f]">管理员权限中心</h2>
              <p className="mt-1 text-sm text-[#5d7896]">管理角色层级、权限分配与高权限账号操作，避免权限漂移和职责重叠。</p>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#d6e2f1] bg-[#f7fbff] p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b86a4]" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索用户名 / 邮箱 / 编号 / 角色"
                  className="w-full bg-white border border-[#c7daf6] rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:border-primary transition-colors"
                />
              </div>
              <button
                onClick={fetchUsers}
                className="p-2.5 rounded-xl border border-[#c7daf6] bg-white hover:bg-[#eef5ff] transition-colors text-[#355b87]"
                title="刷新"
              >
                <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </section>
      <div className="hidden">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-2xl font-medium text-on-surface">管理员权限中心</h2>
            <span className="bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border border-primary/20">
              高权限管理区
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索用户名 / 邮箱 / 编号 / 角色"
              className="w-full bg-surface-container-lowest border border-outline-variant/25 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-primary transition-colors"
            />
          </div>
          <button
            onClick={fetchUsers}
            className="p-2.5 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
            title="刷新"
          >
            <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="bg-error/8 border border-error/20 rounded-xl px-4 py-3 text-sm text-error">
          用户列表拉取失败：{fetchError}
        </div>
      )}

      <div className="bg-white border border-[#cddcf0] rounded-[28px] overflow-hidden shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#f7fbff] border-b border-[#e4edf8]">
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#6b86a4]">用户</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#6b86a4]">角色</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#6b86a4]">权限</th>
              <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#6b86a4] text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4edf8]">
            {!loading && displayedUsers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-10 text-center text-on-surface-variant text-sm">
                  没有匹配的用户，请调整搜索条件。
                </td>
              </tr>
            )}

            {displayedUsers.map((u) => {
              const isSelf = currentUser?.id === u.id;
              const canEditPermissions = u.role === 'admin';

              return (
                <tr key={u.id} className="hover:bg-[#fbfdff] transition-colors align-top">
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center border border-outline-variant/20">
                        <User className="w-5 h-5 text-on-surface-variant" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-on-surface">{u.username || deriveUsernameFromEmail(u.email)}</p>
                        <p className="text-xs text-on-surface-variant">{u.email || '无邮箱'}</p>
                        <p className="text-[10px] text-on-surface-variant font-mono">编号: {u.id.slice(0, 8)}...</p>
                      </div>
                    </div>
                  </td>

                  <td className="px-6 py-6 font-medium">
                    {u.role === 'owner' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full text-amber-700 bg-amber-50 border border-amber-200">
                        <Crown className="w-3.5 h-3.5" /> 系统所有者
                      </span>
                    ) : u.role === 'super_admin' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full text-primary bg-primary/10 border border-primary/20">
                        <Shield className="w-3.5 h-3.5" /> 超级管理员
                      </span>
                    ) : u.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full text-on-surface-variant bg-surface-container-high border border-outline-variant/20">
                        <User className="w-3.5 h-3.5" /> 管理员
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full text-on-surface-variant/80 bg-surface-container-low border border-outline-variant/20">
                        <User className="w-3.5 h-3.5" /> 普通用户
                      </span>
                    )}
                  </td>

                  <td className="px-6 py-6">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap gap-2">
                        {ALL_PERMISSIONS.map((p) => {
                          const has = u.permissions.includes(p.key);
                          const isUpdating = updating === `${u.id}-${p.key}`;

                          return (
                            <button
                              key={p.key}
                              disabled={!canEditPermissions}
                              onClick={() => togglePermission(u, p.key)}
                              className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all border ${
                                !canEditPermissions
                                  ? 'bg-surface-container-low text-on-surface-variant/45 border-outline-variant/15 cursor-default'
                                  : has
                                    ? 'bg-primary text-white border-primary shadow-sm hover:opacity-90'
                                    : 'bg-surface-container text-on-surface-variant border-outline-variant/20 hover:border-primary/50'
                              } ${isUpdating ? 'animate-pulse scale-95' : ''}`}
                            >
                              {has ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 text-on-surface-variant/30" />}
                              {p.label}
                            </button>
                          );
                        })}
                      </div>

                      {u.role === 'admin' && (
                        <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/5">
                          <span className="text-[10px] text-on-surface-variant font-medium">快捷预设</span>
                          {PRESETS.map((preset) => (
                            <button
                              key={preset.name}
                              onClick={() => applyPreset(u, preset.perms)}
                              className="text-[10px] px-2 py-0.5 bg-surface-container-high hover:bg-primary/10 hover:text-primary rounded border border-outline-variant/20 transition-all font-medium"
                            >
                              {preset.icon} {preset.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>

                  <td className="px-6 py-6 text-right">
                    <div className="flex items-center justify-end gap-2 flex-wrap max-w-[260px] ml-auto">
                      {u.role === 'user' && (
                        <button
                          onClick={() => changeUserRole(u.id, 'admin', '确定要将该普通用户提升为管理员吗？')}
                          className="cursor-pointer text-xs px-2.5 py-1 rounded-md border border-outline-variant/25 hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          升级为管理员
                        </button>
                      )}

                      {u.role === 'admin' && (
                        <>
                          <button
                            onClick={() => changeUserRole(u.id, 'user', '确定要将该管理员降级为普通用户吗？')}
                            className="cursor-pointer text-xs px-2.5 py-1 rounded-md border border-outline-variant/25 hover:border-primary/40 hover:text-primary transition-colors"
                          >
                            降为普通用户
                          </button>
                          <button
                            onClick={() => changeUserRole(u.id, 'super_admin', '确定要将该用户提升为超级管理员吗？')}
                            className="cursor-pointer text-xs px-2.5 py-1 rounded-md border border-primary/30 text-primary hover:bg-primary/8 transition-colors"
                          >
                            升级为超管
                          </button>
                        </>
                      )}

                      {u.role === 'super_admin' && (
                        <>
                          <button
                            onClick={() => changeUserRole(u.id, 'admin', '确定要将该超级管理员降级为管理员吗？')}
                            className="cursor-pointer text-xs px-2.5 py-1 rounded-md border border-outline-variant/25 hover:border-primary/40 hover:text-primary transition-colors"
                          >
                            降级为管理员
                          </button>

                          {!hasOwner && !isOwner && isSelf && (
                            <button
                              onClick={() => changeUserRole(u.id, 'owner', '当前系统无所有者，是否将自己升级为系统所有者？')}
                              className="cursor-pointer text-xs px-2.5 py-1 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors"
                            >
                              升级为所有者
                            </button>
                          )}

                          {isOwner && !isSelf && (
                            <button
                              onClick={() =>
                                changeUserRole(
                                  u.id,
                                  'owner',
                                  '确定将所有者身份转移给该用户吗？当前所有者会自动降级为超级管理员。'
                                )
                              }
                              className="cursor-pointer text-xs px-2.5 py-1 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors"
                            >
                              转移所有者
                            </button>
                          )}
                        </>
                      )}

                      {u.role === 'owner' && isSelf && (
                        <span className="text-xs text-on-surface-variant">当前所有者</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
}
