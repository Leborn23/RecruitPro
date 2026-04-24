import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LockKeyhole, Save, Upload, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

interface ProfileFormState {
  displayName: string;
  email: string;
  phone: string;
  bio: string;
  avatarUrl: string;
}

type NoticeState =
  | {
      type: 'success' | 'error' | 'info';
      message: string;
    }
  | null;

const MAX_AVATAR_SIZE_MB = 2;
const AVATAR_BUCKET = 'profile-avatars';

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
}

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
      event.target.value = '';
      return;
    }

    if (file.size > MAX_AVATAR_SIZE_MB * 1024 * 1024) {
      setNotice({ type: 'error', message: `头像文件不能超过 ${MAX_AVATAR_SIZE_MB}MB。` });
      event.target.value = '';
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
      message: '已选择新头像。保存后会上传到云端并立即生效。',
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

    let avatarUrl = form.avatarUrl.trim() || null;

    if (selectedAvatarFile) {
      const fileExt = selectedAvatarFile.name.split('.').pop() || 'png';
      const safeName = sanitizeFileName(selectedAvatarFile.name);
      const uploadPath = `${user.id}/${Date.now()}-${safeName || `avatar.${fileExt}`}`;

      const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(uploadPath, selectedAvatarFile, {
        cacheControl: '3600',
        upsert: false,
      });

      if (uploadError) {
        setIsSaving(false);
        setNotice({ type: 'error', message: `头像上传失败：${uploadError.message}` });
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(uploadPath);

      avatarUrl = publicUrl;
    }

    const nextMetadata = {
      display_name: form.displayName.trim(),
      phone: form.phone.trim() || null,
      bio: form.bio.trim() || null,
      avatar_url: avatarUrl,
    };

    const { error } = await supabase.auth.updateUser({ data: nextMetadata });
    setIsSaving(false);

    if (error) {
      setNotice({ type: 'error', message: `保存失败：${error.message}` });
      return;
    }

    if (localAvatarPreview) {
      URL.revokeObjectURL(localAvatarPreview);
    }

    setLocalAvatarPreview('');
    setSelectedAvatarFile(null);
    setForm((prev) => ({ ...prev, avatarUrl: avatarUrl ?? '' }));
    setNotice({ type: 'success', message: '个人资料已保存。' });
  };

  const goToResetPassword = () => {
    navigate('/reset-password');
  };

  return (
    <div className="min-h-full space-y-6 bg-[#f5f9ff] pb-20 animate-in fade-in duration-500">
      <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.35fr_0.85fr] lg:px-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-[#426a9a]">
              <UserRound className="h-3.5 w-3.5" />
              个人中心
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[#16355f]">个人信息设置</h2>
              <p className="mt-1 text-sm text-[#5d7896]">维护当前账号资料、头像与安全入口，页面结构与业务工作台保持一致。</p>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#d6e2f1] bg-[#f7fbff] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.12em] text-[#6b86a4]">当前账号</p>
                <p className="mt-1 text-base font-semibold text-[#16355f]">{form.email || '未获取邮箱'}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#c7daf6] bg-white px-3 py-2 text-sm font-medium text-[#355b87] transition-colors hover:bg-[#eef5ff]"
              >
                <ArrowLeft className="h-4 w-4" />
                返回
              </button>
            </div>
          </div>
        </div>
      </section>

      <form onSubmit={handleSaveProfile} className="space-y-6">
        <section className="rounded-[28px] border border-[#cddcf0] bg-white p-6 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
          <h3 className="mb-6 flex items-center gap-2 border-b border-[#e4edf8] pb-4 text-base font-semibold text-[#16355f]">
            <UserRound className="h-5 w-5 text-primary" />
            基础资料
          </h3>

          <div className="flex flex-col items-start gap-8 md:flex-row">
            <div className="flex shrink-0 flex-col items-center gap-3">
              <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-surface-container-highest bg-surface-container-low">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="当前头像预览" className="h-full w-full object-cover" />
                ) : (
                  <UserRound className="h-10 w-10 text-on-surface-variant" />
                )}
              </div>

              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarSelect} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-outline-variant/20 bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  <Upload className="h-3.5 w-3.5" />
                  上传头像
                </button>
                <button
                  type="button"
                  onClick={clearAvatar}
                  className="rounded-md border border-outline-variant/20 bg-surface-container px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-50"
                  disabled={!avatarPreview}
                >
                  使用默认头像
                </button>
              </div>

              <p className="max-w-[180px] text-center text-[11px] text-on-surface-variant">支持 PNG、JPG、WEBP、GIF，单张头像不超过 2MB。</p>
            </div>

            <div className="w-full flex-1 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium tracking-wider text-on-surface-variant">显示名称</label>
                  <input
                    type="text"
                    value={form.displayName}
                    onChange={(event) => updateField('displayName', event.target.value)}
                    className="w-full rounded-md border border-transparent bg-surface-container-low px-4 py-2 text-sm outline-none transition-all focus:border-primary focus:bg-surface-container-lowest"
                    placeholder="请输入显示名称"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium tracking-wider text-on-surface-variant">邮箱</label>
                  <input
                    type="email"
                    value={form.email}
                    readOnly
                    className="w-full cursor-not-allowed rounded-md border border-outline-variant/20 bg-surface-container px-4 py-2 text-sm text-on-surface-variant outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium tracking-wider text-on-surface-variant">手机号</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                  className="w-full rounded-md border border-transparent bg-surface-container-low px-4 py-2 text-sm outline-none transition-all focus:border-primary focus:bg-surface-container-lowest"
                  placeholder="请输入手机号"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium tracking-wider text-on-surface-variant">个人简介</label>
                <textarea
                  value={form.bio}
                  onChange={(event) => updateField('bio', event.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-md border border-transparent bg-surface-container-low px-4 py-2 text-sm outline-none transition-all focus:border-primary focus:bg-surface-container-lowest"
                  placeholder="填写你的职责、擅长方向或团队角色"
                />
              </div>
            </div>
          </div>

          {notice ? (
            <div
              className={`mt-5 rounded-lg border px-4 py-3 text-sm ${
                notice.type === 'success'
                  ? 'border-primary/20 bg-primary/5 text-primary'
                  : notice.type === 'error'
                    ? 'border-error/25 bg-error/8 text-error'
                    : 'border-outline-variant/20 bg-surface-container-low text-on-surface-variant'
              }`}
            >
              {notice.message}
            </div>
          ) : null}

          <div className="mt-8 flex items-center justify-end gap-3 border-t border-outline-variant/10 pt-6">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="rounded-md border border-outline-variant/30 bg-surface-container-lowest px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              取消并返回
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 rounded bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {isSaving ? '保存中...' : '保存'}
            </button>
          </div>
        </section>
      </form>

      <section
        ref={securityCardRef}
        className={`rounded-[28px] border bg-white p-6 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)] ${
          showSecurityFocus ? 'border-primary/40' : 'border-[#cddcf0]'
        }`}
      >
        <h3 className="mb-4 flex items-center gap-2 border-b border-[#e4edf8] pb-4 text-base font-semibold text-[#16355f]">
          <LockKeyhole className="h-5 w-5 text-primary" />
          账户安全
        </h3>
        <p className="mb-2 text-sm text-on-surface-variant">
          当前账号邮箱：<span className="font-medium text-on-surface">{form.email || '未获取'}</span>
        </p>
        <p className="mb-5 text-xs text-on-surface-variant">将进入统一重置密码页面设置新密码，提交成功后会按系统逻辑自动退出并返回登录页。</p>
        <button
          type="button"
          onClick={goToResetPassword}
          className="rounded-md border border-outline-variant/30 bg-surface-container-lowest px-4 py-2 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low disabled:opacity-60"
        >
          前往重置密码
        </button>
      </section>
    </div>
  );
}
