import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LockKeyhole, Save, Upload, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface ProfileFormState {
  displayName: string;
  email: string;
  phone: string;
  bio: string;
  avatarUrl: string;
}

type NoticeState = {
  type: 'success' | 'error' | 'info';
  message: string;
} | null;

const MAX_AVATAR_SIZE_MB = 2;

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const securityCardRef = useRef<HTMLDivElement | null>(null);

  const [form, setForm] = useState<ProfileFormState>({
    displayName: '',
    email: '',
    phone: '',
    bio: '',
    avatarUrl: '',
  });
  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [localAvatarPreview, setLocalAvatarPreview] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  useEffect(() => {
    if (!user) return;
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const metadataDisplayName = typeof metadata.display_name === 'string' ? metadata.display_name : '';
    const metadataPhone = typeof metadata.phone === 'string' ? metadata.phone : '';
    const metadataBio = typeof metadata.bio === 'string' ? metadata.bio : '';
    const metadataAvatar = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : '';

    setForm({
      displayName: metadataDisplayName.trim() || (user.email?.split('@')[0] ?? ''),
      email: user.email ?? '',
      phone: metadataPhone,
      bio: metadataBio,
      avatarUrl: metadataAvatar,
    });
  }, [user]);

  useEffect(() => {
    return () => {
      if (localAvatarPreview) {
        URL.revokeObjectURL(localAvatarPreview);
      }
    };
  }, [localAvatarPreview]);

  useEffect(() => {
    if (searchParams.get('tab') === 'security' && securityCardRef.current) {
      securityCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  const avatarPreview = localAvatarPreview || form.avatarUrl;
  const showSecurityFocus = searchParams.get('tab') === 'security';

  const updateField = (field: keyof Omit<ProfileFormState, 'email'>, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAvatarSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setNotice({ type: 'error', message: '仅支持图片格式头像。' });
      return;
    }

    if (file.size > MAX_AVATAR_SIZE_MB * 1024 * 1024) {
      setNotice({ type: 'error', message: `头像文件不能超过 ${MAX_AVATAR_SIZE_MB}MB。` });
      return;
    }

    if (localAvatarPreview) {
      URL.revokeObjectURL(localAvatarPreview);
    }

    const objectUrl = URL.createObjectURL(file);
    setLocalAvatarPreview(objectUrl);
    setSelectedAvatarFile(file);
    setNotice({
      type: 'info',
      message: '已选择新头像，当前为本地预览。头像上传仍需后端存储接通。',
    });
    event.target.value = '';
  };

  const clearAvatar = () => {
    if (localAvatarPreview) {
      URL.revokeObjectURL(localAvatarPreview);
    }
    setLocalAvatarPreview('');
    setSelectedAvatarFile(null);
    updateField('avatarUrl', '');
    setNotice({ type: 'info', message: '已切换为默认头像，保存后生效。' });
  };

  const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setNotice({ type: 'error', message: '当前未登录，无法保存。' });
      return;
    }

    setIsSaving(true);
    setNotice(null);

    const nextMetadata = {
      display_name: form.displayName.trim(),
      phone: form.phone.trim() || null,
      bio: form.bio.trim() || null,
      avatar_url: form.avatarUrl.trim() || null,
    };

    const { error } = await supabase.auth.updateUser({ data: nextMetadata });
    setIsSaving(false);

    if (error) {
      setNotice({ type: 'error', message: `保存失败：${error.message}` });
      return;
    }

    if (selectedAvatarFile) {
      setNotice({
        type: 'info',
        message: '基本资料已保存。已选头像仅本地预览，仍需后端上传接口后才能持久化。',
      });
      return;
    }

    setNotice({ type: 'success', message: '个人资料已保存。' });
  };

  const goToResetPassword = () => {
    navigate('/reset-password');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-medium text-on-surface">个人信息设置</h2>
          <p className="text-sm text-on-surface-variant mt-1">
            维护当前账号的基础资料与头像显示状态，布局与系统页面保持一致。
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 rounded-md hover:bg-surface-container-low transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-6">
        <section className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6 shadow-sm">
          <h3 className="text-base font-medium text-on-surface mb-6 flex items-center gap-2 border-b border-outline-variant/10 pb-4">
            <UserRound className="w-5 h-5 text-primary" /> 基础资料
          </h3>

          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="shrink-0 flex flex-col items-center gap-3">
              <div className="w-24 h-24 rounded-full border-4 border-surface-container-highest bg-surface-container-low overflow-hidden flex items-center justify-center">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="当前头像预览" className="w-full h-full object-cover" />
                ) : (
                  <UserRound className="w-10 h-10 text-on-surface-variant" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarSelect}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer px-3 py-1.5 text-xs font-medium text-on-surface-variant bg-surface-container border border-outline-variant/20 rounded-md hover:bg-surface-container-high transition-colors inline-flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  上传头像
                </button>
                <button
                  type="button"
                  onClick={clearAvatar}
                  className="cursor-pointer px-3 py-1.5 text-xs font-medium text-on-surface-variant bg-surface-container border border-outline-variant/20 rounded-md hover:bg-surface-container-high transition-colors disabled:opacity-50"
                  disabled={!avatarPreview}
                >
                  使用默认头像
                </button>
              </div>
              <p className="text-[11px] text-on-surface-variant text-center max-w-[180px]">
                头像非必填。未上传时会显示默认用户图标。
              </p>
            </div>

            <div className="flex-1 space-y-4 w-full">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-on-surface-variant font-medium uppercase tracking-wider block mb-1.5">
                    用户名 / Display Name
                  </label>
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(event) => updateField('displayName', event.target.value)}
                    className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-2 rounded-md text-sm outline-none transition-all"
                    placeholder="请输入显示名称"
                  />
                </div>

                <div>
                  <label className="text-xs text-on-surface-variant font-medium uppercase tracking-wider block mb-1.5">
                    邮箱
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    readOnly
                    className="w-full bg-surface-container border border-outline-variant/20 px-4 py-2 rounded-md text-sm text-on-surface-variant outline-none cursor-not-allowed"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-on-surface-variant font-medium uppercase tracking-wider block mb-1.5">
                  手机号（可选）
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                  className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-2 rounded-md text-sm outline-none transition-all"
                  placeholder="请输入手机号"
                />
              </div>

              <div>
                <label className="text-xs text-on-surface-variant font-medium uppercase tracking-wider block mb-1.5">
                  个人简介（可选）
                </label>
                <textarea
                  value={form.bio}
                  onChange={(event) => updateField('bio', event.target.value)}
                  rows={4}
                  className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-2 rounded-md text-sm outline-none transition-all resize-y"
                  placeholder="请填写个人简介"
                />
              </div>
            </div>
          </div>

          {notice && (
            <div
              className={`mt-5 rounded-lg border px-4 py-3 text-sm ${
                notice.type === 'success'
                  ? 'bg-primary/5 border-primary/20 text-primary'
                  : notice.type === 'error'
                    ? 'bg-error/8 border-error/25 text-error'
                    : 'bg-surface-container-low border-outline-variant/20 text-on-surface-variant'
              }`}
            >
              {notice.message}
            </div>
          )}

          <div className="mt-8 pt-6 border-t border-outline-variant/10 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="cursor-pointer px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 rounded-md hover:bg-surface-container-low transition-colors"
            >
              取消并返回
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="cursor-pointer bg-primary text-white px-5 py-2.5 rounded text-sm font-medium shadow-sm hover:bg-primary/90 disabled:opacity-60 flex gap-2 items-center"
            >
              <Save className="w-4 h-4" />
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </section>
      </form>

      <section
        ref={securityCardRef}
        className={`bg-surface-container-lowest border rounded-xl p-6 shadow-sm ${
          showSecurityFocus ? 'border-primary/40' : 'border-outline-variant/15'
        }`}
      >
        <h3 className="text-base font-medium text-on-surface mb-4 flex items-center gap-2 border-b border-outline-variant/10 pb-4">
          <LockKeyhole className="w-5 h-5 text-primary" /> 账号安全
        </h3>
        <p className="text-sm text-on-surface-variant mb-2">
          当前账号邮箱：<span className="font-medium text-on-surface">{form.email || '未获取'}</span>
        </p>
        <p className="text-xs text-on-surface-variant mb-5">
          将进入统一重置密码页设置新密码，提交成功后会按系统逻辑自动退出并返回登录页。
        </p>
        <button
          type="button"
          onClick={goToResetPassword}
          className="cursor-pointer px-4 py-2 text-sm font-medium text-on-surface-variant bg-surface-container-lowest border border-outline-variant/30 rounded-md hover:bg-surface-container-low transition-colors disabled:opacity-60"
        >
          前往重置密码
        </button>
      </section>
    </div>
  );
}
