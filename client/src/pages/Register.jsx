import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';

const TURNSTILE_SITE_KEY = '0x4AAAAAACi87S1DS291JfWx';

export default function Register() {
  const navigate = useNavigate();

  // Step 1: email + captcha. Step 2: code + account details
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [form, setForm] = useState({ display_name: '', public_id: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const turnstileRef = useRef(null);
  const widgetIdRef = useRef(null);
  const tokenRef = useRef('');

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  // Load Turnstile script and render widget on step 1
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
    } else {
      // Load script if not already loading
      if (!document.getElementById('cf-turnstile-script')) {
        const s = document.createElement('script');
        s.id = 'cf-turnstile-script';
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.defer = true;
        s.onload = render;
        document.head.appendChild(s);
      } else {
        // script tag exists but not loaded yet — poll
        const interval = setInterval(() => {
          if (window.turnstile) { clearInterval(interval); render(); }
        }, 100);
      }
    }
  }, [step]);

  // Step 1 submit: send verification code
  const sendCode = async (e) => {
    e.preventDefault();
    setError('');
    if (!tokenRef.current) {
      return setError('Пожалуйста, пройдите проверку капчи');
    }
    setLoading(true);
    try {
      await api.post('/auth/send-code', { email, turnstile_token: tokenRef.current });
      setInfo(`Код отправлен на ${email}`);
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка соединения');
      // Reset turnstile
      if (widgetIdRef.current != null && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
      tokenRef.current = '';
    } finally {
      setLoading(false);
    }
  };

  // Step 2 submit: verify code + register
  const register = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Пароли не совпадают');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        display_name: form.display_name,
        public_id: form.public_id,
        password: form.password,
        email,
        code,
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('me', JSON.stringify(data.user));
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка соединения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">M</div>
        <h1>Создать аккаунт</h1>

        {step === 1 && (
          <p className="subtitle">Сначала подтвердите вашу электронную почту</p>
        )}
        {step === 2 && (
          <p className="subtitle">Код отправлен на <strong>{email}</strong></p>
        )}

        {error && <div className="error-box">{error}</div>}
        {info && !error && <div className="info-box">{info}</div>}

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
              />
            </div>
            <div style={{ margin: '16px 0' }}>
              <div ref={turnstileRef} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Отправляем...' : 'Отправить код'}
            </button>
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text2)', textAlign: 'center' }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => { setStep(2); setError(''); }}
              >
                Уже есть код
              </button>
            </p>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={register}>
            <div className="form-group">
              <label>Код из письма</label>
              <input
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                maxLength={6}
                required
                autoFocus
              />
              <p className="hint">
                Не пришло?{' '}
                <button type="button" className="link-btn" onClick={() => { setStep(1); setError(''); setInfo(''); }}>
                  Отправить снова
                </button>
              </p>
            </div>
            <div className="form-group">
              <label>Ваше имя (видят все)</label>
              <input
                name="display_name"
                placeholder="Иван"
                value={form.display_name}
                onChange={handle}
                required
              />
            </div>
            <div className="form-group">
              <label>Уникальный ID (для входа и поиска)</label>
              <input
                name="public_id"
                placeholder="ivan_2026"
                value={form.public_id}
                onChange={handle}
                required
              />
              <p className="hint">Латиница, цифры и _ (3–30 символов).</p>
            </div>
            <div className="form-group">
              <label>Пароль</label>
              <input
                name="password"
                type="password"
                placeholder="Минимум 6 символов"
                autoComplete="new-password"
                value={form.password}
                onChange={handle}
                required
              />
            </div>
            <div className="form-group">
              <label>Повторите пароль</label>
              <input
                name="confirm"
                type="password"
                placeholder="••••••"
                autoComplete="new-password"
                value={form.confirm}
                onChange={handle}
                required
              />
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
