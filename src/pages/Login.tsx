import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  LogIn,
  UserPlus,
  Mail,
  Lock,
  ShieldCheck,
  ArrowRight,
  KeyRound,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

type Step = 'form' | 'verify' | 'done' | 'forgot';

const MIN_PASSWORD_LENGTH = 8;

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
          setError(authError.message);
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

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });

    if (signUpError) {
      if (signUpError.message.toLowerCase().includes('already registered')) {
        setError('该邮箱已注册，请直接登录。');
      } else {
        setError(signUpError.message);
      }
    } else {
      setStep('verify');
      setInfo('验证码已发送，请到邮箱查收。');
    }
    setLoading(false);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearBanner();
    setLoading(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'signup',
    });

    if (verifyError) {
      setError('验证码无效或已过期，请重试。');
      setLoading(false);
      return;
    }

    setStep('done');
    setLoading(false);
    setTimeout(() => navigate('/'), 1200);
  };

  const handleResendOtp = async () => {
    clearBanner();
    setLoading(true);
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
    if (resendError) {
      setError('验证码发送失败，请稍后再试。');
    } else {
      setInfo('验证码已重新发送，请检查邮箱。');
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
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
    } else {
      setRecoveryCodeSent(true);
      setRecoveryOtp('');
      setInfo('重置密码验证码已发送，请输入邮件中的 6 位验证码。');
    }
    setLoading(false);
  };

  const handleVerifyRecoveryOtp = async () => {
    clearBanner();

    if (!email.trim()) {
      setError('请先输入邮箱地址。');
      return;
    }

    if (recoveryOtp.length !== 6) {
      setError('请输入 6 位验证码。');
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    setLoading(true);

    const { error: recoveryError } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: recoveryOtp,
      type: 'recovery',
    });

    if (recoveryError) {
      const { error: emailOtpError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: recoveryOtp,
        type: 'email' as 'email',
      });

      if (emailOtpError) {
        setError(`验证码校验失败：${emailOtpError.message}`);
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    navigate('/reset-password');
  };

  const goToForgot = () => {
    setStep('forgot');
    clearBanner();
    setPassword('');
    setConfirmPassword('');
    setRecoveryOtp('');
    setRecoveryCodeSent(false);
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
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-100 rounded-full blur-[100px] animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-50 rounded-full blur-[100px]"></div>

      <div className="w-full max-w-md z-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 mb-6 shadow-xl shadow-blue-500/20">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">TechPro Recruit</h1>
          <p className="text-gray-500 mt-2 font-medium">企业级招聘管理平台</p>
        </div>

        <div className="bg-white border border-gray-100 rounded-3xl p-8 shadow-2xl shadow-gray-200/50">
          {step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-8 animate-in fade-in zoom-in">
              <CheckCircle2 className="w-16 h-16 text-green-500" />
              <p className="text-gray-900 font-bold text-xl">注册成功</p>
              <p className="text-gray-500 text-sm">正在为你跳转到系统首页...</p>
            </div>
          )}

          {step === 'verify' && (
            <div className="animate-in slide-in-from-right-4 fade-in duration-300">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-50 mb-4 ring-4 ring-blue-50/50">
                  <KeyRound className="w-6 h-6 text-blue-600" />
                </div>
                <h2 className="text-gray-900 font-bold text-xl">邮箱验证码</h2>
                <p className="text-gray-500 text-sm mt-2">
                  我们已发送 6 位验证码到 <span className="text-blue-600 font-semibold">{email}</span>
                </p>
                <p className="text-gray-400 text-xs mt-1">请输入验证码完成注册。</p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <div className="space-y-2 text-center">
                  <label className="text-xs font-bold uppercase tracking-widest text-gray-400">验证码</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full bg-gray-50 border border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 px-5 py-4 rounded-xl text-gray-900 outline-none transition-all placeholder:text-gray-300 text-center text-3xl font-bold tracking-[0.5em] shadow-inner"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-100 text-red-600 text-sm py-3 px-4 rounded-xl flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                    {error}
                  </div>
                )}
                {info && (
                  <div className="bg-green-50 border border-green-100 text-green-700 text-sm py-3 px-4 rounded-xl flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                    {info}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || otp.length < 6}
                  className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:pointer-events-none"
                >
                  {loading ? '验证中...' : '确认并进入系统'}
                  {!loading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                </button>

                <div className="text-center pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={loading}
                    className="text-sm text-gray-500 hover:text-blue-600 font-medium transition-colors disabled:opacity-60"
                  >
                    重新发送验证码
                  </button>
                </div>
              </form>
            </div>
          )}

          {step === 'forgot' && (
            <div className="animate-in slide-in-from-right-4 fade-in duration-300">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-50 mb-4 ring-4 ring-blue-50/50">
                  <KeyRound className="w-6 h-6 text-blue-600" />
                </div>
                <h2 className="text-gray-900 font-bold text-xl">找回密码</h2>
                <p className="text-gray-500 text-sm mt-2">输入注册邮箱，我们会发送重置验证码。</p>
              </div>

              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">邮箱</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <input
                      type="email"
                      required
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full bg-white border border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 px-11 py-3.5 rounded-xl text-gray-900 outline-none transition-all placeholder:text-gray-300 font-medium"
                    />
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-100 text-red-600 text-sm py-3 px-4 rounded-xl flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                    <span className="leading-tight">{error}</span>
                  </div>
                )}
                {info && (
                  <div className="bg-green-50 border border-green-100 text-green-700 text-sm py-3 px-4 rounded-xl flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0"></div>
                    <span className="leading-tight">{info}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:pointer-events-none"
                >
                  {loading ? '发送中...' : '发送重置邮件'}
                  {!loading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                </button>

                {recoveryCodeSent && (
                  <div className="space-y-3 border border-gray-100 rounded-xl p-4 bg-gray-50/60">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">
                      重置验证码（6位）
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={recoveryOtp}
                      onChange={(e) => setRecoveryOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="请输入 6 位验证码"
                      className="w-full bg-white border border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 px-4 py-3 rounded-xl text-gray-900 outline-none transition-all placeholder:text-gray-300 font-medium text-center tracking-[0.3em]"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyRecoveryOtp}
                      disabled={loading || recoveryOtp.length < 6}
                      className="w-full border border-blue-200 text-blue-700 font-semibold py-3 rounded-xl hover:bg-blue-50 transition-colors disabled:opacity-60 disabled:pointer-events-none"
                    >
                      {loading ? '验证中...' : '验证验证码并重置密码'}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={backToLogin}
                  className="w-full border border-gray-200 text-gray-700 font-semibold py-3 rounded-xl hover:bg-gray-50 transition-colors"
                >
                  返回登录
                </button>
              </form>
            </div>
          )}

          {step === 'form' && (
            <div className="animate-in slide-in-from-left-4 fade-in duration-300">
              <div className="flex bg-gray-100/80 p-1.5 rounded-xl mb-8 shadow-inner">
                <button
                  onClick={() => switchMode(true)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    isLogin ? 'bg-white text-blue-600 shadow border border-gray-100' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <LogIn className="w-4 h-4" /> 登录
                </button>
                <button
                  onClick={() => switchMode(false)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    !isLogin ? 'bg-white text-blue-600 shadow border border-gray-100' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <UserPlus className="w-4 h-4" /> 注册
                </button>
              </div>

              <form onSubmit={handleAuth} className="space-y-5 flex flex-col">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">邮箱</label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full bg-white border border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 px-11 py-3.5 rounded-xl text-gray-900 outline-none transition-all placeholder:text-gray-300 font-medium"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
                      {isLogin ? '密码' : '设置密码'}{' '}
                      {!isLogin && (
                        <span className="text-gray-400 font-normal normal-case tracking-normal pl-1">
                          (至少 {MIN_PASSWORD_LENGTH} 位)
                        </span>
                      )}
                    </label>
                    {isLogin && (
                      <button type="button" onClick={goToForgot} className="text-xs text-blue-600 font-medium hover:underline">
                        忘记密码？
                      </button>
                    )}
                  </div>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="请输入密码"
                      className="w-full bg-white border border-gray-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 px-11 py-3.5 rounded-xl text-gray-900 outline-none transition-all placeholder:text-gray-300 font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {!isLogin && (
                  <div className="space-y-1.5 animate-in slide-in-from-top-2 fade-in">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">确认密码</label>
                    <div className="relative group">
                      <Lock
                        className={`absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${
                          confirmPassword && confirmPassword !== password
                            ? 'text-red-400'
                            : 'text-gray-400 group-focus-within:text-blue-500'
                        }`}
                      />
                      <input
                        type={showConfirm ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="请再次输入密码"
                        className={`w-full bg-white border focus:ring-4 px-11 py-3.5 rounded-xl text-gray-900 outline-none transition-all placeholder:text-gray-300 font-medium ${
                          confirmPassword && confirmPassword !== password
                            ? 'border-red-300 focus:border-red-500 focus:ring-red-500/10'
                            : 'border-gray-200 focus:border-blue-500 focus:ring-blue-500/10'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm((v) => !v)}
                        className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors ${
                          confirmPassword && confirmPassword !== password
                            ? 'text-red-400'
                            : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    {confirmPassword && confirmPassword !== password && (
                      <p className="text-red-500 text-xs font-medium ml-1 flex items-center gap-1 mt-1 animate-in fade-in">
                        两次密码不一致
                      </p>
                    )}
                    {confirmPassword && confirmPassword === password && (
                      <p className="text-green-600 text-xs font-medium ml-1 flex items-center gap-1 mt-1 animate-in fade-in">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 密码一致
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <div className="bg-red-50 border border-red-100 text-red-600 text-sm py-3 px-4 rounded-xl flex items-start gap-2 mt-4 animate-in fade-in">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                    <span className="leading-tight">{error}</span>
                  </div>
                )}
                {info && (
                  <div className="bg-green-50 border border-green-100 text-green-700 text-sm py-3 px-4 rounded-xl flex items-start gap-2 mt-4 animate-in fade-in">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0"></div>
                    <span className="leading-tight">{info}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || (!isLogin && confirmPassword !== password)}
                  className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:pointer-events-none mt-2"
                >
                  {loading ? '处理中...' : isLogin ? '登录' : '注册并发送验证码'}
                  {!loading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                </button>
              </form>
            </div>
          )}
        </div>

        <div className="mt-8 text-center flex items-center justify-center gap-2">
          <div className="w-8 h-px bg-gray-300"></div>
          <p className="text-gray-400 text-[10px] uppercase font-bold tracking-[0.2em]">Secure Infrastructure</p>
          <div className="w-8 h-px bg-gray-300"></div>
        </div>
      </div>
    </div>
  );
}
