import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, getSocket } from '../socket.js';

function formatTime(dateStr) {
  if (!dateStr) return '';
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  return new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function ChannelPage() {
  const { id } = useParams();
  const channelId = parseInt(id);
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');

  const [channel, setChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showUnsubConfirm, setShowUnsubConfirm] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [lightboxScale, setLightboxScale] = useState(1);
  const pinchDistRef = useRef(null);

  const bottomRef = useRef(null);
  const chatPageRef = useRef(null);
  const fileInputRef = useRef(null);

  const isOwner = channel?.owner_id === me.id;
  const isMember = channel?.is_member;

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Handle mobile keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      const el = chatPageRef.current;
      if (!el) return;
      el.style.height = `${vv.height}px`;
      setTimeout(scrollToBottom, 50);
    };
    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);
    handleResize();
    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
    };
  }, [scrollToBottom]);

  // Load channel data
  useEffect(() => {
    (async () => {
      try {
        const [chRes, msgsRes] = await Promise.all([
          api.get(`/channels/${channelId}`),
          api.get(`/channels/${channelId}/messages`),
        ]);
        setChannel(chRes.data);
        setMessages(msgsRes.data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [channelId]);

  useEffect(() => {
    if (messages.length) setTimeout(scrollToBottom, 50);
  }, [messages, scrollToBottom]);

  // Close menus on outside click
  useEffect(() => {
    const close = () => { setShowMenu(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // Socket: channel_message
  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    const onChannelMsg = (msg) => {
      if (msg.channel_id === channelId) {
        setMessages((prev) => {
          if (prev.find((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    };

    socket.on('channel_message', onChannelMsg);
    return () => socket.off('channel_message', onChannelMsg);
  }, [channelId]);

  const sendMessage = async () => {
    const content = text.trim();
    if (!content) return;
    try {
      await api.post(`/channels/${channelId}/messages`, { content });
      setText('');
    } catch (err) {
      console.error('Send channel msg failed', err);
    }
  };

  const sendFile = async (file) => {
    if (!file || fileUploading) return;
    setFileUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/channels/${channelId}/messages/file`, formData);
      const { file_url } = res.data;
      await api.post(`/channels/${channelId}/messages`, { content: '', file_url });
    } catch (err) {
      console.error('File upload error', err);
    } finally {
      setFileUploading(false);
    }
  };

  const joinChannel = async () => {
    try {
      await api.post(`/channels/${channelId}/join`);
      setChannel((prev) => prev ? { ...prev, is_member: true, member_count: (prev.member_count || 0) + 1 } : prev);
    } catch (err) {
      console.error(err);
    }
  };

  const leaveChannel = async () => {
    setShowUnsubConfirm(false);
    try {
      await api.post(`/channels/${channelId}/leave`);
      navigate('/');
    } catch (err) {
      console.error(err);
    }
  };

  const saveDescription = async () => {
    try {
      await api.patch(`/channels/${channelId}`, { description: descDraft });
      setChannel((prev) => prev ? { ...prev, description: descDraft } : prev);
      setEditingDesc(false);
    } catch (err) {
      console.error(err);
    }
  };

  const copyInviteLink = () => {
    const link = `${window.location.origin}/join/${channel.invite_code}`;
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(() => {});
  };

  if (loading) {
    return (
      <div className="chat-page" ref={chatPageRef}>
        <div className="spinner" />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="chat-page" ref={chatPageRef}>
        <div className="empty-state"><div className="empty-title">Канал не найден</div></div>
      </div>
    );
  }

  return (
    <div className="chat-page" ref={chatPageRef}>
      {/* Top bar */}
      <div className="topbar chat-topbar">
        <button className="topbar-back" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="chat-topbar-info" onClick={() => setShowInfo(true)} style={{ cursor: 'pointer' }}>
          {channel.avatar ? (
            <img className="avatar avatar-topbar" src={channel.avatar} alt="" />
          ) : (
            <div className="avatar avatar-topbar">📢</div>
          )}
          <div className="chat-topbar-text">
            <div className="chat-topbar-name">{channel.name}</div>
            <div className="chat-topbar-status">{channel.member_count} подписчик{channel.member_count === 1 ? '' : channel.member_count < 5 ? 'а' : 'ов'}</div>
          </div>
        </div>
        {/* Three-dots menu */}
        {isMember && (
          <div className="chat-menu-wrap">
            <button className="topbar-btn" onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
            </button>
            {showMenu && (
              <div className="chat-dropdown" onClick={(e) => e.stopPropagation()}>
                {!isOwner && (
                  <button className="chat-dropdown-item danger" onClick={() => { setShowMenu(false); setShowUnsubConfirm(true); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Отписаться
                  </button>
                )}
                <button className="chat-dropdown-item" onClick={() => { setShowMenu(false); setShowInfo(true); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  Информация
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="messages-area">
        {messages.length === 0 && (
          <div className="empty-state chat-empty">
            <div className="empty-icon">📢</div>
            <div className="empty-title">Пока нет записей</div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="message-row out">
            <div className="message out channel-msg">
              {msg.file_url && (
                <img
                  src={msg.file_url}
                  className="msg-image"
                  alt=""
                  onClick={(e) => { e.stopPropagation(); setLightboxSrc(msg.file_url); setLightboxScale(1); }}
                />
              )}
              {msg.content && <div className="message-text">{msg.content}</div>}
              <div className="message-meta">
                <span className="message-time">{formatTime(msg.created_at)}</span>
              </div>
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Join bar for non-members */}
      {!isMember && (
        <div className="channel-join-bar">
          <button className="btn btn-accent" style={{ width: '100%' }} onClick={joinChannel}>
            Присоединиться
          </button>
        </div>
      )}

      {/* Input bar for owner */}
      {isOwner && (
        <div className="message-input-bar">
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files[0]) sendFile(e.target.files[0]); e.target.value = ''; }}
          />
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileUploading}
            title="Прикрепить изображение"
          >
            {fileUploading
              ? <span className="attach-spinner" />
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            }
          </button>
          <textarea
            className="message-input"
            placeholder="Написать в канал..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            onFocus={() => setTimeout(scrollToBottom, 300)}
            rows={1}
          />
          <button
            className="send-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={sendMessage}
            disabled={!text.trim()}
            aria-label="Отправить"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      )}

      {/* Unsubscribe confirm */}
      {showUnsubConfirm && (
        <div className="modal-overlay" onClick={() => setShowUnsubConfirm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-name" style={{ fontSize: '1rem', marginBottom: 8 }}>Отписаться от канала?</div>
            <div className="modal-status-text">Вы больше не будете получать записи от {channel.name}</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowUnsubConfirm(false)}>Отмена</button>
              <button className="btn btn-danger" onClick={leaveChannel}>Отписаться</button>
            </div>
          </div>
        </div>
      )}

      {/* Channel info modal */}
      {showInfo && (
        <div className="modal-overlay" onClick={() => { setShowInfo(false); setEditingDesc(false); }}>
          <div className="modal-card channel-info-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => { setShowInfo(false); setEditingDesc(false); }}>✕</button>
            <div className="modal-avatar-wrap">
              {channel.avatar ? (
                <img className="avatar avatar-xl" src={channel.avatar} alt="" />
              ) : (
                <div className="avatar avatar-xl">📢</div>
              )}
            </div>
            <div className="modal-name">{channel.name}</div>
            <div className="modal-id">{channel.member_count} подписчик{channel.member_count === 1 ? '' : channel.member_count < 5 ? 'а' : 'ов'}</div>

            <div className="channel-desc-section">
              <div className="channel-desc-label">Описание</div>
              {editingDesc ? (
                <div className="channel-desc-edit">
                  <textarea
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    rows={3}
                    style={{ resize: 'vertical' }}
                  />
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

            <div className="channel-invite-section">
              <div className="channel-desc-label">Ссылка-приглашение</div>
              <div className="channel-invite-row">
                <span className="channel-invite-link">{window.location.origin}/join/{channel.invite_code}</span>
                <button className="btn btn-accent btn-sm" onClick={copyInviteLink}>
                  {linkCopied ? '✓ Скопировано' : 'Копировать'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => { setLightboxSrc(null); setLightboxScale(1); }}>
          <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); setLightboxScale(1); }}>✕</button>
          <img
            src={lightboxSrc}
            className="lightbox-img"
            alt=""
            style={{ transform: `scale(${lightboxScale})` }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => {
              if (e.touches.length === 2) {
                pinchDistRef.current = Math.hypot(
                  e.touches[0].clientX - e.touches[1].clientX,
                  e.touches[0].clientY - e.touches[1].clientY
                );
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2 && pinchDistRef.current) {
                const d = Math.hypot(
                  e.touches[0].clientX - e.touches[1].clientX,
                  e.touches[0].clientY - e.touches[1].clientY
                );
                setLightboxScale(s => Math.min(5, Math.max(0.5, s * (d / pinchDistRef.current))));
                pinchDistRef.current = d;
              }
            }}
            onTouchEnd={() => { pinchDistRef.current = null; }}
            onWheel={(e) => {
              e.preventDefault();
              setLightboxScale(s => Math.min(5, Math.max(0.5, s - e.deltaY * 0.005)));
            }}
          />
        </div>
      )}
    </div>
  );
}
