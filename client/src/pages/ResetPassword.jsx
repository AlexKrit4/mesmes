import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api.js';

export default function ResetPassword() {
  const { token } = useParams();
  const [tokenValid, setTokenValid] = useState(null); // null=checking, true, false
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [status, setStatus] = useState(null); // 'done' | 'error'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(5);

  // Валидируем токен при загрузке
  useEffect(() => {
    api.get(`/auth/reset-password/${token}`)
      .then(() => setTokenValid(true))
      .catch(() => setTokenValid(false));
  }, [token]);

  // Обратный отсчёт и закрытие вкладки после успеха
  useEffect(() => {
    if (status !== 'done') return;
    if (countdown <= 0) {
      window.close();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [status, countdown]);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Пароли не совпадают');
      return;
    }
    setLoading(true);
    try {
      await api.post(`/auth/reset-password/${token}`, { password: form.password });
      setStatus('done');
    } catch (err) {
      const msg = err.response?.data?.error || 'Ошибка соединения';
      setError(msg);
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  // Проверяем токен
  if (tokenValid === null) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">M</div>
          <p className="subtitle">Проверяем ссылку...</p>
        </div>
      </div>
    );
  }

  if (tokenValid === false) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">M</div>
          <h1>Ссылка недействительна</h1>
          <p className="subtitle">Ссылка устарела или уже была использована. Запросите новую.</p>
          <Link to="/forgot-password" className="btn btn-primary" style={{ marginTop: 16, display: 'block', textAlign: 'center' }}>
            Запросить снова
          </Link>
          <p className="auth-footer"><Link to="/login">← Ко входу</Link></p>
        </div>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">M</div>
          <div className="reset-success-box">
            <div className="reset-success-icon">✅</div>
            <p><strong>Пароль успешно изменён!</strong></p>
            <p className="reset-success-hint">Вкладка закроется через {countdown} секунд...</p>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: 16, display: 'block', textAlign: 'center' }}>
              Войти
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">M</div>
        <h1>Новый пароль</h1>
        <p className="subtitle">Придумайте новый пароль для входа</p>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={submit}>
          <div className="form-group">
            <label>Введите новый пароль</label>
            <input
              name="password"
              type="password"
              placeholder="••••••"
              autoComplete="new-password"
              value={form.password}
              onChange={handle}
              minLength={6}
              required
            />
          </div>
          <div className="form-group">
            <label>Подтвердите новый пароль</label>
            <input
              name="confirm"
              type="password"
              placeholder="••••••"
              autoComplete="new-password"
              value={form.confirm}
              onChange={handle}
              minLength={6}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Сохраняем...' : 'Восстановить'}
          </button>
        </form>

        <p className="auth-footer">
          <Link to="/login">← Ко входу</Link>
        </p>
      </div>
    </div>
  );
}
