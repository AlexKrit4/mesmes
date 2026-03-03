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

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBanInfo(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
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
        <h1>Вход в МесМес</h1>
        <p className="subtitle">Используйте ваш ID или номер телефона</p>

        {error && <div className="error-box">{error}</div>}

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
      </div>
    </div>
  );
}
