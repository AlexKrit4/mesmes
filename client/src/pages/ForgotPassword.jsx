import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api.js';

export default function ForgotPassword() {
  const [form, setForm] = useState({ email: '', public_id: '' });
  const [status, setStatus] = useState(null); // 'sent' | 'error'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus(null);
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', form);
      setStatus('sent');
    } catch (err) {
      const msg = err.response?.data?.error || 'Ошибка соединения';
      setError(msg);
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">M</div>
        <h1>Восстановление пароля</h1>
        <p className="subtitle">Введите почту и ID от вашего аккаунта</p>

        {status === 'sent' ? (
          <div className="reset-success-box">
            <div className="reset-success-icon">✉️</div>
            <p>Письмо отправлено на <strong>{form.email}</strong></p>
            <p className="reset-success-hint">Перейдите по ссылке в письме, чтобы задать новый пароль.</p>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: 16, display: 'block', textAlign: 'center' }}>
              Вернуться ко входу
            </Link>
          </div>
        ) : (
          <>
            {error && <div className="error-box">{error}</div>}

            <form onSubmit={submit}>
              <div className="form-group">
                <label>Email</label>
                <input
                  name="email"
                  type="email"
                  placeholder="your@email.com"
                  autoComplete="email"
                  value={form.email}
                  onChange={handle}
                  required
                />
              </div>
              <div className="form-group">
                <label>Публичный ID</label>
                <input
                  name="public_id"
                  placeholder="ваш_id"
                  autoComplete="username"
                  value={form.public_id}
                  onChange={handle}
                  required
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Отправляем...' : 'Отправить письмо'}
              </button>
            </form>

            <p className="auth-footer">
              <Link to="/login">← Вернуться ко входу</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
