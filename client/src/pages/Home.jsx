import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, disconnectSocket, getSocket } from '../socket.js';

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
  const [requests, setRequests] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [addPublicId, setAddPublicId] = useState('');
  const [addMsg, setAddMsg] = useState('');
  const [online, setOnline] = useState({});
  const [myAvatar, setMyAvatar] = useState(me.avatar || null);
  const [showProfile, setShowProfile] = useState(false);

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

  const fetchRequests = useCallback(async () => {
    const { data } = await api.get('/users/requests');
    setRequests(data);
  }, []);

  useEffect(() => {
    fetchFriends();
    fetchRequests();

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

    // Real-time: new message updates last message preview (optional refresh)
    socket.on('new_message', () => {
      // Re-fetch friends to get updated order/preview if needed
      fetchFriends();
    });

    return () => {
      socket.off('presence');
      socket.off('friend_request_received');
      socket.off('friend_request_accepted');
      socket.off('friend_request_rejected');
      socket.off('new_message');
    };
  }, [fetchFriends, fetchRequests]);

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

  const acceptRequest = async (request_id) => {
    await api.post('/users/accept-request', { request_id });
    fetchRequests();
    fetchFriends();
  };

  const rejectRequest = async (request_id) => {
    await api.post('/users/reject-request', { request_id });
    fetchRequests();
  };

  const uploadAvatar = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
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

  return (
    <div className="app-layout" ref={layoutRef}>
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
        <button className="topbar-btn" onClick={logout} title="Выйти">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>

      {/* Profile dropdown */}
      {showProfile && (
        <div className="profile-panel">
          <div className="profile-avatar-wrap" onClick={() => fileInputRef.current?.click()}>
            {myAvatar ? (
              <img className="avatar avatar-lg" src={myAvatar} alt="" />
            ) : (
              <div className="avatar avatar-lg">{(me.username || '?')[0].toUpperCase()}</div>
            )}
            <div className="profile-avatar-edit">📷</div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={uploadAvatar} />
          <div className="profile-name">{me.username}</div>
          <div className="profile-id">@{me.public_id}</div>
          <div className="profile-hint">Нажмите на аватар, чтобы изменить</div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'chats' ? 'active' : ''}`} onClick={() => setTab('chats')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Чаты
        </button>
        <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Найти
        </button>
        <button className={`tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          {requests.length > 0 && <span className="badge">{requests.length}</span>}
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
                <div className="empty-text">Найдите друзей по ID во вкладке «Найти»</div>
              </div>
            ) : (
              friends.map((f) => (
                <div key={f.id} className="friend-item" onClick={() => navigate(`/chat/${f.id}`)}>
                  <div className="avatar-wrap">
                    <Avatar user={f} size={46} />
                    <div className={`status-dot ${online[f.id] ? 'online' : ''}`} />
                  </div>
                  <div className="friend-info">
                    <div className="friend-name">{f.username}</div>
                    <div className="friend-status">
                      {online[f.id] ? 'онлайн' : timeSince(f.last_seen)}
                    </div>
                  </div>
                  <svg className="friend-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              ))
            )}
          </>
        )}

        {/* ── Search ── */}
        {tab === 'search' && (
          <>
            <div className="my-id-box">
              <div className="my-id-label">Ваш ID</div>
              <div className="my-id-value">{me.public_id}</div>
              <div className="my-id-hint">Поделитесь с друзьями чтобы они могли вас найти</div>
            </div>

            <div className="search-box">
              <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                className="search-input"
                placeholder="Введите ID пользователя..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>

            {searchResults.map((u) => (
              <div key={u.id} className="friend-item">
                <Avatar user={u} size={40} className="avatar-sm" />
                <div className="friend-info">
                  <div className="friend-name">{u.username}</div>
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
                />
                <button className="btn btn-accent btn-sm" onClick={() => sendRequest(addPublicId)} disabled={!addPublicId.trim()}>
                  →
                </button>
              </div>
              {addMsg && <p className={`add-msg ${addMsg.includes('отправлена') ? 'success' : 'error'}`}>{addMsg}</p>}
            </div>
          </>
        )}

        {/* ── Requests ── */}
        {tab === 'requests' && (
          <>
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
          </>
        )}

      </div>
    </div>
  );
}
