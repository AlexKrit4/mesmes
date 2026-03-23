import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : `${dateStr}Z`;
  return new Date(s).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChannelInfoPage() {
  const { id } = useParams();
  const channelId = parseInt(id, 10);
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');

  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('info');

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const [subscribers, setSubscribers] = useState([]);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [moderationLoading, setModerationLoading] = useState(false);
  const [moderationMsg, setModerationMsg] = useState('');

  const isOwner = useMemo(() => channel?.owner_id === me.id, [channel, me.id]);
  const isMember = !!channel?.is_member;

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/channels/${channelId}`);
        setChannel(data);
        setNotificationsEnabled(data?.notifications_enabled !== 0);
      } catch {
        setChannel(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [channelId]);

  useEffect(() => {
    if (!isOwner || tab === 'info') return;

    (async () => {
      setModerationLoading(true);
      setModerationMsg('');
      try {
        const [subsRes, bansRes] = await Promise.all([
          api.get(`/channels/${channelId}/subscribers`),
          api.get(`/channels/${channelId}/bans`),
        ]);
        setSubscribers(Array.isArray(subsRes.data) ? subsRes.data : []);
        setBannedUsers(Array.isArray(bansRes.data) ? bansRes.data : []);
      } catch (err) {
        setModerationMsg(err.response?.data?.error || 'Не удалось загрузить данные');
      } finally {
        setModerationLoading(false);
      }
    })();
  }, [channelId, isOwner, tab]);

  const uploadChannelAvatar = async (file) => {
    if (!file || !isOwner) return;
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const { data } = await api.post(`/channels/${channelId}/avatar`, fd);
      setChannel((prev) => (prev ? { ...prev, avatar: data.avatar } : prev));
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка загрузки аватара');
    } finally {
      setAvatarUploading(false);
    }
  };

  const saveDescription = async () => {
    if (!isOwner) return;
    try {
      await api.patch(`/channels/${channelId}`, { description: descDraft });
      setChannel((prev) => (prev ? { ...prev, description: descDraft } : prev));
      setEditingDesc(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось сохранить описание');
    }
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${channel.invite_code}`);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      setLinkCopied(false);
    }
  };

  const toggleChannelNotifications = async () => {
    if (!isMember) return;
    const next = !notificationsEnabled;
    try {
      const { data } = await api.patch(`/channels/${channelId}/notification`, { enabled: next });
      const isEnabled = data?.notifications_enabled !== 0;
      setNotificationsEnabled(isEnabled);
      setChannel((prev) => (prev ? { ...prev, notifications_enabled: isEnabled ? 1 : 0 } : prev));
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось обновить уведомления');
    }
  };

  const banSubscriber = async (user) => {
    if (!user || user.is_owner || !isOwner) return;
    const reason = window.prompt('Причина блокировки (необязательно):', 'Заблокирован владельцем канала');
    if (reason === null) return;

    try {
      await api.post(`/channels/${channelId}/subscribers/${user.id}/ban`, { reason });
      setSubscribers((prev) => prev.filter((u) => u.id !== user.id));
      setBannedUsers((prev) => [
        {
          id: `local-${user.id}`,
          user_id: user.id,
          username: user.username,
          public_id: user.public_id,
          avatar: user.avatar,
          reason: reason || 'Заблокирован владельцем канала',
          active: 1,
          banned_at: new Date().toISOString(),
        },
        ...prev.filter((entry) => entry.user_id !== user.id),
      ]);
      setChannel((prev) => (prev ? { ...prev, member_count: Math.max(0, Number(prev.member_count || 0) - 1) } : prev));
      setModerationMsg(`Пользователь ${user.username} заблокирован`);
    } catch (err) {
      setModerationMsg(err.response?.data?.error || 'Не удалось заблокировать подписчика');
    }
  };

  const unbanSubscriber = async (entry) => {
    if (!isOwner) return;
    const userId = entry?.user_id || entry?.id;
    if (!userId) return;

    try {
      await api.post(`/channels/${channelId}/subscribers/${userId}/unban`);
      setBannedUsers((prev) => prev.filter((u) => (u.user_id || u.id) !== userId));
      setModerationMsg(`Бан снят: ${entry.username}`);
    } catch (err) {
      setModerationMsg(err.response?.data?.error || 'Не удалось снять бан');
    }
  };

  if (loading) {
    return <div className="chat-page"><div className="spinner" /></div>;
  }

  if (!channel) {
    return (
      <div className="chat-page">
        <div className="topbar chat-topbar">
          <button className="topbar-back" onClick={() => navigate(`/channel/${channelId}`)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="topbar-title">Информация</div>
          <div style={{ width: 36 }} />
        </div>
        <div className="empty-state"><div className="empty-title">Канал не найден</div></div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <div className="topbar chat-topbar">
        <button className="topbar-back" onClick={() => navigate(`/channel/${channelId}`)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="topbar-title">Информация о канале</div>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        <button className={`admin-tab ${tab === 'info' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('info')}>Инфо</button>
        {isOwner && (
          <button className={`admin-tab ${tab === 'users' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('users')}>Пользователи</button>
        )}
        {isOwner && (
          <button className={`admin-tab ${tab === 'bans' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('bans')}>Баны</button>
        )}
      </div>

      <div className="settings-content" style={{ paddingTop: 6 }}>
        {tab === 'info' && (
          <>
            <div className="modal-avatar-wrap" style={{ marginBottom: 10 }}>
              {channel.avatar ? <img className="avatar avatar-xl" src={channel.avatar} alt="" /> : <div className="avatar avatar-xl">📢</div>}
            </div>

            {isOwner && (
              <div className="channel-avatar-controls" style={{ marginBottom: 8 }}>
                <input
                  type="file"
                  accept="image/*"
                  id="channel-avatar-input"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadChannelAvatar(file);
                    e.target.value = '';
                  }}
                />
                <button className="btn btn-accent btn-sm" onClick={() => document.getElementById('channel-avatar-input')?.click()} disabled={avatarUploading}>
                  {avatarUploading ? 'Загрузка...' : 'Изменить аватар'}
                </button>
              </div>
            )}

            <div className="modal-name">{channel.name}</div>
            <div className="modal-id">{channel.member_count} подписчик{channel.member_count === 1 ? '' : channel.member_count < 5 ? 'а' : 'ов'}</div>

            <div className="channel-desc-section" style={{ marginTop: 14 }}>
              <div className="channel-desc-label">Описание</div>
              {editingDesc ? (
                <div className="channel-desc-edit">
                  <textarea value={descDraft} onChange={(e) => setDescDraft(e.target.value)} rows={3} style={{ resize: 'vertical' }} />
                  <div className="modal-actions" style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingDesc(false)}>Отмена</button>
                    <button className="btn btn-accent btn-sm" onClick={saveDescription}>Сохранить</button>
                  </div>
                </div>
              ) : (
                <div className="channel-desc-text">
                  {channel.description || 'Нет описания'}
                  {isOwner && (
                    <button className="channel-desc-edit-btn" onClick={() => { setDescDraft(channel.description || ''); setEditingDesc(true); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="channel-invite-section" style={{ marginTop: 14 }}>
              <div className="channel-desc-label">Ссылка-приглашение</div>
              <div className="channel-invite-row">
                <span className="channel-invite-link">{window.location.origin}/join/{channel.invite_code}</span>
                <button className="btn btn-accent btn-sm" onClick={copyInviteLink}>{linkCopied ? '✓ Скопировано' : 'Копировать'}</button>
              </div>
            </div>

            {isMember && (
              <div className="settings-section" style={{ marginTop: 14 }}>
                <div className="settings-toggle-row" onClick={toggleChannelNotifications} style={{ cursor: 'pointer' }}>
                  <div>
                    <div className="settings-toggle-label">Уведомления канала</div>
                    <div className="settings-toggle-hint">Включайте или отключайте уведомления для этого канала</div>
                  </div>
                  <div className={`settings-toggle ${notificationsEnabled ? 'on' : ''}`}><div className="settings-toggle-knob" /></div>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'users' && isOwner && (
          <>
            {moderationLoading ? <div className="admin-empty">Загрузка...</div> : null}
            {!moderationLoading && subscribers.length === 0 ? <div className="admin-empty">Подписчиков пока нет</div> : null}
            {!moderationLoading && subscribers.map((u) => (
              <div key={u.id} className="admin-user-card" style={{ marginBottom: 8 }}>
                <div className="admin-user-avatar">
                  {u.avatar ? <img src={u.avatar} alt="" /> : <span>{(u.username || '?')[0].toUpperCase()}</span>}
                </div>
                <div className="admin-user-info">
                  <div className="admin-user-name">{u.username}</div>
                  <div className="admin-user-id">@{u.public_id} · ID: {u.id}</div>
                  <div className="admin-user-meta">Подписан: {formatDate(u.joined_at)}</div>
                </div>
                {!u.is_owner ? (
                  <button className="btn btn-danger btn-sm" onClick={() => banSubscriber(u)}>Выгнать навсегда</button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--accent)' }}>Владелец</span>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'bans' && isOwner && (
          <>
            {moderationLoading ? <div className="admin-empty">Загрузка...</div> : null}
            {!moderationLoading && bannedUsers.length === 0 ? <div className="admin-empty">Активных банов нет</div> : null}
            {!moderationLoading && bannedUsers.map((u) => (
              <div key={u.id || u.user_id} className="admin-user-card" style={{ marginBottom: 8 }}>
                <div className="admin-user-avatar">
                  {u.avatar ? <img src={u.avatar} alt="" /> : <span>{(u.username || '?')[0].toUpperCase()}</span>}
                </div>
                <div className="admin-user-info">
                  <div className="admin-user-name">{u.username}</div>
                  <div className="admin-user-id">@{u.public_id}</div>
                  <div className="admin-user-meta">Причина: {u.reason || '—'}</div>
                  <div className="admin-user-meta">Забанен: {formatDate(u.banned_at)}</div>
                </div>
                <button className="btn btn-accent btn-sm" onClick={() => unbanSubscriber(u)}>Снять бан</button>
              </div>
            ))}
          </>
        )}

        {moderationMsg ? <div className="admin-ban-msg">{moderationMsg}</div> : null}
      </div>
    </div>
  );
}
