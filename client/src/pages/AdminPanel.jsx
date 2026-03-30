import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api.js';
import CasinoWithdrawalsAdmin from '../components/CasinoWithdrawalsAdmin.jsx';

function formatDate(d) {
  if (!d) return '—';
  const s = d.endsWith('Z') || d.includes('+') ? d : d + 'Z';
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminPanel() {
  const navigate = useNavigate();
  const location = useLocation();
  const [users, setUsers] = useState([]);
  const [channels, setChannels] = useState([]);
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

  // Reports
  const [reports, setReports] = useState([]);
  const [unreadReports, setUnreadReports] = useState(0);
  const [mainTab, setMainTab] = useState('users'); // users | reports | channels | casino-withdrawals
  const [selectedReport, setSelectedReport] = useState(null);
  const [reportAction, setReportAction] = useState('banned'); // banned | forgiven
  const [adminComment, setAdminComment] = useState('');
  const [reportMsg, setReportMsg] = useState('');
  const [moderatorMsg, setModeratorMsg] = useState('');
  const [blockBlastMsg, setBlockBlastMsg] = useState('');
  const [adminAccess, setAdminAccess] = useState({ isAdmin: false, isModerator: false, canAccessAdminPanel: false });

  // Check admin access
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/admin/check');
        if (!data.canAccessAdminPanel) {
          navigate('/');
          return;
        }
        setAdminAccess(data);

        const requestedSection = new URLSearchParams(location.search).get('section');
        const allowedSections = data.isAdmin ? ['users', 'reports', 'channels', 'casino-withdrawals'] : ['reports'];

        if (requestedSection && allowedSections.includes(requestedSection)) {
          setMainTab(requestedSection);
        } else {
          setMainTab(data.isAdmin ? 'users' : 'reports');
        }
      } catch {
        navigate('/');
      }
    })();
  }, [navigate, location.search]);

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/users');
      setUsers(data);
      const unread = await api.get('/admin/reports/unread-count');
      setUnreadReports(unread.data.count || 0);
    } catch { /* */ }
    setLoading(false);
  }, []);

  const fetchReports = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/reports');
      setReports(data);
      const unreadCount = data.filter(r => r.status === 'open').length;
      setUnreadReports(unreadCount);
    } catch { /* */ }
    setLoading(false);
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/channels');
      setChannels(data);
    } catch { /* */ }
    setLoading(false);
  }, []);

  useEffect(() => { 
    if (!adminAccess.canAccessAdminPanel) return;

    if (mainTab === 'users' && adminAccess.isAdmin) fetchUsers();
    else if (mainTab === 'channels' && adminAccess.isAdmin) fetchChannels();
    else fetchReports();
  }, [fetchUsers, fetchReports, fetchChannels, mainTab, adminAccess]);

  const handleResolveReport = async () => {
    if (!adminComment) {
      setReportMsg('Введите комментарий к тикету');
      return;
    }
    try {
      await api.post(`/admin/reports/${selectedReport.id}/resolve`, {
        resolution: reportAction,
        admin_comment: adminComment
      });
      setSelectedReport(null);
      fetchReports();
    } catch (err) {
      setReportMsg(err.response?.data?.error || 'Ошибка закрытия тикета');
    }
  };

  const selectUser = async (user) => {
    setSelectedUser(user);
    setTab('messages');
    setBanMsg('');
    setModeratorMsg('');
    setBlockBlastMsg('');
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

  const toggleModerator = async () => {
    if (!selectedUser) return;
    setModeratorMsg('');

    if (selectedUser.is_admin) {
      setModeratorMsg('Администратору не нужно выдавать модерацию');
      return;
    }

    const currentUser = users.find((u) => u.id === selectedUser.id) || selectedUser;
    const isModerator = !!currentUser.is_moderator;

    try {
      if (isModerator) {
        await api.post('/admin/moderator/revoke', { user_id: selectedUser.id });
        setModeratorMsg('Права модератора сняты');
      } else {
        await api.post('/admin/moderator/grant', { user_id: selectedUser.id });
        setModeratorMsg('Права модератора выданы');
      }

      const nextValue = isModerator ? 0 : 1;
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, is_moderator: nextValue } : u)));
      setSelectedUser((prev) => (prev ? { ...prev, is_moderator: nextValue } : prev));
    } catch (err) {
      setModeratorMsg(err.response?.data?.error || 'Ошибка изменения прав');
    }
  };

  const toggleBlockBlastAccess = async () => {
    if (!selectedUser) return;
    setBlockBlastMsg('');

    const currentUser = users.find((u) => u.id === selectedUser.id) || selectedUser;
    const hasAccess = !!currentUser.is_admin || !!currentUser.can_play_block_blast;

    if (currentUser.is_admin && hasAccess) {
      setBlockBlastMsg('У администратора доступ к игре всегда включен');
      return;
    }

    try {
      if (hasAccess) {
        await api.post('/admin/block-blast/revoke', { user_id: selectedUser.id });
        setBlockBlastMsg('Доступ к Block Blast отозван');
      } else {
        await api.post('/admin/block-blast/grant', { user_id: selectedUser.id });
        setBlockBlastMsg('Доступ к Block Blast выдан');
      }

      const nextValue = hasAccess ? 0 : 1;
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, can_play_block_blast: nextValue } : u)));
      setSelectedUser((prev) => (prev ? { ...prev, can_play_block_blast: nextValue } : prev));
    } catch (err) {
      setBlockBlastMsg(err.response?.data?.error || 'Ошибка изменения доступа к игре');
    }
  };

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.username.toLowerCase().includes(q) || u.public_id.toLowerCase().includes(q) || String(u.id) === q;
  });

  const isUserBanned = selectedUser && users.find(u => u.id === selectedUser.id)?.active_ban_id;
  const isUserModerator = selectedUser && users.find(u => u.id === selectedUser.id)?.is_moderator;
  const canUserPlayBlockBlast = selectedUser && (
    users.find(u => u.id === selectedUser.id)?.is_admin ||
    users.find(u => u.id === selectedUser.id)?.can_play_block_blast
  );
  const userPremiumUntil = selectedUser && users.find(u => u.id === selectedUser.id)?.premium_until;
  const isUserPremium = userPremiumUntil && new Date(userPremiumUntil) > new Date();

  if (loading) return <div className="admin-page"><div className="admin-loading">Загрузка...</div></div>;

  return (
    <div className="admin-page">
      <div className="admin-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="admin-back" onClick={() => navigate('/')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h1 style={{ margin: 0 }}>Админ-панель</h1>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: '15px' }}>
        {adminAccess.isAdmin && (
          <>
            <div
              onClick={() => { setMainTab('users'); setSelectedUser(null); setSelectedReport(null); }}
              style={{ flex: 1, padding: '15px', textAlign: 'center', cursor: 'pointer', fontWeight: 'bold', borderBottom: mainTab === 'users' ? '2px solid #0088cc' : 'none', color: mainTab === 'users' ? '#0088cc' : '#aaa' }}
            >Пользователи</div>
          </>
        )}
        <div
          onClick={() => { setMainTab('reports'); setSelectedUser(null); setSelectedReport(null); }}
          style={{ flex: 1, padding: '15px', textAlign: 'center', cursor: 'pointer', fontWeight: 'bold', borderBottom: mainTab === 'reports' ? '2px solid #0088cc' : 'none', color: mainTab === 'reports' ? '#0088cc' : '#aaa', position: 'relative' }}
        >
          Репорты
          {unreadReports > 0 && (
            <span style={{ background: 'red', color: 'white', padding: '2px 6px', borderRadius: '10px', fontSize: '12px', marginLeft: '8px' }}>{unreadReports}</span>
          )}
        </div>
        {adminAccess.isAdmin && (
          <div
            onClick={() => { setMainTab('channels'); setSelectedUser(null); setSelectedReport(null); }}
            style={{ flex: 1, padding: '15px', textAlign: 'center', cursor: 'pointer', fontWeight: 'bold', borderBottom: mainTab === 'channels' ? '2px solid #0088cc' : 'none', color: mainTab === 'channels' ? '#0088cc' : '#aaa' }}
          >Каналы</div>
        )}
        {adminAccess.isAdmin && (
          <div
            onClick={() => { setMainTab('casino-withdrawals'); setSelectedUser(null); setSelectedReport(null); }}
            style={{ flex: 1, padding: '15px', textAlign: 'center', cursor: 'pointer', fontWeight: 'bold', borderBottom: mainTab === 'casino-withdrawals' ? '2px solid #0088cc' : 'none', color: mainTab === 'casino-withdrawals' ? '#0088cc' : '#aaa' }}
          >💸 Казино</div>
        )}
      </div>

      {mainTab === 'users' && !selectedUser && (
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
      )}
      {mainTab === 'users' && selectedUser && (
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
              {selectedUser.is_admin ? <div className="admin-detail-email" style={{ color: '#4CAF50' }}>Администратор</div> : null}
              {selectedUser.is_moderator ? <div className="admin-detail-email" style={{ color: '#0088cc' }}>Модератор</div> : null}
            </div>
          </div>

          <div className="admin-ban-form" style={{ marginBottom: 12 }}>
            <h3>Права модерации</h3>
            <button className={`btn ${isUserModerator ? 'btn-danger' : 'btn-primary'}`} onClick={toggleModerator}>
              {isUserModerator ? 'Снять права модератора' : 'Выдать права модератора'}
            </button>
            {moderatorMsg && <div className="admin-ban-msg">{moderatorMsg}</div>}
          </div>

          <div className="admin-ban-form" style={{ marginBottom: 12 }}>
            <h3>Игра Block Blast</h3>
            <button className={`btn ${canUserPlayBlockBlast ? 'btn-danger' : 'btn-primary'}`} onClick={toggleBlockBlastAccess}>
              {canUserPlayBlockBlast ? 'Отозвать доступ к игре' : 'Выдать доступ к игре'}
            </button>
            {blockBlastMsg && <div className="admin-ban-msg">{blockBlastMsg}</div>}
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

      {mainTab === 'reports' && !selectedReport && (
        <div className="admin-user-list">
          {reports.length === 0 ? <div style={{ padding: '20px', textAlign: 'center' }}>Нет репортов</div> : null}
          {reports.map(r => (
            <div 
              key={r.id} 
              className={`admin-user-card ${r.status !== 'open' ? 'inactive' : ''}`} 
              onClick={() => { setSelectedReport(r); setAdminComment(''); setReportAction('banned'); setReportMsg(''); }}
              style={{ opacity: r.status === 'open' ? 1 : 0.6 }}
            >
              <div className="admin-uc-info" style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <strong>Жалоба на: {r.reported_username}</strong>
                  <span style={{ fontSize: '12px', color: '#999' }}>{formatDate(r.created_at)}</span>
                </div>
                <div style={{ fontSize: '14px', color: '#ccc', marginBottom: '5px' }}>От: {r.reporter_username}</div>
                <div style={{ fontSize: '14px', color: '#f44336' }}>Причина: {r.reason}</div>
                {r.status !== 'open' && <div style={{ fontSize: '12px', color: '#4CAF50', marginTop: '5px' }}>Статус: Закрыто</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {mainTab === 'reports' && selectedReport && (
        <div className="admin-user-details" style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '12px', margin: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>Тикет #{selectedReport.id}</h2>
            <button className="admin-back" onClick={() => setSelectedReport(null)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>Назад к списку</button>
          </div>
          
          <div style={{ background: '#2d2d2d', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
            <div style={{ marginBottom: '10px' }}><strong>Кем отправлен:</strong> {selectedReport.reporter_username} (@{selectedReport.reporter_public_id})</div>
            <div style={{ marginBottom: '10px' }}><strong>На кого отправлен:</strong> {selectedReport.reported_username} (@{selectedReport.reported_public_id})</div>
            <div style={{ marginBottom: '10px', color: '#f44336' }}><strong>Причина:</strong> {selectedReport.reason}</div>
            <div style={{ background: '#111', padding: '10px', borderRadius: '6px', fontSize: '14px', fontStyle: 'italic', minHeight: '60px' }}>
              {selectedReport.comment || 'Нет комментария'}
            </div>
          </div>

          <div style={{ background: '#2d2d2d', padding: '15px', borderRadius: '8px' }}>
            <h3 style={{ marginTop: 0, marginBottom: '15px' }}>Решение</h3>
            
            {selectedReport.status === 'open' ? (
              <>
                <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                  <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <input type="radio" value="banned" checked={reportAction === 'banned'} onChange={(e) => setReportAction(e.target.value)} />
                    <span style={{ color: '#f44336' }}>Забанить</span>
                  </label>
                  <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <input type="radio" value="forgiven" checked={reportAction === 'forgiven'} onChange={(e) => setReportAction(e.target.value)} />
                    <span style={{ color: '#4CAF50' }}>Помиловать</span>
                  </label>
                </div>

                <div className="admin-field">
                  <label>Комментарий / Причина</label>
                  <input
                    value={adminComment}
                    onChange={(e) => setAdminComment(e.target.value)}
                    placeholder={reportAction === 'banned' ? 'Причина бана...' : 'Оставьте комментарий...'}
                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#111', color: '#fff' }}
                  />
                </div>

                {reportMsg && <div style={{ color: '#f44336', marginTop: '10px', marginBottom: '10px' }}>{reportMsg}</div>}

                <button 
                  className="btn" 
                  onClick={handleResolveReport}
                  style={{ width: '100%', marginTop: '10px', background: reportAction === 'banned' ? '#d32f2f' : '#2e7d32', color: 'white', padding: '12px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  Закрыть тикет
                </button>
              </>
            ) : (
              <div>
                <p>Тикет закрыт.</p>
                <p><strong>Вердикт:</strong> <span style={{ color: selectedReport.resolution === 'banned' ? '#f44336' : '#4CAF50' }}>{selectedReport.resolution === 'banned' ? 'Забанен' : 'Помилован'}</span></p>
                <div style={{ background: '#111', padding: '10px', borderRadius: '6px', fontSize: '14px' }}>
                  {selectedReport.admin_comment}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {mainTab === 'channels' && (
        <div className="admin-user-list">
          <div className="admin-user-count">Каналов: {channels.length}</div>
          {channels.length === 0 ? <div style={{ padding: '20px', textAlign: 'center' }}>Каналов нет</div> : null}
          {channels.map((ch) => (
            <div key={ch.id} className="admin-user-card" onClick={() => navigate(`/channel/${ch.id}`)} style={{ cursor: 'pointer' }}>
              <div className="admin-user-avatar">
                {ch.avatar
                  ? <img src={ch.avatar} alt="" />
                  : <span>📢</span>
                }
              </div>
              <div className="admin-user-info">
                <div className="admin-user-name">{ch.name}</div>
                <div className="admin-user-id">ID: {ch.id} · Код: {ch.invite_code}</div>
                <div className="admin-user-meta">Владелец: {ch.owner_username || '—'} (@{ch.owner_public_id || '—'})</div>
                <div className="admin-user-meta">Участников: {ch.member_count} · Сообщений: {ch.message_count}</div>
                <div className="admin-user-meta">Создан: {formatDate(ch.created_at)}</div>
              </div>
              <svg className="admin-user-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </div>
          ))}
        </div>
      )}

      {mainTab === 'casino-withdrawals' && (
        <CasinoWithdrawalsAdmin />
      )}
    </div>
  );
}
