import React, { useState } from 'react';
import { VolunteerUserSession } from '../types';
import {
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  X,
  RefreshCw,
  AlertCircle,
  Database,
  Phone
} from 'lucide-react';

declare global {
  interface Window {
    google?: any;
  }
}

interface GooglePhoneAuthModalProps {
  initialEmail?: string;
  initialName?: string;
  initialPhone?: string;
  onClose: () => void;
  onSuccessLogin: (volunteer: VolunteerUserSession) => void;
}

const GOOGLE_PROFILE_SCOPES = 'openid email profile';

export const GooglePhoneAuthModal: React.FC<GooglePhoneAuthModalProps> = ({
  initialPhone = '',
  onClose,
  onSuccessLogin
}) => {
  // Step state: 1 = Real Google OAuth, 2 = Manual phone entry, 3 = Success
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleName, setGoogleName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState(initialPhone);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [backendSyncLog, setBackendSyncLog] = useState<string[]>([]);
  const [verifiedUserData, setVerifiedUserData] = useState<any>(null);

  const clientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;

  // Step 1: Real Google Sign-In popup (Google Identity Services)
  const handleGoogleSignIn = () => {
    setErrorMsg('');

    if (!clientId) {
      setErrorMsg('尚未設定 VITE_GOOGLE_CLIENT_ID，請先在 .env.local 補上 Google OAuth 用戶端 ID');
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      setErrorMsg('Google 登入元件尚未載入完成，請稍候重試');
      return;
    }

    setIsLoading(true);
    setBackendSyncLog(prev => [
      ...prev,
      `[前端] 呼叫 google.accounts.oauth2.initTokenClient() 開啟 Google 授權視窗...`
    ]);

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_PROFILE_SCOPES,
      callback: async (tokenResponse: any) => {
        if (tokenResponse.error) {
          setIsLoading(false);
          setErrorMsg(`Google 授權失敗：${tokenResponse.error_description || tokenResponse.error}`);
          return;
        }

        setBackendSyncLog(prev => [
          ...prev,
          `[Google] 授權成功，取得 access token，向後台查詢帳號基本資料...`
        ]);

        try {
          const res = await fetch('/api/auth/google-userinfo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: tokenResponse.access_token })
          });
          const data = await res.json();

          if (!data.success) {
            throw new Error(data.error || '查詢 Google 帳號資料失敗');
          }

          setGoogleEmail(data.email || '');
          setGoogleName(data.name || '');
          setBackendSyncLog(prev => [
            ...prev,
            `[Google] 已確認真實帳號身分：${data.name} (${data.email})`
          ]);

          if (data.existingPhone) {
            // Returning volunteer — already have a phone on file, skip manual entry
            setPhoneNumber(data.existingPhone);
            setBackendSyncLog(prev => [
              ...prev,
              `[自建資料庫] 這個 Google 帳號先前已登記過聯絡電話 (${data.existingPhone})，自動跳過填寫步驟`
            ]);
            await persistLoginAndAdvance(data.existingPhone, data.email, data.name);
          } else {
            setIsLoading(false);
            setCurrentStep(2);
          }
        } catch (err: any) {
          setIsLoading(false);
          setErrorMsg(err.message || '查詢 Google 帳號資料失敗');
        }
      }
    });

    tokenClient.requestAccessToken();
  };

  // Persist the (email, name, phone) to the backend volunteer DB and advance to the success step
  const persistLoginAndAdvance = async (phone: string, email: string, name: string) => {
    setIsLoading(true);
    setErrorMsg('');
    setBackendSyncLog(prev => [
      ...prev,
      `[後台 API] POST /api/auth/google-phone-login 寫入志工資料...`
    ]);

    try {
      const res = await fetch('/api/auth/google-phone-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken: 'google-oauth-verified',
          googleProfile: {
            uid: `google-uid-${email.replace(/[@.]/g, '_')}`,
            email,
            name
          },
          phoneNumber: phone,
          lineId: `${email.split('@')[0]}_line`,
          tier: '新進志工',
          totalHours: 0
        })
      });

      const data = await res.json();
      if (data.success && data.user) {
        setVerifiedUserData(data.user);
        setBackendSyncLog(prev => [
          ...prev,
          `[自建資料庫] 寫入/更新成功 (email: ${data.user.email}, phone: ${data.user.rawPhone || data.user.phone})`,
          `[身分核發] Google 帳號登入完成，志工權限已解鎖！`
        ]);
        setCurrentStep(3);
      } else {
        throw new Error(data.error || '後台驗證寫入失敗');
      }
    } catch (err: any) {
      setErrorMsg(err.message || '驗證失敗，請重試');
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Save the manually entered contact phone and persist to backend
  const handleConfirmAndEnter = () => {
    const cleanPhone = phoneNumber.replace(/[-\s]/g, '');
    if (!cleanPhone || cleanPhone.length < 9) {
      setErrorMsg('請輸入有效的聯絡電話 (例如 0912-345-678)');
      return;
    }
    persistLoginAndAdvance(phoneNumber, googleEmail, googleName);
  };

  // Finish and enter system
  const handleFinalEnter = () => {
    const user = verifiedUserData || {
      name: googleName,
      email: googleEmail,
      phone: phoneNumber,
      lineId: `${googleEmail.split('@')[0]}_line`,
      tier: '新進志工',
      totalHours: 0
    };

    localStorage.setItem('volunteer_profile_name', user.name);
    localStorage.setItem('volunteer_profile_email', user.email);
    localStorage.setItem('volunteer_profile_phone', user.phone);
    localStorage.setItem('volunteer_profile_lineid', user.lineId);
    localStorage.setItem('volunteer_google_verified', 'true');

    onSuccessLogin({
      name: user.name,
      email: user.email,
      phone: user.phone,
      lineId: user.lineId,
      tier: user.tier || '新進志工',
      totalHours: user.totalHours || 0
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#716053]/60 backdrop-blur-xs flex items-center justify-center p-4">

      {/* Modal Container */}
      <div className="bg-white rounded-[32px] max-w-xl w-full shadow-2xl overflow-hidden border-2 border-amber-400/80 animate-in fade-in zoom-in-95 duration-200">

        {/* Modal Header */}
        <div className="bg-gradient-to-r from-amber-600 via-amber-700 to-[#716053] p-6 text-white flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center shadow-inner">
              <ShieldCheck className="w-6 h-6 text-amber-100" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold font-serif italic text-lg text-white">Google 帳號登入</h3>
                <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full font-bold">
                  Google OAuth
                </span>
              </div>
              <p className="text-xs text-amber-100/90 font-sans">使用真實 Google 帳號登入，並登記你的聯絡電話</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/20 transition cursor-pointer text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Progress Bar */}
        <div className="bg-[#FAF8F5] px-6 py-3 border-b border-amber-200/50 flex items-center justify-between text-xs font-sans">
          <div className={`flex items-center gap-1.5 font-bold ${currentStep >= 1 ? 'text-amber-700' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${currentStep >= 1 ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-600'}`}>1</span>
            <span>Google 授權</span>
          </div>
          <div className="h-[1px] w-8 bg-slate-300"></div>
          <div className={`flex items-center gap-1.5 font-bold ${currentStep >= 2 ? 'text-amber-700' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${currentStep >= 2 ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-600'}`}>2</span>
            <span>填寫聯絡電話</span>
          </div>
          <div className="h-[1px] w-8 bg-slate-300"></div>
          <div className={`flex items-center gap-1.5 font-bold ${currentStep >= 3 ? 'text-emerald-700' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${currentStep >= 3 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>3</span>
            <span>登入成功</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 font-sans">

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2 text-xs text-rose-700 font-medium animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* STEP 1: Real Google Sign-In */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="text-center space-y-1">
                <h4 className="font-bold text-slate-900 font-serif text-base">
                  步驟 1：使用 Google 帳號登入
                </h4>
                <p className="text-xs text-slate-500">
                  會跳出真實的 Google 授權視窗，用你自己的帳號登入並同意授權即可。
                </p>
              </div>

              {/* Official Google Login Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-slate-800 font-bold rounded-2xl border-2 border-slate-300 hover:border-amber-500 shadow-sm transition flex items-center justify-center gap-3 cursor-pointer disabled:opacity-70"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>使用 Google 帳號登入</span>
                {isLoading && <RefreshCw className="w-4 h-4 animate-spin text-amber-600 ml-1" />}
              </button>
            </div>
          )}

          {/* STEP 2: Manual contact phone entry */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="text-center space-y-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-900 rounded-full text-xs font-bold">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                  <span>步驟 2：Google 帳號已確認</span>
                </div>
                <h4 className="font-bold text-slate-900 font-serif text-base mt-2">
                  請填寫你的聯絡電話
                </h4>
              </div>

              <div className="bg-[#FAF8F5] p-4 rounded-2xl border border-amber-200 space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Google 姓名：</span>
                  <strong className="text-slate-900">{googleName}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Google 帳號：</span>
                  <strong className="text-slate-900">{googleEmail}</strong>
                </div>

                <div className="pt-1">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1">
                    <Phone className="w-3.5 h-3.5 text-amber-600" />
                    聯絡電話
                  </label>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={e => setPhoneNumber(e.target.value)}
                    placeholder="0912-345-678"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-amber-500 outline-hidden"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleConfirmAndEnter}
                disabled={isLoading}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>確認並同步後台資料庫</span>
                {isLoading ? <RefreshCw className="w-4 h-4 animate-spin ml-1" /> : <ArrowRight className="w-4 h-4 ml-1" />}
              </button>
            </div>
          )}

          {/* STEP 3: Success */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-xs">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h4 className="font-bold text-slate-900 font-serif text-lg">
                  🎉 Google 帳號登入成功！
                </h4>
                <p className="text-xs text-emerald-800 font-medium">
                  Google 帳號憑證與聯絡電話已成功登記，後台自建資料庫已更新
                </p>
              </div>

              {/* Profile Card */}
              <div className="bg-[#FAF8F5] p-4 rounded-2xl border-2 border-emerald-500/50 space-y-2.5 text-xs text-slate-700">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="font-bold text-slate-900 font-serif">志工登入憑證卡</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-[10px] border border-emerald-300 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Google 帳號已登入</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500">志工姓名：</span>
                    <strong className="text-slate-900 ml-1">{googleName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Google 帳號：</span>
                    <strong className="text-slate-900 ml-1">{googleEmail}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">聯絡電話：</span>
                    <strong className="text-emerald-800 font-mono ml-1">{phoneNumber}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">認證提供者：</span>
                    <span className="ml-1 text-slate-800 font-semibold font-mono">google.com (OAuth)</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleFinalEnter}
                className="w-full py-3.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-2xl text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer transform hover:scale-[1.01]"
              >
                <span>正式進入志工專屬服務平台</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Real-time Architecture & Terminal Log Inspector */}
          <div className="bg-slate-900 text-emerald-400 p-3 rounded-2xl text-[10px] font-mono space-y-1 max-h-32 overflow-y-auto border border-slate-800">
            <div className="text-slate-400 font-bold flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
              <span className="flex items-center gap-1">
                <Database className="w-3 h-3 text-amber-400" />
                <span>前後台驗證與資料庫寫入日誌：</span>
              </span>
              <span className="text-slate-500">Live Auth Trace</span>
            </div>
            {backendSyncLog.length === 0 ? (
              <div className="text-slate-500">等待使用者點擊「使用 Google 帳號登入」啟動驗證鏈...</div>
            ) : (
              backendSyncLog.map((log, idx) => (
                <div key={idx} className="leading-tight">
                  <span className="text-slate-600">[{idx + 1}]</span> {log}
                </div>
              ))
            )}
          </div>

        </div>

      </div>
    </div>
  );
};
