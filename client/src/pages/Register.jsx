import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import api from '../api.js';

const TURNSTILE_SITE_KEY = '0x4AAAAAACi87S1DS291JfWx';

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // step 1: email+captcha, step 2: code only, step 3: account form
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [form, setForm] = useState({ display_name: '', public_id: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleData, setGoogleData] = useState(null);

  const turnstileRef = useRef(null);
  const widgetIdRef = useRef(null);
  const tokenRef = useRef('');

  // Check if coming from Google OAuth
  useEffect(() => {
    if (searchParams.get('google') === 'true') {
      const data = JSON.parse(localStorage.getItem('googleData') || 'null');
      if (data) {
        setGoogleData(data);
        setEmail(data.email);
        setStep(3);
        localStorage.removeItem('googleData');
      }
    }
  }, [searchParams]);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/google', { token: credentialResponse.credential });
      
      if (data.new_user) {
        // This is a new user from Google
        setGoogleData({ email: data.email, googleId: data.googleId, name: data.name });
        setEmail(data.email);
        setForm({ ...form, display_name: data.name });
        setStep(3);
      } else {
        // User already exists - redirect to login
        setError('Аккаунт с этой почтой уже существует. Пожалуйста, войдите.');
        setTimeout(() => navigate('/login'), 2000);
      }
    } catch (err) {
      const d = err.response?.data;
      setError(d?.error || 'Ошибка регистрации через Google');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Ошибка при входе через Google. Попробуйте ещё раз.');
  };

  useEffect(() => {
    if (step !== 1) return;
    const render = () => {
      if (!turnstileRef.current || !window.turnstile) return;
      if (widgetIdRef.current != null) {
        try { window.turnstile.remove(widgetIdRef.current); } catch {}
      }
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'dark',
        callback: (t) => { tokenRef.current = t; },
        'expired-callback': () => { tokenRef.current = ''; },
      });
    };
    if (window.turnstile) {
      render();
    } else if (!document.getElementById('cf-turnstile-script')) {
      const s = document.createElement('script');
      s.id = 'cf-turnstile-script';
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.defer = true; s.onload = render;
      document.head.appendChild(s);
    } else {
      const iv = setInterval(() => { if (window.turnstile) { clearInterval(iv); render(); } }, 100);
    }
  }, [step]);

  // Step 1: send code
  const sendCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!tokenRef.current) return setError('Пожалуйста, пройдите проверку капчи');
    setLoading(true);
    try {
      await api.post('/auth/send-code', { email, turnstile_token: tokenRef.current });
      setStep(2);
    } catch (err) {
      const msg = err.response?.data?.error || (err.code === 'ECONNABORTED' ? 'Тайм-аут. Попробуйте ещё раз.' : '') || err.message || 'Ошибка соединения';
      setError(msg);
      if (widgetIdRef.current != null && window.turnstile) window.turnstile.reset(widgetIdRef.current);
      tokenRef.current = '';
    } finally {
      setLoading(false);
    }
  };

  // Step 2: verify code
  const verifyCode = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/verify-code', { email, code });
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Неверный или просроченный код');
    } finally {
      setLoading(false);
    }
  };

  // Step 3: register
  const register = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Пароли не совпадают');
    setLoading(true);
    try {
      let data;
      
      if (googleData) {
        // Google OAuth registration
        const response = await api.post('/auth/google/complete', {
          email: googleData.email,
          googleId: googleData.googleId,
          public_id: form.public_id,
          password: form.password,
          display_name: form.display_name,
        });
        data = response.data;
      } else {
        // Email verification registration
        const response = await api.post('/auth/register', {
          display_name: form.display_name,
          public_id: form.public_id,
          password: form.password,
          email,
          code,
        });
        data = response.data;
      }
      
      localStorage.setItem('token', data.token);
      localStorage.setItem('me', JSON.stringify(data.user));
      localStorage.setItem('newUser', '1');
      if (data?.premium_granted_days) {
        localStorage.setItem('premiumGrantedAtRegistration', '1');
        if (data.user?.premium_until) {
          localStorage.setItem('premiumGrantedUntil', data.user.premium_until);
        }
      }
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Ошибка соединения');
    } finally {
      setLoading(false);
    }
  };

  const stepTitles = googleData ? ['', '', 'Завершите регистрацию'] : ['Подтвердите почту', 'Введите код', 'Создайте аккаунт'];

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">M</div>
        <h1>{stepTitles[step - 1]}</h1>

        {step === 1 && <p className="subtitle">Введите email — пришлём код подтверждения</p>}
        {step === 2 && <p className="subtitle">Код отправлен на <strong>{email}</strong></p>}
        {step === 3 && <p className="subtitle">{googleData ? `Почта: ${email}` : 'Почта подтверждена'} — придумайте логин и пароль</p>}

        {error && <div className="error-box">{error}</div>}

        {step === 1 && (
          <form onSubmit={sendCode}>
            <div className="form-group">
              <label>Электронная почта</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div style={{ margin: '16px 0' }}>
              <div ref={turnstileRef} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Отправляем...' : 'Отправить код'}
            </button>

            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <p style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>или</p>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
                locale="ru"
              />
            </div>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={verifyCode}>
            <div className="form-group">
              <label>Код из письма</label>
              <input
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                maxLength={6}
                required
                autoFocus
                style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center' }}
              />
              <p className="hint">
                Не пришло?{' '}
                <button type="button" className="link-btn" onClick={() => { setStep(1); setError(''); setCode(''); }}>
                  Отправить снова
                </button>
              </p>
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading || code.length < 6}>
              {loading ? 'Проверяем...' : 'Подтвердить'}
            </button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={register}>
            {googleData && (
              <div className="form-group" style={{ background: 'var(--bg2)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>Почта:</p>
                <p style={{ margin: '4px 0 0 0', fontSize: 16 }}>{email}</p>
              </div>
            )}
            <div className="form-group">
              <label>Ваше имя (видят все)</label>
              <input name="display_name" placeholder="Иван" value={form.display_name} onChange={handle} required autoFocus />
            </div>
            <div className="form-group">
              <label>Уникальный ID (для входа и поиска)</label>
              <input name="public_id" placeholder="ivan_2026" value={form.public_id} onChange={handle} required />
              <p className="hint">Латиница, цифры и _ (3–30 символов).</p>
            </div>
            <div className="form-group">
              <label>Пароль</label>
              <input name="password" type="password" placeholder="Минимум 6 символов" autoComplete="new-password" value={form.password} onChange={handle} required />
            </div>
            <div className="form-group">
              <label>Повторите пароль</label>
              <input name="confirm" type="password" placeholder="••••••" autoComplete="new-password" value={form.confirm} onChange={handle} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Создаём...' : 'Создать аккаунт'}
            </button>
          </form>
        )}

        <p className="auth-footer">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
