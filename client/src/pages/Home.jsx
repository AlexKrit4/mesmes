import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, disconnectSocket, getSocket } from '../socket.js';

function timeSince(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} дн назад`;
}

export default function Home() {
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');

  const [tab, setTab] = useState('chats'); // 'chats' | 'search' | 'requests'
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [addPublicId, setAddPublicId] = useState('');
  const [addMsg, setAddMsg] = useState('');
  const [online, setOnline] = useState({});

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

    socket.on('presence', ({ userId, online: isOnline }) => {
      setOnline((prev) => ({ ...prev, [userId]: isOnline }));
    });

    return () => {
      socket.off('presence');
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
      setAddMsg('✅ Заявка отправлена!');
      setAddPublicId('');
    } catch (err) {
      setAddMsg('❌ ' + (err.response?.data?.error || 'Ошибка'));
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

  const logout = () => {
    disconnectSocket();
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="app-layout">
      {/* Top bar */}
      <div className="topbar">
        <span className="topbar-title">МесМес 💬</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            ID: <b style={{ color: 'var(--accent)' }}>{me.public_id}</b>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Выйти</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab === 'chats' ? 'active' : ''}`} onClick={() => setTab('chats')}>
          Чаты
        </button>
        <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
          Найти
        </button>
        <button className={`tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>
          Заявки {requests.length > 0 && <span className="badge">{requests.length}</span>}
        </button>
      </div>

      <div className="content">

        {/* ── Chats tab ── */}
        {tab === 'chats' && (
          <>
            {friends.length === 0 ? (
              <div className="empty-state">
                <div className="icon">💬</div>
                <p>Нет друзей. Найдите людей по их ID во вкладке «Найти».</p>
              </div>
            ) : (
              friends.map((f) => (
                <div key={f.id} className="friend-item" onClick={() => navigate(`/chat/${f.id}`)}>
                  <div className="avatar">{f.username[0].toUpperCase()}</div>
                  <div className="friend-info">
                    <div className="friend-name">{f.username}</div>
                    <div className="friend-id">@{f.public_id}</div>
                  </div>
                  {online[f.id] ? (
                    <div className="online-dot" title="Онлайн" />
                  ) : (
                    <div className="online-dot offline-dot" title={timeSince(f.last_seen)} />
                  )}
                </div>
              ))
            )}
          </>
        )}

        {/* ── Search tab ── */}
        {tab === 'search' && (
          <>
            <div className="my-id-box">
              Ваш ID: <span>{me.public_id}</span> — поделитесь им с друзьями
            </div>

            <div className="search-box">
              <input
                className="search-input"
                placeholder="Поиск по ID пользователя..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>

            {searchResults.map((u) => (
              <div key={u.id} className="friend-item">
                <div className="avatar avatar-sm">{u.username[0].toUpperCase()}</div>
                <div className="friend-info">
                  <div className="friend-name">{u.username}</div>
                  <div className="friend-id">@{u.public_id}</div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => sendRequest(u.public_id)}>
                  Добавить
                </button>
              </div>
            ))}

            {searchQ && searchResults.length === 0 && (
              <div className="empty-state">
                <p>Никого не найдено</p>
              </div>
            )}

            {/* Direct add by exact id */}
            <div style={{ marginTop: 24 }}>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
                Или введите точный ID:
              </p>
              <div className="search-box">
                <input
                  className="search-input"
                  placeholder="точный_id"
                  value={addPublicId}
                  onChange={(e) => setAddPublicId(e.target.value)}
                />
                <button className="btn btn-primary btn-sm" onClick={() => sendRequest(addPublicId)} disabled={!addPublicId.trim()}>
                  Добавить
                </button>
              </div>
              {addMsg && <p style={{ fontSize: 13, marginTop: 6 }}>{addMsg}</p>}
            </div>
          </>
        )}

        {/* ── Requests tab ── */}
        {tab === 'requests' && (
          <>
            {requests.length === 0 ? (
              <div className="empty-state">
                <div className="icon">🤝</div>
                <p>Нет входящих заявок</p>
              </div>
            ) : (
              requests.map((r) => (
                <div key={r.request_id} className="friend-item">
                  <div className="avatar avatar-sm">{r.username[0].toUpperCase()}</div>
                  <div className="friend-info">
                    <div className="friend-name">{r.username}</div>
                    <div className="friend-id">@{r.public_id}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => acceptRequest(r.request_id)}>✓</button>
                    <button className="btn btn-danger btn-sm" onClick={() => rejectRequest(r.request_id)}>✗</button>
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
