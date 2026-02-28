import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';

function formatDate(d) {
  if (!d) return '—';
  const s = d.endsWith('Z') || d.includes('+') ? d : d + 'Z';
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminPanel() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [bans, setBans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('messages'); // messages | bans | premium
  const [banForm, setBanForm] = useState({ reason: '', duration: '' });
  const [banMsg, setBanMsg] = useState('');
  const [search, setSearch] = useState('');
  const [premiumMonths, setPremiumMonths] = useState('1');
  const [premiumMsg, setPremiumMsg] = useState('');

  // Check admin access
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/admin/check');
        if (!data.isAdmin) navigate('/');
      } catch {
        navigate('/');
      }
    })();
  }, [navigate]);

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/users');
      setUsers(data);
    } catch { /* */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const selectUser = async (user) => {
    setSelectedUser(user);
    setTab('messages');
    setBanMsg('');
    try {
      const [msgRes, banRes] = await Promise.all([
        api.get(`/admin/users/${user.id}/messages`),
        api.get(`/admin/bans/${user.id}`),
      ]);
      setMessages(msgRes.data);
      setBans(banRes.data);
    } catch { /* */ }
  };

  const banUser = async () => {
    if (!selectedUser) return;
    setBanMsg('');
    try {
      await api.post('/admin/ban', {
        user_id: selectedUser.id,
        reason: banForm.reason || 'Нарушение правил',
        duration_hours: banForm.duration ? parseInt(banForm.duration) : null,
      });
      setBanMsg('Пользователь забанен');
      setBanForm({ reason: '', duration: '' });
      fetchUsers();
      const { data } = await api.get(`/admin/bans/${selectedUser.id}`);
      setBans(data);
    } catch (err) {
      setBanMsg(err.response?.data?.error || 'Ошибка');
    }
  };

  const unbanUser = async () => {
    if (!selectedUser) return;
    setBanMsg('');
    try {
      await api.post('/admin/unban', { user_id: selectedUser.id });
      setBanMsg('Бан снят');
      fetchUsers();
      const { data } = await api.get(`/admin/bans/${selectedUser.id}`);
      setBans(data);
    } catch (err) {
      setBanMsg(err.response?.data?.error || 'Ошибка');
    }
  };

  const grantPremium = async () => {
    if (!selectedUser) return;
    setPremiumMsg('');
    try {
      const { data } = await api.post('/admin/premium/grant', { user_id: selectedUser.id, months: parseInt(premiumMonths) || 1 });
      setPremiumMsg(`Премиум выдан до ${formatDate(data.premium_until)}`);
      fetchUsers();
    } catch (err) {
      setPremiumMsg(err.response?.data?.error || 'Ошибка');
    }
  };

  const revokePremium = async () => {
    if (!selectedUser) return;
    setPremiumMsg('');
    try {
      await api.post('/admin/premium/revoke', { user_id: selectedUser.id });
      setPremiumMsg('Премиум снят');
      fetchUsers();
    } catch (err) {
      setPremiumMsg(err.response?.data?.error || 'Ошибка');
    }
  };

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.username.toLowerCase().includes(q) || u.public_id.toLowerCase().includes(q) || String(u.id) === q;
  });

  const isUserBanned = selectedUser && users.find(u => u.id === selectedUser.id)?.active_ban_id;
  const userPremiumUntil = selectedUser && users.find(u => u.id === selectedUser.id)?.premium_until;
  const isUserPremium = userPremiumUntil && new Date(userPremiumUntil) > new Date();

  if (loading) return <div className="admin-page"><div className="admin-loading">Загрузка...</div></div>;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <button className="admin-back" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <h1>Админ-панель</h1>
      </div>

      {!selectedUser ? (
        /* ── User list ── */
        <div className="admin-user-list">
          <input
            className="admin-search"
            placeholder="Поиск по имени, ID или номеру..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="admin-user-count">Пользователей: {users.length}</div>
          {filteredUsers.map((u) => (
            <div key={u.id} className={`admin-user-card ${u.active_ban_id ? 'banned' : ''}`} onClick={() => selectUser(u)}>
              <div className="admin-user-avatar">
                {u.avatar
                  ? <img src={u.avatar} alt="" />
                  : <span>{(u.username || '?')[0].toUpperCase()}</span>
                }
              </div>
              <div className="admin-user-info">
                <div className="admin-user-name">
                  {u.username}
                  {u.premium_until && new Date(u.premium_until) > new Date() && <span className="premium-badge" title="mes-premium">✓</span>}
                  {u.active_ban_id && <span className="admin-ban-badge">БАН</span>}
                </div>
                <div className="admin-user-id">@{u.public_id} · ID: {u.id}</div>
                <div className="admin-user-meta">Сообщений: {u.message_count} · Рег: {formatDate(u.created_at)}</div>
              </div>
              <svg className="admin-user-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          ))}
        </div>
      ) : (
        /* ── User detail ── */
        <div className="admin-detail">
          <button className="admin-detail-back" onClick={() => setSelectedUser(null)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Назад
          </button>

          <div className="admin-detail-header">
            <div className="admin-user-avatar large">
              {selectedUser.avatar
                ? <img src={selectedUser.avatar} alt="" />
                : <span>{(selectedUser.username || '?')[0].toUpperCase()}</span>
              }
            </div>
            <div>
              <div className="admin-detail-name">{selectedUser.username}</div>
              <div className="admin-detail-id">@{selectedUser.public_id} · ID: {selectedUser.id}</div>
              {selectedUser.email && <div className="admin-detail-email">{selectedUser.email}</div>}
            </div>
          </div>

          {/* Tabs */}
          <div className="admin-tabs">
            <button className={`admin-tab ${tab === 'messages' ? 'active' : ''}`} onClick={() => setTab('messages')}>
              Сообщения ({messages.length})
            </button>
            <button className={`admin-tab ${tab === 'bans' ? 'active' : ''}`} onClick={() => setTab('bans')}>
              Баны ({bans.length})
            </button>
            <button className={`admin-tab ${tab === 'premium' ? 'active' : ''}`} onClick={() => { setTab('premium'); setPremiumMsg(''); }}>
              Премиум {isUserPremium ? '⭐' : ''}
            </button>
          </div>

          {tab === 'messages' && (
            <div className="admin-messages">
              {messages.length === 0 && <div className="admin-empty">Нет сообщений</div>}
              {messages.map((m) => (
                <div key={m.id} className={`admin-msg ${m.deleted_for_sender || m.deleted_for_receiver ? 'deleted' : ''}`}>
                  <div className="admin-msg-header">
                    <span className="admin-msg-to">→ {m.receiver_username} (@{m.receiver_public_id})</span>
                    <span className="admin-msg-time">{formatDate(m.created_at)}</span>
                  </div>
                  {m.file_url && <img src={m.file_url} className="admin-msg-img" alt="" />}
                  <div className="admin-msg-text">
                    {m.content || (m.file_url ? '🖼️ Изображение' : '(пусто)')}
                  </div>
                  <div className="admin-msg-flags">
                    {m.edited ? <span className="admin-flag">ред.</span> : null}
                    {m.deleted_for_sender ? <span className="admin-flag del">удалено отправ.</span> : null}
                    {m.deleted_for_receiver ? <span className="admin-flag del">удалено получ.</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'bans' && (
            <div className="admin-bans">
              {/* Ban form */}
              <div className="admin-ban-form">
                <h3>{isUserBanned ? '⛔ Пользователь забанен' : 'Забанить пользователя'}</h3>
                {!isUserBanned ? (
                  <>
                    <input
                      className="admin-ban-input"
                      placeholder="Причина бана"
                      value={banForm.reason}
                      onChange={(e) => setBanForm({ ...banForm, reason: e.target.value })}
                    />
                    <div className="admin-ban-duration">
                      <label>Срок (часов):</label>
                      <input
                        className="admin-ban-input small"
                        type="number"
                        placeholder="Пусто = навсегда"
                        value={banForm.duration}
                        onChange={(e) => setBanForm({ ...banForm, duration: e.target.value })}
                      />
                    </div>
                    <button className="btn btn-danger" onClick={banUser}>Забанить</button>
                  </>
                ) : (
                  <button className="btn btn-primary" onClick={unbanUser}>Снять бан</button>
                )}
                {banMsg && <div className="admin-ban-msg">{banMsg}</div>}
              </div>

              {/* Ban history */}
              <h3 style={{ marginTop: 16 }}>История банов</h3>
              {bans.length === 0 && <div className="admin-empty">Банов нет</div>}
              {bans.map((b) => (
                <div key={b.id} className={`admin-ban-card ${b.active ? 'active' : ''}`}>
                  <div className="admin-ban-reason">{b.reason}</div>
                  <div className="admin-ban-meta">
                    Выдан: {formatDate(b.banned_at)}
                    {b.expires_at ? ` · До: ${formatDate(b.expires_at)}` : ' · Навсегда'}
                    {b.banned_by_name ? ` · Кем: ${b.banned_by_name}` : ''}
                  </div>
                  <div className={`admin-ban-status ${b.active ? 'active' : ''}`}>
                    {b.active ? 'Активен' : 'Снят'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'premium' && (
            <div className="admin-premium">
              <div className="admin-ban-form">
                <h3>{isUserPremium ? '⭐ Пользователь — Premium' : 'Выдать Premium'}</h3>
                {isUserPremium && (
                  <div className="admin-premium-info">Активен до: {formatDate(userPremiumUntil)}</div>
                )}
                {!isUserPremium ? (
                  <>
                    <div className="admin-ban-duration">
                      <label>Срок (месяцев):</label>
                      <input
                        className="admin-ban-input small"
                        type="number"
                        min="1"
                        value={premiumMonths}
                        onChange={(e) => setPremiumMonths(e.target.value)}
                      />
                    </div>
                    <button className="btn btn-accent" onClick={grantPremium}>Выдать Premium</button>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div className="admin-ban-duration">
                        <label>Продлить (мес.):</label>
                        <input
                          className="admin-ban-input small"
                          type="number"
                          min="1"
                          value={premiumMonths}
                          onChange={(e) => setPremiumMonths(e.target.value)}
                        />
                      </div>
                      <button className="btn btn-accent" onClick={grantPremium} style={{ marginTop: 6 }}>Продлить</button>
                    </div>
                    <button className="btn btn-danger" onClick={revokePremium} style={{ alignSelf: 'flex-end' }}>Снять Premium</button>
                  </div>
                )}
                {premiumMsg && <div className="admin-ban-msg">{premiumMsg}</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
