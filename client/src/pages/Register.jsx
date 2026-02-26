import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api.js';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', public_id: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Пароли не совпадают');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        username: form.username,
        public_id: form.public_id,
        password: form.password,
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
        <h1>МесМес 💬</h1>
        <p className="subtitle">Создайте аккаунт</p>

        {error && <div className="error-box">{error}</div>}

        <form onSubmit={submit}>
          <div className="form-group">
            <label>Имя пользователя (для входа)</label>
            <input
              name="username"
              placeholder="ИванИванов"
              autoComplete="username"
              value={form.username}
              onChange={handle}
              required
            />
          </div>
          <div className="form-group">
            <label>Ваш публичный ID</label>
            <input
              name="public_id"
              placeholder="ivan_2025"
              value={form.public_id}
              onChange={handle}
              required
            />
            <p className="hint">Только латиница, цифры и _ (3–30 символов). По этому ID вас найдут друзья.</p>
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
            {loading ? 'Создаём...' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className="auth-footer">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </div>
    </div>
  );
}
