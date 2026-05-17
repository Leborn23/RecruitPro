import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  LogIn,
  UserPlus,
  Mail,
  Lock,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import BrandMark from '../components/BrandMark';

type Step = 'form' | 'verify' | 'done' | 'forgot';

const MIN_PASSWORD_LENGTH = 8;
const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

const getFastApiBaseUrl = () => {
  return (import.meta.env.VITE_FASTAPI_BASE_URL as string | undefined)?.trim().replace(/\/$/, '') || '/api-fast';
};

const postAuthEmail = async (path: string, body: Record<string, unknown>) => {
  const response = await fetch(`${getFastApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return response.json().catch(() => ({}));
  }

  let message = '邮件发送失败，请稍后再试。';
  try {
    const payload = await response.json();
    if (typeof payload?.detail === 'string' && payload.detail.trim()) {
      message = payload.detail.trim();
    }
  } catch {
    const text = await response.text().catch(() => '');
    if (text.trim()) message = text.trim();
  }
  throw new Error(message);
};

const translateAuthMessage = (message: string) => {
  const lower = message.toLowerCase();
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return '该邮箱已注册，请直接登录。';
  }
  if (lower.includes('invalid login credentials')) {
    return '邮箱或密码不正确。';
  }
  if (lower.includes('email not confirmed')) {
    return '邮箱尚未验证，请先完成邮箱验证。';
  }
  if (lower.includes('failed to fetch')) {
    return '邮件服务暂时无法连接，请稍后重试。';
  }
  return message;
};

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [otp, setOtp] = useState('');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryCodeSent, setRecoveryCodeSent] = useState(false);
  const [recoveryResendSeconds, setRecoveryResendSeconds] = useState(0);
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(location.search);
    const isRecoveryByHash =
      hashParams.get('type') === 'recovery' &&
      !!hashParams.get('access_token') &&
      !!hashParams.get('refresh_token');
    const isRecoveryByQuery = searchParams.get('type') === 'recovery';

    if (isRecoveryByHash || isRecoveryByQuery) {
      navigate(`/reset-password${location.search}${location.hash}`, { replace: true });
    }
  }, [location.hash, location.search, navigate]);

  useEffect(() => {
    if (recoveryResendSeconds <= 0) return;
    const timer = window.setTimeout(() => setRecoveryResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [recoveryResendSeconds]);

  const clearBanner = () => {
    setError(null);
    setInfo(null);
  };

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setStep('form');
    clearBanner();
    setPassword('');
    setConfirmPassword('');
    setOtp('');
    setRecoveryOtp('');
    setRecoveryCodeSent(false);
    setRecoveryResendSeconds(0);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    clearBanner();
    setLoading(true);

    if (isLogin) {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        if (authError.message.toLowerCase().includes('invalid login credentials')) {
          setError('邮箱或密码不正确。');
        } else if (authError.message.toLowerCase().includes('email not confirmed')) {
          setError('邮箱尚未验证，请先完成邮箱验证。');
        } else {
          setError(translateAuthMessage(authError.message));
        }
        setLoading(false);
        return;
      }
      navigate('/');
      return;
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致。');
      setLoading(false);
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`密码长度至少 ${MIN_PASSWORD_LENGTH} 位。`);
      setLoading(false);
      return;
    }

    try {
      await postAuthEmail('/api/auth/signup-email', {
        email: email.trim().toLowerCase(),
        password,
        redirectTo: window.location.origin,
      });
      setStep('verify');
      setInfo('验证码已发送，请到邮箱查收。');
    } catch (sendError) {
      setError(sendError instanceof Error ? translateAuthMessage(sendError.message) : '验证码发送失败，请稍后再试。');
    }
    setLoading(false);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearBanner();

    if (otp.length !== OTP_LENGTH) {
      setError('请输入 6 位验证码。');
      return;
    }

    setLoading(true);
    try {
      const payload = await postAuthEmail('/api/auth/signup-verify', {
        email: email.trim().toLowerCase(),
        code: otp,
      });
      if (payload && typeof payload.emailOtp === 'string' && payload.emailOtp) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: payload.emailOtp,
          type: 'signup',
        });
        if (verifyError) {
          setError(translateAuthMessage(verifyError.message));
          return;
        }
        setStep('done');
        setTimeout(() => navigate('/'), 900);
        return;
      }
      if (payload && typeof payload.actionLink === 'string' && payload.actionLink) {
        window.location.href = payload.actionLink;
        return;
      }
      setError('账号确认链接生成失败，请重新发送验证码。');
    } catch (verifyError) {
      setError(verifyError instanceof Error ? translateAuthMessage(verifyError.message) : '验证码无效或已过期，请重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    clearBanner();
    setLoading(true);
    try {
      await postAuthEmail('/api/auth/signup-email', {
        email: email.trim().toLowerCase(),
        password,
        redirectTo: window.location.origin,
      });
      setInfo('验证码已重新发送，请检查邮箱。');
    } catch (resendError) {
      setError(resendError instanceof Error ? translateAuthMessage(resendError.message) : '验证码发送失败，请稍后再试。');
    }
    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearBanner();

    if (!email.trim()) {
      setError('请输入邮箱地址。');
      return;
    }

    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await postAuthEmail('/api/auth/recovery-email', {
        email: normalizedEmail,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setRecoveryCodeSent(true);
      setRecoveryOtp('');
      setRecoveryResendSeconds(RESEND_COOLDOWN_SECONDS);
      setInfo('安全验证码已发送，请查看邮箱并输入验证码。');
    } catch (resetError) {
      setError(resetError instanceof Error ? translateAuthMessage(resetError.message) : '安全验证码发送失败，请稍后再试。');
    }
    setLoading(false);
  };

  const handleVerifyRecoveryOtp = async () => {
    clearBanner();

    if (!email.trim()) {
      setError('请先输入邮箱地址。');
      return;
    }

    if (recoveryOtp.length !== OTP_LENGTH) {
      setError('请输入 6 位验证码。');
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);

    try {
      const payload = await postAuthEmail('/api/auth/recovery-verify', {
        email: normalizedEmail,
        code: recoveryOtp,
      });
      if (payload && typeof payload.emailOtp === 'string' && payload.emailOtp) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email: normalizedEmail,
          token: payload.emailOtp,
          type: 'recovery',
        });
        if (verifyError) {
          setError(translateAuthMessage(verifyError.message));
          return;
        }
        navigate('/reset-password');
        return;
      }
      if (payload && typeof payload.actionLink === 'string' && payload.actionLink) {
        window.location.href = payload.actionLink;
        return;
      }
      setError('重置链接生成失败，请重新发送验证码。');
    } catch (verifyError) {
      setError(verifyError instanceof Error ? translateAuthMessage(verifyError.message) : '验证码校验失败，请重试。');
    } finally {
      setLoading(false);
    }
  };

  const goToForgot = () => {
    setStep('forgot');
    clearBanner();
    setPassword('');
    setConfirmPassword('');
    setRecoveryOtp('');
    setRecoveryCodeSent(false);
    setRecoveryResendSeconds(0);
  };

  const backToLogin = () => {
    setIsLogin(true);
    setStep('form');
    clearBanner();
    setPassword('');
    setConfirmPassword('');
    setOtp('');
    setRecoveryOtp('');
    setRecoveryCodeSent(false);
    setRecoveryResendSeconds(0);
  };

  const pageAccent = isLogin ? '工作台登录' : '创建工作账号';
  const pageTitle = isLogin ? '登录 RecruitPro' : '注册 RecruitPro';
  const pageDescription = isLogin
    ? '使用工作邮箱登录，继续查看岗位进展、候选人状态和面试安排。'
    : '创建账号后即可进入招聘后台，开始管理岗位、筛选流程和面试协作。';

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f4f8fd] text-[#16355f]">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#eef5ff_0%,#f8fbff_45%,#edf4fc_100%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[0.72fr_0.82fr] lg:gap-12">
          <section className="hidden lg:flex flex-col justify-center rounded-[32px] border border-[#d8e4f4] bg-white/72 p-10 shadow-[0_24px_54px_-46px_rgba(21,53,102,0.18)] backdrop-blur-sm">
            <div className="max-w-[28rem] space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#426a9a]">
                <Sparkles className="h-3.5 w-3.5" />
                {pageAccent}
              </div>

              <div className="space-y-5">
                <div className="inline-flex items-center justify-center rounded-[24px] bg-[linear-gradient(145deg,#16355f,#2d67b8)] p-4 shadow-[0_24px_52px_-28px_rgba(23,63,117,0.46)]">
                  <BrandMark className="h-10 w-10 text-white" />
                </div>
                <div className="space-y-4">
                  <div className="space-y-3">
                    <h1 className="text-4xl font-semibold tracking-[-0.06em] text-[#16355f]">RecruitPro</h1>
                    <p className="text-lg font-semibold text-[#2b5f9f]">智能招聘管理系统</p>
                    <p className="max-w-md text-[15px] leading-7 text-[#5d7896]">
                      管理岗位、候选人、筛选和面试流程。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="mx-auto w-full max-w-xl lg:max-w-[34rem]">
            <div className="mb-5 flex items-center justify-center lg:hidden">
              <div className="inline-flex items-center gap-3 rounded-[22px] border border-[#cddcf0] bg-white/85 px-4 py-3 shadow-[0_20px_40px_-32px_rgba(21,53,102,0.18)] backdrop-blur-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#16355f,#2d67b8)]">
                  <BrandMark className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6b86a4]">RecruitPro</p>
                  <p className="text-sm font-medium text-[#16355f]">智能招聘后台</p>
                </div>
              </div>
            </div>

            <div className="rounded-[32px] border border-[#cddcf0] bg-white/94 p-6 shadow-[0_24px_54px_-42px_rgba(21,53,102,0.24)] backdrop-blur-sm sm:p-8">
              <div className="mb-7 space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#426a9a]">
                  <Sparkles className="h-3.5 w-3.5" />
                  {pageAccent}
                </div>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-[-0.06em] text-[#16355f] sm:text-[2.3rem]">{pageTitle}</h1>
                  <p className="max-w-xl text-sm leading-6 text-[#5d7896] sm:text-[15px]">{pageDescription}</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-[#dbe7f5] bg-white p-6 shadow-[0_16px_36px_-30px_rgba(21,53,102,0.18)]">
          {step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-8 animate-in fade-in zoom-in">
              <CheckCircle2 className="w-16 h-16 text-emerald-500" />
              <p className="text-[#16355f] font-semibold text-xl">验证成功</p>
              <p className="text-[#5d7896] text-sm">正在为你跳转到系统首页...</p>
            </div>
          )}

          {step === 'verify' && (
            <div className="animate-in slide-in-from-right-4 fade-in duration-300">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#f4f8ff] mb-4 ring-4 ring-[#eef5ff]">
                  <KeyRound className="w-6 h-6 text-[#1f5fbf]" />
                </div>
                <h2 className="text-[#16355f] font-semibold text-xl">邮箱验证码</h2>
                <p className="text-[#5d7896] text-sm mt-2">
                  我们已发送 6 位验证码到 <span className="text-[#1f5fbf] font-semibold">{email}</span>
                </p>
                <p className="text-[#7c93ad] text-xs mt-1">请输入验证码完成注册。</p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <div className="space-y-2 text-center">
                  <label className="text-xs font-semibold uppercase tracking-widest text-[#6b86a4]">验证码</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={OTP_LENGTH}
                    required
                    autoFocus
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full bg-[#f8fbff] border border-[#dbe7f5] focus:border-[#1f5fbf] focus:ring-4 focus:ring-[#1f5fbf]/10 px-5 py-4 rounded-xl text-[#16355f] outline-none transition-all placeholder:text-[#b7c7d9] text-center text-3xl font-semibold tracking-[0.5em] shadow-inner"
                  />
                </div>

                {error && (
                  <div className="bg-rose-50 border border-rose-100 text-rose-600 text-sm py-3 px-4 rounded-xl flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                    {error}
                  </div>
                )}
                {info && (
                  <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm py-3 px-4 rounded-xl flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                    {info}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || otp.length !== OTP_LENGTH}
                  className="w-full bg-[#1f5fbf] text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-[#1f5fbf]/25 hover:bg-[#164d9c] active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:pointer-events-none"
                >
                  {loading ? '验证中...' : '确认并进入系统'}
                  {!loading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                </button>

                <div className="text-center pt-2 border-t border-[#e4edf8]">
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={loading}
                    className="text-sm text-[#5d7896] hover:text-[#1f5fbf] font-medium transition-colors disabled:opacity-60"
                  >
                    重新发送验证码
                  </button>
                </div>
              </form>
            </div>
          )}

          {step === 'forgot' && (
            <div className="animate-in slide-in-from-right-4 fade-in duration-300">
              <div className="mb-5 flex items-start gap-4">
                <div className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f4f8ff] ring-4 ring-[#eef5ff]">
                  <KeyRound className="h-5 w-5 text-[#1f5fbf]" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-[#16355f] font-semibold text-xl">找回密码</h2>
                  <p className="text-[#5d7896] text-sm leading-6">输入注册邮箱，系统会发送安全验证码。</p>
                </div>
              </div>

              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="rounded-2xl border border-[#dbe7f5] bg-[#f8fbff] p-3">
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#6b86a4]">邮箱</label>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <div className="relative group flex-1">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9eb0c4] group-focus-within:text-[#1f5fbf] transition-colors" />
                      <input
                        type="email"
                        required
                        autoFocus
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@company.com"
                        className="w-full bg-white border border-[#dbe7f5] focus:border-[#1f5fbf] focus:ring-4 focus:ring-[#1f5fbf]/10 px-11 py-3.5 rounded-xl text-[#16355f] outline-none transition-all placeholder:text-[#b7c7d9] font-medium"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading || recoveryResendSeconds > 0}
                      className="shrink-0 rounded-xl bg-[#1f5fbf] px-5 py-3.5 font-semibold text-white shadow-lg shadow-[#1f5fbf]/20 transition-all hover:bg-[#164d9c] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
                    >
                      {loading
                        ? '发送中...'
                        : recoveryResendSeconds > 0
                          ? `${recoveryResendSeconds}s 后重发`
                          : recoveryCodeSent
                            ? '重新发送'
                            : '发送验证码'}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-rose-50 border border-rose-100 text-rose-600 text-sm py-3 px-4 rounded-xl flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 flex-shrink-0"></div>
                    <span className="leading-tight">{error}</span>
                  </div>
                )}
                {info && (
                  <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm py-3 px-4 rounded-xl flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0"></div>
                    <span className="leading-tight">{info}</span>
                  </div>
                )}

                {recoveryCodeSent && (
                  <div className="space-y-3 rounded-2xl border border-[#dbe7f5] bg-white p-4 shadow-[0_14px_32px_-30px_rgba(21,53,102,0.22)]">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs font-semibold uppercase tracking-wider text-[#6b86a4]">安全验证码</label>
                      <span className="rounded-full bg-[#f4f8ff] px-3 py-1 text-xs font-medium text-[#5d7896]">6 位数字</span>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={OTP_LENGTH}
                      value={recoveryOtp}
                      onChange={(e) => setRecoveryOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full bg-[#f8fbff] border border-[#dbe7f5] focus:border-[#1f5fbf] focus:ring-4 focus:ring-[#1f5fbf]/10 px-4 py-3.5 rounded-xl text-[#16355f] outline-none transition-all placeholder:text-[#b7c7d9] font-semibold text-center text-2xl tracking-[0.32em]"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyRecoveryOtp}
                      disabled={loading || recoveryOtp.length !== OTP_LENGTH}
                      className="w-full rounded-xl border border-[#c7daf6] bg-white py-3 font-semibold text-[#1f5fbf] transition-colors hover:bg-[#f4f8ff] disabled:pointer-events-none disabled:opacity-60"
                    >
                      {loading ? '验证中...' : '验证验证码并重置密码'}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={backToLogin}
                  className="w-full border border-[#dbe7f5] text-[#355b87] font-semibold py-3 rounded-xl hover:bg-[#f8fbff] transition-colors"
                >
                  返回登录
                </button>
              </form>
            </div>
          )}

          {step === 'form' && (
            <div className="animate-in slide-in-from-left-4 fade-in duration-300">
              <div className="flex bg-[#eff5fc] p-1.5 rounded-xl mb-8 shadow-inner">
                <button
                  onClick={() => switchMode(true)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    isLogin ? 'bg-white text-[#1f5fbf] shadow border border-[#dbe7f5]' : 'text-[#6b86a4] hover:text-[#355b87]'
                  }`}
                >
                  <LogIn className="w-4 h-4" /> 登录
                </button>
                <button
                  onClick={() => switchMode(false)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    !isLogin ? 'bg-white text-[#1f5fbf] shadow border border-[#dbe7f5]' : 'text-[#6b86a4] hover:text-[#355b87]'
                  }`}
                >
                  <UserPlus className="w-4 h-4" /> 注册
                </button>
              </div>

              <form onSubmit={handleAuth} className="space-y-5 flex flex-col">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#6b86a4] ml-1">邮箱</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9eb0c4] group-focus-within:text-[#1f5fbf] transition-colors" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full bg-white border border-[#dbe7f5] focus:border-[#1f5fbf] focus:ring-4 focus:ring-[#1f5fbf]/10 px-11 py-3.5 rounded-xl text-[#16355f] outline-none transition-all placeholder:text-[#b7c7d9] font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#6b86a4]">
                      {isLogin ? '密码' : '设置密码'}{' '}
                      {!isLogin && (
                        <span className="text-[#9eb0c4] font-normal normal-case tracking-normal pl-1">
                          (至少 {MIN_PASSWORD_LENGTH} 位)
                        </span>
                      )}
                    </label>
                    {isLogin && (
                      <button type="button" onClick={goToForgot} className="text-xs text-[#1f5fbf] font-medium hover:underline">
                        忘记密码？
                      </button>
                    )}
                  </div>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9eb0c4] group-focus-within:text-[#1f5fbf] transition-colors" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="请输入密码"
                      className="w-full bg-white border border-[#dbe7f5] focus:border-[#1f5fbf] focus:ring-4 focus:ring-[#1f5fbf]/10 px-11 py-3.5 rounded-xl text-[#16355f] outline-none transition-all placeholder:text-[#b7c7d9] font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9eb0c4] hover:text-[#355b87] transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {!isLogin && (
                  <div className="space-y-1.5 animate-in slide-in-from-top-2 fade-in">
                    <label className="text-xs font-semibold uppercase tracking-wider text-[#6b86a4] ml-1">确认密码</label>
                    <div className="relative group">
                      <Lock
                        className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${
                          confirmPassword && confirmPassword !== password
                            ? 'text-rose-400'
                            : 'text-[#9eb0c4] group-focus-within:text-[#1f5fbf]'
                        }`}
                      />
                      <input
                        type={showConfirm ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="请再次输入密码"
                        className={`w-full bg-white border focus:ring-4 px-11 py-3.5 rounded-xl text-[#16355f] outline-none transition-all placeholder:text-[#b7c7d9] font-medium ${
                          confirmPassword && confirmPassword !== password
                            ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500/10'
                            : 'border-[#dbe7f5] focus:border-[#1f5fbf] focus:ring-[#1f5fbf]/10'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((v) => !v)}
                        className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors ${
                          confirmPassword && confirmPassword !== password
                            ? 'text-rose-400'
                            : 'text-[#9eb0c4] hover:text-[#355b87]'
                        }`}
                      >
                        {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    {confirmPassword && confirmPassword !== password && (
                      <p className="text-rose-500 text-xs font-medium ml-1 flex items-center gap-1 mt-1 animate-in fade-in">
                        两次密码不一致
                      </p>
                    )}
                    {confirmPassword && confirmPassword === password && (
                      <p className="text-emerald-600 text-xs font-medium ml-1 flex items-center gap-1 mt-1 animate-in fade-in">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 密码一致
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <div className="bg-rose-50 border border-rose-100 text-rose-600 text-sm py-3 px-4 rounded-xl flex items-start gap-2 mt-4 animate-in fade-in">
                    <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 flex-shrink-0"></div>
                    <span className="leading-tight">{error}</span>
                  </div>
                )}
                {info && (
                  <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm py-3 px-4 rounded-xl flex items-start gap-2 mt-4 animate-in fade-in">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0"></div>
                    <span className="leading-tight">{info}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || (!isLogin && confirmPassword !== password)}
                  className="w-full bg-[#1f5fbf] text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-[#1f5fbf]/25 hover:bg-[#164d9c] active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:pointer-events-none mt-2"
                >
                  {loading ? '处理中...' : isLogin ? '登录' : '注册并发送验证码'}
                  {!loading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                </button>
              </form>
            </div>
          )}
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
