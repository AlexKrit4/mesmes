import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { disconnectSocket } from '../socket.js';

export default function Settings() {
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const logout = () => {
    disconnectSocket();
    localStorage.removeItem('token');
    localStorage.removeItem('me');
    navigate('/login', { replace: true });
  };

  const deleteAccount = async () => {
    setLoading(true);
    try {
      await api.delete('/users/me');
      disconnectSocket();
      localStorage.removeItem('token');
      localStorage.removeItem('me');
      navigate('/login', { replace: true });
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка удаления');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="topbar">
        <button className="topbar-btn" onClick={() => navigate('/')} title="Назад">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="topbar-title">Настройки</span>
        <div style={{ width: 40 }} />
      </div>

      <div className="settings-content">

        {/* My profile link */}
        <button className="settings-action-btn" onClick={() => navigate(`/${me.public_id}`)} style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Мой профиль
        </button>

        <div className="settings-divider" />

        {/* Notifications */}
        <div className="settings-section">
          <div className="settings-section-title">Уведомления</div>
          <p className="settings-msg" style={{ color: 'var(--text2)', lineHeight: 1.5 }}>
            Если уведомления не работают, включите их в настройках приложения на вашем устройстве. Дайте разрешение приложению показывать уведомления, и все заработает!
          </p>
        </div>

        <div className="settings-divider" />

        {/* Official channel promo */}
        <a
          href="https://mesmes.ru/join/13982bc70f56"
          className="settings-promo-btn"
          style={{ textDecoration: 'none' }}
        >
          <div className="settings-promo-title">Следи за обновлениями на оффициальном канале мессенджера!</div>
          <div className="settings-promo-sub">Здесь рассказывают какие выходят обновления и какие крутые функции в мессенджере MesMes!</div>
        </a>

        <div className="settings-divider" />

        {/* Logout */}
        {!showLogoutConfirm ? (
          <button className="settings-action-btn logout" onClick={() => setShowLogoutConfirm(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Выйти из аккаунта
          </button>
        ) : (
          <div className="settings-confirm">
            <p className="settings-confirm-text">Вы уверены, что хотите выйти?</p>
            <div className="settings-confirm-btns">
              <button className="btn btn-ghost" onClick={() => setShowLogoutConfirm(false)}>Отмена</button>
              <button className="btn btn-danger" onClick={logout}>Выйти</button>
            </div>
          </div>
        )}

        {/* Delete account */}
        {!showDeleteConfirm ? (
          <button className="settings-action-btn danger" onClick={() => setShowDeleteConfirm(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            Удалить аккаунт
          </button>
        ) : (
          <div className="settings-confirm">
            <p className="settings-confirm-text">Вы уверены? Все сообщения и данные будут удалены безвозвратно.</p>
            <div className="settings-confirm-btns">
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Отмена</button>
              <button className="btn btn-danger" onClick={deleteAccount} disabled={loading}>Удалить</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
