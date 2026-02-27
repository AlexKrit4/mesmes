import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { disconnectSocket } from '../socket.js';
import { subscribeToPush } from '../pushNotifications.js';

export default function Settings() {
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');

  const [username, setUsername] = useState(me.username || '');
  const [publicId, setPublicId] = useState(me.public_id || '');
  const [nameMsg, setNameMsg] = useState('');
  const [idMsg, setIdMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [idRateLimitHours, setIdRateLimitHours] = useState(0); // 0 = no limit
  const [pushPermission, setPushPermission] = useState(() =>
    'Notification' in window ? Notification.permission : 'unsupported'
  );

  const enablePushFromSettings = async () => {
    await subscribeToPush();
    if ('Notification' in window) setPushPermission(Notification.permission);
  };

  // Fetch user data to check last_public_id_change
  useEffect(() => {
    api.get('/users/me').then(({ data }) => {
      if (data.last_public_id_change) {
        const diff = Date.now() - new Date(
          data.last_public_id_change.endsWith('Z') ? data.last_public_id_change : data.last_public_id_change + 'Z'
        ).getTime();
        if (diff < 24 * 60 * 60 * 1000) {
          setIdRateLimitHours(Math.ceil((24 * 60 * 60 * 1000 - diff) / 3600000));
        }
      }
    }).catch(() => {});
  }, []);

  const saveName = async () => {
    if (!username.trim() || username.trim() === me.username) return;
    setLoading(true);
    setNameMsg('');
    try {
      const { data } = await api.patch('/users/me', { username: username.trim() });
      const meData = JSON.parse(localStorage.getItem('me') || '{}');
      meData.username = data.username;
      localStorage.setItem('me', JSON.stringify(meData));
      setNameMsg('✓ Имя обновлено');
    } catch (err) {
      setNameMsg(err.response?.data?.error || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const saveId = async () => {
    if (!publicId.trim() || publicId.trim() === me.public_id) return;
    setLoading(true);
    setIdMsg('');
    try {
      const { data } = await api.patch('/users/me', { public_id: publicId.trim() });
      const meData = JSON.parse(localStorage.getItem('me') || '{}');
      meData.public_id = data.public_id;
      localStorage.setItem('me', JSON.stringify(meData));
      setIdMsg('✓ ID обновлён');
      setIdRateLimitHours(24);
    } catch (err) {
      setIdMsg(err.response?.data?.error || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

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

        {/* Change name */}
        <div className="settings-section">
          <div className="settings-section-title">Имя пользователя</div>
          <div className="settings-row">
            <input
              className="settings-input"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setNameMsg(''); }}
              placeholder="Ваше имя"
              maxLength={32}
            />
            <button
              className="btn btn-accent settings-save-btn"
              onClick={saveName}
              disabled={loading || !username.trim() || username.trim() === me.username}
            >
              Сохранить
            </button>
          </div>
          {nameMsg && (
            <p className={`settings-msg ${nameMsg.startsWith('✓') ? 'success' : 'error'}`}>{nameMsg}</p>
          )}
        </div>

        {/* Change ID */}
        <div className="settings-section">
          <div className="settings-section-title">Публичный ID</div>
          <div className="settings-hint">По этому ID вас находят друзья</div>
          {idRateLimitHours > 0 && (
            <p className="settings-msg error">ID можно менять раз в сутки. Следующая смена через {idRateLimitHours} ч.</p>
          )}
          <div className="settings-row">
            <input
              className="settings-input"
              value={publicId}
              onChange={(e) => { setPublicId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setIdMsg(''); }}
              placeholder="your_id"
              maxLength={24}
              disabled={idRateLimitHours > 0}
            />
            <button
              className="btn btn-accent settings-save-btn"
              onClick={saveId}
              disabled={loading || !publicId.trim() || publicId.trim() === me.public_id || idRateLimitHours > 0}
            >
              Сохранить
            </button>
          </div>
          {idMsg && (
            <p className={`settings-msg ${idMsg.startsWith('✓') ? 'success' : 'error'}`}>{idMsg}</p>
          )}
        </div>

        <div className="settings-divider" />

        {/* Notifications */}
        <div className="settings-section">
          <div className="settings-section-title">Уведомления</div>
          {pushPermission === 'granted' && (
            <p className="settings-msg success">✓ Уведомления включены</p>
          )}
          {pushPermission === 'denied' && (
            <p className="settings-msg error">Уведомления заблокированы. Разрешите в настройках браузера.</p>
          )}
          {pushPermission !== 'unsupported' && (
            <button className="btn btn-accent settings-save-btn" onClick={enablePushFromSettings}>
              Включить уведомления
            </button>
          )}
        </div>

        <div className="settings-divider" />

        {/* Logout */}
        <button className="settings-action-btn logout" onClick={logout}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Выйти из аккаунта
        </button>

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
