import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { supabase } from '../lib/supabase';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const recoverSessionFromUrl = async () => {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const searchParams = new URLSearchParams(window.location.search);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const type = hashParams.get('type');
      const code = searchParams.get('code');

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) return { ok: false, message: exchangeError.message };
      } else if (type === 'recovery' && accessToken && refreshToken) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setSessionError) return { ok: false, message: setSessionError.message };
      }
      return { ok: true };
    };

    const bootstrap = async () => {
      setCheckingSession(true);
      setError(null);

      const recoveryResult = await recoverSessionFromUrl();
      if (!active) return;
      if (!recoveryResult.ok) {
        setError(recoveryResult.message ?? '重置链接无效或已过期，请重新申请。');
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError) {
        setError(sessionError.message);
        setReady(false);
      } else if (data.session) {
        setReady(true);
      } else {
        setReady(false);
        setError('重置链接无效或已过期，请返回登录页重新发送。');
      }
      setCheckingSession(false);
    };

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setReady(true);
        setError(null);
        setCheckingSession(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!password || !confirmPassword) {
      setError('请完整填写新密码和确认密码。');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`密码长度至少 ${MIN_PASSWORD_LENGTH} 位。`);
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致。');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      setLoading(false);
      return;
    }

    setSuccess('密码已更新，请使用新密码登录。');
    setLoading(false);
    setTimeout(() => navigate('/login', { replace: true }), 1200);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f4f8fd] p-4 text-[#16355f]">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#eef5ff_0%,#f8fbff_48%,#edf4fc_100%)]" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-[24px] bg-[linear-gradient(145deg,#16355f,#2d67b8)] shadow-xl shadow-[#1f5fbf]/20">
            <BrandMark className="h-9 w-9 text-white" />
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-[#16355f]">RecruitPro</h1>
          <p className="mt-2 text-sm font-medium text-[#5d7896]">设置新密码</p>
        </div>

        <div className="rounded-[32px] border border-[#dbe7f5] bg-white p-7 shadow-[0_24px_54px_-42px_rgba(21,53,102,0.24)]">
          <div className="mb-6 text-center">
            <h2 className="text-xl font-semibold text-[#16355f]">重置密码</h2>
            <p className="mt-2 text-sm text-[#5d7896]">请输入新密码并确认。</p>
          </div>

          {checkingSession ? (
            <div className="py-8 text-center text-sm text-[#5d7896]">正在校验重置授权...</div>
          ) : !ready ? (
            <div className="space-y-4">
              {error && <Alert tone="error">{error}</Alert>}
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full rounded-xl border border-[#c7daf6] py-3 font-semibold text-[#1f5fbf] transition-colors hover:bg-[#f4f8ff]"
              >
                返回登录页
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <PasswordField
                label={`新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`}
                value={password}
                visible={showPassword}
                onToggle={() => setShowPassword((value) => !value)}
                onChange={setPassword}
                placeholder="请输入新密码"
              />
              <PasswordField
                label="确认新密码"
                value={confirmPassword}
                visible={showConfirm}
                onToggle={() => setShowConfirm((value) => !value)}
                onChange={setConfirmPassword}
                placeholder="请再次输入新密码"
                invalid={Boolean(confirmPassword && confirmPassword !== password)}
              />

              {confirmPassword && confirmPassword === password && (
                <p className="ml-1 flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 两次密码一致
                </p>
              )}
              {error && <Alert tone="error">{error}</Alert>}
              {success && <Alert tone="success">{success}</Alert>}

              <button
                type="submit"
                disabled={loading || Boolean(success)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1f5fbf] py-3.5 font-semibold text-white shadow-lg shadow-[#1f5fbf]/25 transition-all hover:bg-[#164d9c] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
              >
                {loading ? '提交中...' : '更新密码'}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  visible,
  onToggle,
  onChange,
  placeholder,
  invalid = false,
}: {
  label: string;
  value: string;
  visible: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  invalid?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="ml-1 text-xs font-semibold uppercase tracking-wider text-[#6b86a4]">{label}</label>
      <div className="relative group">
        <Lock
          className={`absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors ${
            invalid ? 'text-rose-400' : 'text-[#9eb0c4] group-focus-within:text-[#1f5fbf]'
          }`}
        />
        <input
          type={visible ? 'text' : 'password'}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-xl border bg-white px-11 py-3.5 font-medium text-[#16355f] outline-none transition-all placeholder:text-[#b7c7d9] focus:ring-4 ${
            invalid
              ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10'
              : 'border-[#dbe7f5] focus:border-[#1f5fbf] focus:ring-[#1f5fbf]/10'
          }`}
        />
        <button
          type="button"
          onClick={onToggle}
          className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors ${
            invalid ? 'text-rose-400' : 'text-[#9eb0c4] hover:text-[#5d7896]'
          }`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Alert({ children, tone }: { children: React.ReactNode; tone: 'error' | 'success' }) {
  const styles =
    tone === 'error'
      ? 'border-rose-100 bg-rose-50 text-rose-600'
      : 'border-emerald-100 bg-emerald-50 text-emerald-700';
  const dot = tone === 'error' ? 'bg-rose-500' : 'bg-emerald-500';
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <div className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="leading-tight">{children}</span>
    </div>
  );
}
