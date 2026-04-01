import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { disconnectSocket } from '../socket.js';

export default function Settings() {
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Premium + hide last seen
  const [hideLastSeen, setHideLastSeen] = useState(!!me.hide_last_seen);
  const [meData, setMeData] = useState(me);
  const [sessions, setSessions] = useState([]);
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [twoFASetup, setTwoFASetup] = useState(null);
  const [twoFAEnableCode, setTwoFAEnableCode] = useState('');
  const [twoFADisableCode, setTwoFADisableCode] = useState('');
  const [twoFADisablePassword, setTwoFADisablePassword] = useState('');
  const [casinoAccess, setCasinoAccess] = useState(false);
  const [blockBlastAccess, setBlockBlastAccess] = useState(false);

  // Fetch fresh me data
  useEffect(() => {
    api.get('/users/me').then(({ data }) => {
      setMeData(data);
      setHideLastSeen(!!data.hide_last_seen);
      localStorage.setItem('me', JSON.stringify(data));
    }).catch(() => {});

    api.get('/users/sessions').then(({ data }) => {
      setSessions(data);
    }).catch(() => {});

    api.get('/auth/2fa/status').then(({ data }) => {
      setTwoFAEnabled(!!data.enabled);
    }).catch(() => {});

    api.get('/casino/check-access').then(({ data }) => {
      setCasinoAccess(data.hasAccess);
    }).catch(() => {});

    api.get('/block-blast/check-access').then(({ data }) => {
      setBlockBlastAccess(data.hasAccess);
    }).catch(() => {});

  }, []);

  const terminateSession = async (id) => {
    try {
      await api.delete(`/users/sessions/${id}`);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      alert('Ошибка завершения сессии');
    }
  };

  const hasPremium = meData.premium_until && new Date(meData.premium_until) > new Date();

  const toggleHideLastSeen = async () => {
    if (!hasPremium) { alert('Скрытие статуса доступно только с mes-premium'); return; }
    const newVal = !hideLastSeen;
    try {
      await api.patch('/users/me', { hide_last_seen: newVal });
      setHideLastSeen(newVal);
      const stored = JSON.parse(localStorage.getItem('me') || '{}');
      stored.hide_last_seen = newVal ? 1 : 0;
      localStorage.setItem('me', JSON.stringify(stored));
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка');
    }
  };

  const startTwoFASetup = async () => {
    setTwoFALoading(true);
    try {
      const { data } = await api.post('/auth/2fa/setup');
      setTwoFASetup(data);
      setTwoFAEnableCode('');
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось начать настройку 2FA');
    } finally {
      setTwoFALoading(false);
    }
  };

  const enableTwoFA = async () => {
    if (twoFAEnableCode.length !== 6) return;
    setTwoFALoading(true);
    try {
      await api.post('/auth/2fa/enable', { code: twoFAEnableCode });
      setTwoFAEnabled(true);
      setTwoFASetup(null);
      setTwoFAEnableCode('');
      alert('2FA успешно подключена');
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось подключить 2FA');
    } finally {
      setTwoFALoading(false);
    }
  };

  const disableTwoFA = async () => {
    if (!twoFADisablePassword || twoFADisableCode.length !== 6) return;
    setTwoFALoading(true);
    try {
      await api.post('/auth/2fa/disable', {
        password: twoFADisablePassword,
        code: twoFADisableCode,
      });
      setTwoFAEnabled(false);
      setTwoFADisableCode('');
      setTwoFADisablePassword('');
      alert('2FA отключена');
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось отключить 2FA');
    } finally {
      setTwoFALoading(false);
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

        {/* My profile link */}
        <button className="settings-action-btn" onClick={() => navigate(`/${me.public_id}`)} style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Мой профиль
        </button>

        <div className="settings-divider" />

        {/* Premium promo */}
        <div className="settings-section">
          <div className="settings-section-title">mes-premium {hasPremium && '⭐'}</div>
          {hasPremium ? (
            <p className="settings-msg" style={{ color: 'var(--accent)', lineHeight: 1.5 }}>
              Премиум активен до {new Date(meData.premium_until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          ) : (
            <button className="settings-action-btn" onClick={() => navigate('/premium')} style={{ color: '#a259ff', borderColor: '#a259ff' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              Купить mes-premium
            </button>
          )}
        </div>

        <div className="settings-divider" />

        {/* Hide last seen (premium only) */}
        <div className="settings-section">
          <div className="settings-section-title">Приватность</div>
          <div className="settings-toggle-row" onClick={toggleHideLastSeen} style={{ cursor: 'pointer' }}>
            <div>
              <div className="settings-toggle-label">Скрыть «был(а) в сети»</div>
              <div className="settings-toggle-hint">{hasPremium ? 'Другие не увидят ваш статус, но вы видите их' : 'Только для mes-premium'}</div>
            </div>
            <div className={`settings-toggle ${hideLastSeen && hasPremium ? 'on' : ''}`}>
              <div className="settings-toggle-knob" />
            </div>
          </div>
        </div>

        <div className="settings-divider" />

        {/* Two-factor authentication */}
        <div className="settings-section">
          <div className="settings-section-title">Двухфакторная аутентификация (2FA)</div>
          <p className="settings-msg" style={{ color: 'var(--text2)', lineHeight: 1.5 }}>
            Защитите вход в аккаунт кодом из Google Authenticator, 1Password, Microsoft Authenticator и других TOTP-приложений.
          </p>

          {!twoFAEnabled ? (
            <>
              {!twoFASetup ? (
                <button className="settings-action-btn" onClick={startTwoFASetup} disabled={twoFALoading}>
                  {twoFALoading ? 'Готовим QR...' : 'Подключить 2FA'}
                </button>
              ) : (
                <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                    <img src={twoFASetup.qr_data_url} alt="QR 2FA" style={{ width: 180, height: 180, borderRadius: 8, background: '#fff', padding: 6 }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>Если QR не сканируется, введите ключ вручную:</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text)', wordBreak: 'break-all', marginBottom: 10 }}>{twoFASetup.secret}</div>
                  <input
                    type="text"
                    placeholder="Код из приложения (6 цифр)"
                    value={twoFAEnableCode}
                    onChange={(e) => setTwoFAEnableCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    style={{ width: '100%', marginBottom: 10 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-accent" onClick={enableTwoFA} disabled={twoFALoading || twoFAEnableCode.length !== 6} style={{ flex: 1 }}>
                      {twoFALoading ? 'Проверяем...' : 'Подтвердить'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => { setTwoFASetup(null); setTwoFAEnableCode(''); }}
                      disabled={twoFALoading}
                      style={{ flex: 1 }}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg2)' }}>
              <div style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: 8 }}>2FA включена</div>
              <input
                type="password"
                placeholder="Текущий пароль"
                value={twoFADisablePassword}
                onChange={(e) => setTwoFADisablePassword(e.target.value)}
                style={{ width: '100%', marginBottom: 8 }}
              />
              <input
                type="text"
                placeholder="Код из приложения (6 цифр)"
                value={twoFADisableCode}
                onChange={(e) => setTwoFADisableCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                style={{ width: '100%', marginBottom: 8 }}
              />
              <button
                className="settings-action-btn danger"
                onClick={disableTwoFA}
                disabled={twoFALoading || !twoFADisablePassword || twoFADisableCode.length !== 6}
              >
                {twoFALoading ? 'Отключаем...' : 'Отключить 2FA'}
              </button>
            </div>
          )}
        </div>

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
          href="https://mesmes.ru/join/436d38fb317e"
          className="settings-promo-btn"
          style={{ textDecoration: 'none' }}
        >
          <div className="settings-promo-title">Следи за обновлениями на оффициальном канале мессенджера!</div>
          <div className="settings-promo-sub">Здесь рассказывают какие выходят обновления и какие крутые функции в мессенджере MesMes!</div>
        </a>

        <div className="settings-divider" />

        {/* Sessions */}
        <div className="settings-divider" />
        <div className="settings-section">
          <div className="settings-section-title">Активные сессии</div>
          {sessions.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: 'var(--bg-mid)', borderRadius: '8px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '15px', fontWeight: '500' }}>{s.device_info} {s.is_current ? '(Текущая)' : ''}</span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>IP: {s.ip_address} | {new Date(s.last_active).toLocaleString()}</span>
              </div>
              {!s.is_current && (
                <button onClick={() => terminateSession(s.id)} style={{ padding: '6px 12px', background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                  Завершить
                </button>
              )}
            </div>
          ))}
          {sessions.length === 0 && <span style={{fontSize: '14px', color:'gray'}}>Нет данных о сессиях. Перезайдите в аккаунт!</span>}
        </div>
        
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
