import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, disconnectSocket, getSocket } from '../socket.js';
import { subscribeToPush, setupPushKeepAlive } from '../pushNotifications.js';
import AvatarCropModal from '../AvatarCropModal.jsx';

function timeSince(dateStr) {
  if (!dateStr) return '';
  // Ensure UTC interpretation — append Z if missing
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} дн назад`;
}

function Avatar({ user, size = 44, className = '' }) {
  if (user?.avatar) {
    return <img className={`avatar ${className}`} src={user.avatar} alt="" style={{ width: size, height: size }} />;
  }
  const letter = (user?.username || '?')[0].toUpperCase();
  return <div className={`avatar ${className}`} style={{ width: size, height: size }}>{letter}</div>;
}

export default function Home() {
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');
  const fileInputRef = useRef(null);
  const layoutRef = useRef(null);

  const [tab, setTab] = useState('chats');
  const [friends, setFriends] = useState([]);
  const [channels, setChannels] = useState([]);
  const [requests, setRequests] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [addPublicId, setAddPublicId] = useState('');
  const [addMsg, setAddMsg] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addPhoneMsg, setAddPhoneMsg] = useState('');
  const [online, setOnline] = useState({});
  const [myAvatar, setMyAvatar] = useState(me.avatar || null);
  const [showProfile, setShowProfile] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(() => localStorage.getItem('newUser') === '1');
  const [isAdmin, setIsAdmin] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [chName, setChName] = useState('');
  const [chDesc, setChDesc] = useState('');
  const [chAvatarFile, setChAvatarFile] = useState(null);
  const [chCreating, setChCreating] = useState(false);

  // Avatar crop modal
  const [avatarCropFile, setAvatarCropFile] = useState(null);

  // Handle mobile viewport resize (keyboard etc.)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      if (layoutRef.current) layoutRef.current.style.height = `${vv.height}px`;
    };
    vv.addEventListener('resize', handleResize);
    handleResize();
    return () => vv.removeEventListener('resize', handleResize);
  }, []);

  const fetchFriends = useCallback(async () => {
    const { data } = await api.get('/users/friends');
    setFriends(data);
  }, []);

  const fetchChannels = useCallback(async () => {
    try {
      const { data } = await api.get('/channels/my');
      setChannels(data);
    } catch { /* */ }
  }, []);

  // Request push permission and subscribe + keep-alive on visibility change
  useEffect(() => {
    subscribeToPush();
    setupPushKeepAlive();
  }, []);

  // Check admin status (silent, hidden from non-admins)
  // Also refresh me data (premium_until, hide_last_seen)
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/admin/check');
        if (data.isAdmin) setIsAdmin(true);
      } catch { /* not admin */ }
      try {
        const { data } = await api.get('/users/me');
        localStorage.setItem('me', JSON.stringify(data));
      } catch { /* */ }
    })();
  }, []);

  const fetchRequests = useCallback(async () => {
    const { data } = await api.get('/users/requests');
    setRequests(data);
  }, []);

  useEffect(() => {
    fetchFriends();
    fetchRequests();
    fetchChannels();

    const socket = connectSocket();
    if (!socket) return;

    socket.on('presence', ({ userId, online: isOnline, lastSeen }) => {
      setOnline((prev) => ({ ...prev, [userId]: isOnline }));
      if (!isOnline && lastSeen) {
        setFriends((prev) =>
          prev.map((f) => (f.id === userId ? { ...f, last_seen: lastSeen } : f))
        );
      }
    });

    // Real-time: incoming friend request
    socket.on('friend_request_received', (data) => {
      setRequests((prev) => {
        if (prev.find((r) => r.request_id === data.request_id)) return prev;
        return [...prev, data];
      });
    });

    // Real-time: friend request accepted — new friend appears
    socket.on('friend_request_accepted', ({ friend }) => {
      setFriends((prev) => {
        if (prev.find((f) => f.id === friend.id)) return prev;
        return [...prev, friend];
      });
      // Remove from requests if it was there
      setRequests((prev) => prev.filter((r) => r.id !== friend.id));
    });

    // Real-time: friend request rejected
    socket.on('friend_request_rejected', () => {
      // Could show a notification; for now just silently handled
    });

    // Real-time: new message — re-fetch to update unread counts
    socket.on('new_message', () => {
      fetchFriends();
    });

    // Real-time: messages read by us or the other side — update unread counts
    socket.on('messages_read', () => {
      fetchFriends();
    });

    // Real-time: we were removed as a friend
    socket.on('friend_removed', ({ by }) => {
      setFriends((prev) => prev.filter((f) => f.id !== by));
    });

    // Real-time: new channel message — re-fetch channels for ordering
    socket.on('channel_message', () => {
      fetchChannels();
    });

    // Re-fetch when tab becomes visible (e.g., returning from chat)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') { fetchFriends(); fetchChannels(); }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      socket.off('presence');
      socket.off('friend_request_received');
      socket.off('friend_request_accepted');
      socket.off('friend_request_rejected');
      socket.off('new_message');
      socket.off('messages_read');
      socket.off('friend_removed');
      socket.off('channel_message');
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchFriends, fetchRequests, fetchChannels]);

  // Search users by public_id
  useEffect(() => {
    if (!searchQ.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await api.get(`/users/search?q=${encodeURIComponent(searchQ)}`);
      setSearchResults(data);
    }, 400);
    return () => clearTimeout(t);
  }, [searchQ]);

  const sendRequest = async (public_id) => {
    setAddMsg('');
    try {
      await api.post('/users/friend-request', { public_id });
      setAddMsg('Заявка отправлена!');
      setAddPublicId('');
    } catch (err) {
      setAddMsg(err.response?.data?.error || 'Ошибка');
    }
  };

  const sendRequestByPhone = async () => {
    setAddPhoneMsg('');
    const digits = addPhone.replace(/\D/g, '');
    if (digits.length !== 10) { setAddPhoneMsg('Введите 10 цифр'); return; }
    try {
      await api.post('/users/friend-request', { phone: '+7' + digits });
      setAddPhoneMsg('Заявка отправлена!');
      setAddPhone('');
    } catch (err) {
      setAddPhoneMsg(err.response?.data?.error || 'Ошибка');
    }
  };

  const acceptRequest = async (request_id) => {
    await api.post('/users/accept-request', { request_id });
    fetchRequests();
    fetchFriends();
  };

  const rejectRequest = async (request_id) => {
    await api.post('/users/reject-request', { request_id });
    fetchRequests();
  };

  const uploadAvatar = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    // GIF: upload directly (no crop; server will gate non-premium)
    if (file.type === 'image/gif') {
      uploadGifAvatar(file);
      return;
    }
    setAvatarCropFile(file);
  };

  const uploadGifAvatar = async (file) => {
    const formData = new FormData();
    formData.append('avatar', file, file.name);
    try {
      const { data } = await api.post('/users/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMyAvatar(data.avatar);
      const meData = JSON.parse(localStorage.getItem('me') || '{}');
      meData.avatar = data.avatar;
      localStorage.setItem('me', JSON.stringify(meData));
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка загрузки');
    }
  };

  const uploadCroppedAvatar = async (blob) => {
    setAvatarCropFile(null);
    const formData = new FormData();
    formData.append('avatar', blob, 'avatar.jpg');
    try {
      const { data } = await api.post('/users/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setMyAvatar(data.avatar);
      const meData = JSON.parse(localStorage.getItem('me') || '{}');
      meData.avatar = data.avatar;
      localStorage.setItem('me', JSON.stringify(meData));
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка загрузки');
    }
  };

  const logout = () => {
    disconnectSocket();
    localStorage.clear();
    navigate('/login');
  };

  const enablePush = async () => {
    setShowPushPrompt(false);
    localStorage.removeItem('newUser');
    await subscribeToPush();
  };

  const dismissPush = () => {
    setShowPushPrompt(false);
    localStorage.removeItem('newUser');
  };

  const createChannel = async () => {
    if (!chName.trim() || chCreating) return;
    setChCreating(true);
    try {
      const { data } = await api.post('/channels', { name: chName.trim(), description: chDesc.trim() });
      // Upload avatar if selected
      if (chAvatarFile) {
        const fd = new FormData();
        fd.append('avatar', chAvatarFile);
        await api.post(`/channels/${data.id}/avatar`, fd);
      }
      setChName(''); setChDesc(''); setChAvatarFile(null);
      setShowCreateChannel(false);
      setShowAddPanel(false);
      fetchChannels();
      navigate(`/channel/${data.id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка создания канала');
    } finally {
      setChCreating(false);
    }
  };

  return (
    <div className="app-layout" ref={layoutRef}>
      {/* Push notifications prompt for new users */}
      {showPushPrompt && (
        <div className="modal-overlay" onClick={dismissPush}>
          <div className="modal-card push-prompt-card" onClick={(e) => e.stopPropagation()}>
            <div className="push-prompt-icon">🔔</div>
            <div className="modal-name">Регистрация успешна!</div>
            <div className="push-prompt-text">Подключите уведомления, чтобы видеть новые сообщения, даже когда вы не в сети.</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={dismissPush}>Позже</button>
              <button className="btn btn-accent" onClick={enablePush}>Включить</button>
            </div>
          </div>
        </div>
      )}
      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-left" onClick={() => setShowProfile(!showProfile)}>
          {myAvatar ? (
            <img className="avatar avatar-topbar" src={myAvatar} alt="" />
          ) : (
            <div className="avatar avatar-topbar">{(me.username || '?')[0].toUpperCase()}</div>
          )}
          <span className="topbar-title">МесМес</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {isAdmin && (
            <button className="topbar-btn" onClick={() => navigate('/admin')} title="Админ-панель">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            </button>
          )}
          <button className="topbar-btn" onClick={() => setShowRequests(true)} title="Заявки" style={{ position: 'relative' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            {requests.length > 0 && <span className="topbar-badge">{requests.length}</span>}
          </button>
          <button className="topbar-btn" onClick={() => navigate('/settings')} title="Настройки">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </div>

      {/* Profile dropdown */}
      {showProfile && (
        <div className="profile-panel">
          <div className="profile-avatar-wrap" onClick={() => { setShowProfile(false); navigate(`/${me.public_id}`); }} style={{ cursor: 'pointer' }}>
            {myAvatar ? (
              <img className="avatar avatar-lg" src={myAvatar} alt="" />
            ) : (
              <div className="avatar avatar-lg">{(me.username || '?')[0].toUpperCase()}</div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={uploadAvatar} />
          <div className="profile-name">{me.username}</div>
          <div className="profile-id">@{me.public_id}</div>
          <div className="profile-hint">Нажмите на аватар, чтобы открыть профиль</div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'chats' ? 'active' : ''}`} onClick={() => setTab('chats')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Чаты
        </button>
        <button className={`tab ${tab === 'channels' ? 'active' : ''}`} onClick={() => setTab('channels')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Каналы
        </button>
      </div>

      <div className="content">

        {/* ── Chats ── */}
        {tab === 'chats' && (
          <>
            {friends.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💬</div>
                <div className="empty-title">Пока нет чатов</div>
                <div className="empty-text">Нажмите + чтобы найти друзей или создать канал</div>
              </div>
            ) : (
              friends.map((f) => (
                <div key={`f-${f.id}`} className="friend-item" onClick={() => navigate(`/chat/${f.id}`)}>
                  <div className="avatar-wrap" onClick={(e) => { e.stopPropagation(); navigate(`/${f.public_id}`); }}>
                    <Avatar user={f} size={46} />
                    <div className={`status-dot ${online[f.id] ? 'online' : ''}`} />
                  </div>
                  <div className="friend-info">
                    <div className="friend-name">
                      {f.username}
                      {f.premium_until && new Date(f.premium_until) > new Date() && <span className="premium-badge" title="mes-premium">✓</span>}
                    </div>
                    <div className="friend-status friend-last-msg">
                      {f.last_message
                        ? (f.last_message_sender_id === me.id ? 'Вы: ' : '') + f.last_message.slice(0, 40)
                        : f.last_message_file
                          ? (f.last_message_sender_id === me.id ? 'Вы: ' : '') + '🖼️ Фото'
                          : online[f.id] ? 'онлайн'
                            : (f.hide_last_seen && f.premium_until && new Date(f.premium_until) > new Date()) ? ''
                              : timeSince(f.last_seen)
                      }
                    </div>
                  </div>
                  {f.unread_count > 0 ? (
                    <span className="unread-badge">{f.unread_count > 99 ? '99+' : f.unread_count}</span>
                  ) : (
                    <svg className="friend-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                  )}
                </div>
              ))
            )}

            {/* FAB */}
            <button className="fab" onClick={() => setShowAddPanel(true)} title="Добавить">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </>
        )}

        {/* ── Channels ── */}
        {tab === 'channels' && (
          <>
            {channels.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📢</div>
                <div className="empty-title">Нет каналов</div>
                <div className="empty-text">Нажмите + чтобы создать канал или присоединитесь по ссылке</div>
              </div>
            ) : (
              channels.map((ch) => (
                <div key={`ch-${ch.id}`} className="friend-item" onClick={() => navigate(`/channel/${ch.id}`)}>
                  <div className="avatar-wrap">
                    {ch.avatar ? (
                      <img className="avatar" src={ch.avatar} alt="" style={{ width: 46, height: 46 }} />
                    ) : (
                      <div className="avatar" style={{ width: 46, height: 46 }}>📢</div>
                    )}
                  </div>
                  <div className="friend-info">
                    <div className="friend-name">{ch.name}</div>
                    <div className="friend-status friend-last-msg">
                      {ch.last_message
                        ? ch.last_message.slice(0, 40)
                        : ch.last_message_file
                          ? '🖼️ Фото'
                          : 'канал'
                      }
                    </div>
                  </div>
                  <svg className="friend-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              ))
            )}

            {/* FAB */}
            <button className="fab" onClick={() => setShowAddPanel(true)} title="Добавить">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </>
        )}

      </div>

      {/* ── Requests overlay ── */}
      {showRequests && (
        <div className="modal-overlay" onClick={() => setShowRequests(false)}>
          <div className="add-panel-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="add-panel-header">
              <h2>Заявки в друзья</h2>
              <button className="modal-close" onClick={() => setShowRequests(false)}>✕</button>
            </div>
            {requests.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🤝</div>
                <div className="empty-title">Нет заявок</div>
                <div className="empty-text">Входящие запросы в друзья появятся здесь</div>
              </div>
            ) : (
              requests.map((r) => (
                <div key={r.request_id} className="friend-item">
                  <Avatar user={r} size={40} className="avatar-sm" />
                  <div className="friend-info">
                    <div className="friend-name">{r.username}</div>
                    <div className="friend-id">@{r.public_id}</div>
                  </div>
                  <div className="request-actions">
                    <button className="btn-icon accept" onClick={() => acceptRequest(r.request_id)} title="Принять">✓</button>
                    <button className="btn-icon reject" onClick={() => rejectRequest(r.request_id)} title="Отклонить">✗</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Add panel overlay (search + create channel) ── */}
      {showAddPanel && (
        <div className="modal-overlay" onClick={() => setShowAddPanel(false)}>
          <div className="add-panel-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="add-panel-header">
              <h2>Добавить</h2>
              <button className="modal-close" onClick={() => setShowAddPanel(false)}>✕</button>
            </div>

            <div className="my-id-box">
              <div className="my-id-label">Ваш ID</div>
              <div className="my-id-value">{me.public_id}</div>
              <div className="my-id-hint">Поделитесь с друзьями чтобы они могли вас найти</div>
            </div>


            {searchResults.map((u) => (
              <div key={u.id} className="friend-item">
                <Avatar user={u} size={40} className="avatar-sm" />
                <div className="friend-info">
                  <div className="friend-name">
                    {u.username}
                    {u.premium_until && new Date(u.premium_until) > new Date() && <span className="premium-badge" title="mes-premium">✓</span>}
                  </div>
                  <div className="friend-id">@{u.public_id}</div>
                </div>
                <button className="btn btn-accent btn-sm" onClick={() => sendRequest(u.public_id)}>
                  Добавить
                </button>
              </div>
            ))}

            {searchQ && searchResults.length === 0 && (
              <div className="empty-state small"><div className="empty-text">Никого не найдено</div></div>
            )}

            <div className="divider" />

            <div className="add-direct">
              <div className="add-direct-label">Добавить по точному ID</div>
              <div className="search-box">
                <input
                  className="search-input"
                  placeholder="exact_user_id"
                  value={addPublicId}
                  onChange={(e) => setAddPublicId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addPublicId.trim() && sendRequest(addPublicId)}
                />
                <button className="btn btn-accent btn-sm" onClick={() => sendRequest(addPublicId)} disabled={!addPublicId.trim()}>
                  →
                </button>
              </div>
              {addMsg && <p className={`add-msg ${addMsg.includes('отправлена') ? 'success' : 'error'}`}>{addMsg}</p>}
            </div>

            <div className="divider" />

            <div className="add-direct">
              <div className="add-direct-label">Добавить по номеру телефона</div>
              <div className="search-box">
                <div className="phone-input-group">
                  <span className="phone-prefix">+7</span>
                  <input
                    className="search-input"
                    placeholder="0000000000"
                    value={addPhone}
                    maxLength={10}
                    inputMode="numeric"
                    onChange={(e) => setAddPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    onKeyDown={(e) => e.key === 'Enter' && sendRequestByPhone()}
                  />
                </div>
                <button className="btn btn-accent btn-sm" onClick={sendRequestByPhone} disabled={addPhone.replace(/\D/g, '').length !== 10}>
                  →
                </button>
              </div>
              {addPhoneMsg && <p className={`add-msg ${addPhoneMsg.includes('отправлена') ? 'success' : 'error'}`}>{addPhoneMsg}</p>}
            </div>

            <div className="divider" />

            <button className="btn btn-accent" style={{ width: '100%' }} onClick={() => setShowCreateChannel(true)}>
              📢 Создать канал
            </button>
          </div>
        </div>
      )}

      {/* ── Create channel modal ── */}
      {showCreateChannel && (
        <div className="modal-overlay" onClick={() => setShowCreateChannel(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <button className="modal-close" onClick={() => setShowCreateChannel(false)}>✕</button>
            <div className="modal-name" style={{ fontSize: '1.1rem', marginBottom: 12 }}>Создать канал</div>

            <div className="ch-avatar-pick" onClick={() => document.getElementById('ch-avatar-input').click()}>
              {chAvatarFile ? (
                <img src={URL.createObjectURL(chAvatarFile)} alt="" className="ch-avatar-preview" />
              ) : (
                <div className="ch-avatar-placeholder">📷</div>
              )}
              <input id="ch-avatar-input" type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files[0]) setChAvatarFile(e.target.files[0]); }} />
            </div>

            <div className="form-group">
              <label>Название</label>
              <input placeholder="Мой канал" value={chName} onChange={(e) => setChName(e.target.value)} maxLength={50} />
            </div>
            <div className="form-group">
              <label>Описание</label>
              <textarea placeholder="О чём этот канал..." value={chDesc} onChange={(e) => setChDesc(e.target.value)} rows={3} style={{ resize: 'vertical' }} />
            </div>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowCreateChannel(false)}>Отмена</button>
              <button className="btn btn-accent" onClick={createChannel} disabled={!chName.trim() || chCreating}>
                {chCreating ? 'Создание...' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avatar crop modal */}
      {avatarCropFile && (
        <AvatarCropModal
          file={avatarCropFile}
          onConfirm={uploadCroppedAvatar}
          onCancel={() => setAvatarCropFile(null)}
        />
      )}
    </div>
  );
}
