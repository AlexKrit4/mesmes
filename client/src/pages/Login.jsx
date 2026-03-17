import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api.js';

function formatBanDate(d) {
  if (!d) return null;
  const s = d.endsWith('Z') || d.includes('+') ? d : d + 'Z';
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ public_id: '', password: '' });
  const [twoFAToken, setTwoFAToken] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFAUser, setTwoFAUser] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Show ban screen if redirected from socket ban or from login attempt
  const [banInfo, setBanInfo] = useState(() => {
    if (searchParams.get('banned') === '1') {
      return {
        reason: searchParams.get('reason') || 'Нарушение правил',
        expires_at: searchParams.get('expires_at') || null,
        banned_at: null,
      };
    }
    return null;
  });

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const resetTwoFA = () => {
    setTwoFAToken('');
    setTwoFACode('');
    setTwoFAUser(null);
  };

  const requiresTwoFA = !!twoFAToken;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBanInfo(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      if (data?.requires_2fa && data?.twofa_token) {
        setTwoFAToken(data.twofa_token);
        setTwoFAUser(data.user || null);
        setTwoFACode('');
        return;
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('me', JSON.stringify(data.user));
      navigate('/');
    } catch (err) {
      const d = err.response?.data;
      if (d?.error === 'banned') {
        setBanInfo({ reason: d.reason, expires_at: d.expires_at, banned_at: d.banned_at });
      } else {
        setError(d?.error || 'Ошибка соединения');
      }
    } finally {
      setLoading(false);
    }
  };

  const submitTwoFA = async (e) => {
    e.preventDefault();
    setError('');
    setBanInfo(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login/2fa', {
        twofa_token: twoFAToken,
        code: twoFACode,
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('me', JSON.stringify(data.user));
      navigate('/');
    } catch (err) {
      const d = err.response?.data;
      if (d?.error === 'banned') {
        setBanInfo({ reason: d.reason, expires_at: d.expires_at, banned_at: d.banned_at });
      } else {
        setError(d?.error || 'Ошибка подтверждения 2FA');
      }
    } finally {
      setLoading(false);
    }
  };

  if (banInfo) {
    return (
      <div className="auth-page">
        <div className="auth-card ban-card">
          <div className="ban-icon">⛔</div>
          <h1>Аккаунт заблокирован</h1>
          <div className="ban-reason-label">Причина:</div>
          <div className="ban-reason">{banInfo.reason}</div>
          <div className="ban-dates">
            <div>Дата бана: {formatBanDate(banInfo.banned_at)}</div>
            <div>{banInfo.expires_at ? `Действует до: ${formatBanDate(banInfo.expires_at)}` : 'Бан: бессрочный'}</div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setBanInfo(null)}>
            Назад
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">M</div>
        <h1>{requiresTwoFA ? 'Подтверждение 2FA' : 'Вход в МесМес'}</h1>
        <p className="subtitle">
          {requiresTwoFA
            ? `Введите 6-значный код из приложения-аутентификатора${twoFAUser?.public_id ? ` для ${twoFAUser.public_id}` : ''}`
            : 'Используйте ваш ID или номер телефона'}
        </p>

        {error && <div className="error-box">{error}</div>}

        {!requiresTwoFA ? (
          <>
            <form onSubmit={submit}>
              <div className="form-group">
                <label>ID или телефон</label>
                <input
                  name="public_id"
                  placeholder="ID или номер телефона"
                  autoComplete="username"
                  value={form.public_id}
                  onChange={handle}
                  required
                />
              </div>
              <div className="form-group">
                <label>Пароль</label>
                <input
                  name="password"
                  type="password"
                  placeholder="••••••"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={handle}
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Входим...' : 'Войти'}
              </button>
            </form>

            <p className="auth-footer">
              Нет аккаунта? <Link to="/register">Создать</Link>
            </p>
            <p className="auth-footer">
              Забыли пароль? <Link to="/forgot-password">Восстановить</Link>
            </p>
          </>
        ) : (
          <form onSubmit={submitTwoFA}>
            <div className="form-group">
              <label>Код 2FA</label>
              <input
                name="twofa_code"
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading || twoFACode.length !== 6}>
              {loading ? 'Проверяем...' : 'Подтвердить вход'}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={resetTwoFA}
              style={{ width: '100%', marginTop: 10 }}
              disabled={loading}
            >
              Назад
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
