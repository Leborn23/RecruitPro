import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ShieldCheck, Lock, ArrowRight, Eye, EyeOff, CheckCircle2 } from 'lucide-react';

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
        if (exchangeError) {
          return { ok: false, message: exchangeError.message };
        }
      } else if (type === 'recovery' && accessToken && refreshToken) {
        const { error: setSessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (setSessionError) {
          return { ok: false, message: setSessionError.message };
        }
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

    bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-100 rounded-full blur-[100px] animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-50 rounded-full blur-[100px]"></div>

      <div className="w-full max-w-md z-10">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 mb-6 shadow-xl shadow-blue-500/20">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">TechPro Recruit</h1>
          <p className="text-gray-500 mt-2 font-medium">设置新密码</p>
        </div>

        <div className="bg-white border border-gray-100 rounded-3xl p-8 shadow-2xl shadow-gray-200/50">
          <div className="text-center mb-6">
            <h2 className="text-gray-900 font-bold text-xl">重置密码</h2>
            <p className="text-gray-500 text-sm mt-2">请输入新密码并确认。</p>
          </div>

          {checkingSession ? (
            <div className="text-sm text-gray-500 text-center py-8">正在校验重置链接...</div>
          ) : !ready ? (
            <div className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 text-sm py-3 px-4 rounded-xl flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                  <span className="leading-tight">{error}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full border border-gray-200 text-gray-700 font-semibold py-3 rounded-xl hover:bg-gray-50 transition-colors"
              >
                返回登录页
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">
                  新密码 <span className="text-gray-400 font-normal normal-case tracking-normal pl-1">(至少 {MIN_PASSWORD_LENGTH} 位)</span>
                </label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入新密码"
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

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">确认新密码</label>
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
                    placeholder="请再次输入新密码"
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
                {confirmPassword && confirmPassword === password && (
                  <p className="text-green-600 text-xs font-medium ml-1 flex items-center gap-1 mt-1 animate-in fade-in">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 两次密码一致
                  </p>
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 text-sm py-3 px-4 rounded-xl flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></div>
                  <span className="leading-tight">{error}</span>
                </div>
              )}
              {success && (
                <div className="bg-green-50 border border-green-100 text-green-700 text-sm py-3 px-4 rounded-xl flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0"></div>
                  <span className="leading-tight">{success}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !!success}
                className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl shadow-lg shadow-blue-500/30 hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group disabled:opacity-60 disabled:pointer-events-none"
              >
                {loading ? '提交中...' : '更新密码'}
                {!loading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
