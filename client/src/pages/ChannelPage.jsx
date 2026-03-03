import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, getSocket } from '../socket.js';

const URL_REGEX = /(https?:\/\/[^\s<]+)/g;
function Linkify({ children }) {
  if (!children || typeof children !== 'string') return children;
  const parts = children.split(URL_REGEX);
  return parts.map((part, i) =>
    URL_REGEX.test(part)
      ? <a key={i} href={part} className="msg-link" onClick={e => e.stopPropagation()}>{part}</a>
      : part
  );
}

function parseFileUrls(file_url) {
  if (!file_url) return [];
  if (file_url.startsWith('[')) {
    try { return JSON.parse(file_url); } catch { return [file_url]; }
  }
  return [file_url];
}

function isVideo(url) {
  return /\.(mp4|webm|mov|avi|mkv|3gp)$/i.test(url);
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  return new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function dayKey(dateStr) {
  if (!dateStr) return '';
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  const d = new Date(s);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(dateStr) {
  if (!dateStr) return '';
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  const d = new Date(s);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
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

  // Edit channel message state
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editMsgText, setEditMsgText] = useState('');

  // Reaction picker
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState(null);

  // Pending files (multiple)
  const [pendingFiles, setPendingFiles] = useState([]);

  // Lightbox with navigation
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxScale, setLightboxScale] = useState(1);
  const pinchDistRef = useRef(null);

  // Delete confirm
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const bottomRef = useRef(null);
  const chatPageRef = useRef(null);
  const fileInputRef = useRef(null);

  const isOwner = channel?.owner_id === me.id;
  const isMember = channel?.is_member;

  const scrollToBottomInstant = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, []);

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
      setTimeout(scrollToBottomInstant, 50);
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

  const hasInitiallyScrolled = useRef(false);

  // Initial scroll: fires once after loading finishes (DOM is ready)
  useEffect(() => {
    if (!loading && !hasInitiallyScrolled.current && messages.length) {
      hasInitiallyScrolled.current = true;
      setTimeout(scrollToBottomInstant, 30);
    }
  }, [loading, messages, scrollToBottomInstant]);

  // Subsequent new messages: auto-scroll to bottom
  useEffect(() => {
    if (!hasInitiallyScrolled.current) return;
    scrollToBottom();
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
    const onChannelMsgEdited = ({ channel_id, messageId, content }) => {
      if (channel_id === channelId) {
        setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content, edited: 1 } : m));
      }
    };
    const onChannelMsgDeleted = ({ channel_id, messageId }) => {
      if (channel_id === channelId) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    };
    socket.on('channel_message_edited', onChannelMsgEdited);
    socket.on('channel_message_deleted', onChannelMsgDeleted);
    return () => {
      socket.off('channel_message', onChannelMsg);
      socket.off('channel_message_edited', onChannelMsgEdited);
      socket.off('channel_message_deleted', onChannelMsgDeleted);
    };
  }, [channelId]);

  // Close reaction picker on outside click
  useEffect(() => {
    if (!reactionPickerMsgId) return;
    const handler = () => setReactionPickerMsgId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [reactionPickerMsgId]);

  const sendMessage = async () => {
    const content = text.trim();
    if (!content && pendingFiles.length === 0) return;

    if (pendingFiles.length > 0) {
      const files = [...pendingFiles];
      setPendingFiles([]);
      setText('');
      setFileUploading(true);
      try {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        const res = await api.post(`/channels/${channelId}/messages/file`, formData);
        const { file_urls } = res.data;
        await api.post(`/channels/${channelId}/messages`, { content, file_urls });
      } catch (err) {
        console.error('File upload error', err);
      } finally {
        setFileUploading(false);
      }
      return;
    }

    try {
      await api.post(`/channels/${channelId}/messages`, { content });
      setText('');
    } catch (err) {
      console.error('Send channel msg failed', err);
    }
  };

  const addFiles = (newFiles) => {
    if (!newFiles || fileUploading) return;
    const arr = Array.from(newFiles);
    setPendingFiles(prev => [...prev, ...arr].slice(0, 5));
  };

  const removePendingFile = (idx) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const deleteMessage = async (msgId) => {
    setDeleteConfirmId(null);
    try {
      await api.delete(`/channels/${channelId}/messages/${msgId}`);
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const openLightbox = (urls, startIndex = 0) => {
    setLightboxImages(urls);
    setLightboxIndex(startIndex);
    setLightboxScale(1);
  };

  const startEditMsg = (msg) => {
    setEditingMsgId(msg.id);
    setEditMsgText(msg.content || '');
  };

  const cancelEditMsg = () => {
    setEditingMsgId(null);
    setEditMsgText('');
  };

  const saveEditMsg = async () => {
    const content = editMsgText.trim();
    if (!content || !editingMsgId) return;
    try {
      await api.patch(`/channels/${channelId}/messages/${editingMsgId}`, { content });
      setMessages((prev) => prev.map((m) => m.id === editingMsgId ? { ...m, content, edited: 1 } : m));
      cancelEditMsg();
    } catch (err) {
      console.error('Edit failed', err);
    }
  };

  const toggleReaction = async (msgId, emoji) => {
    setReactionPickerMsgId(null);
    try {
      const { data } = await api.post(`/channels/${channelId}/messages/${msgId}/react`, { emoji });
      setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, reactions: data.reactions } : m));
    } catch (err) {
      console.error('Reaction failed', err);
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

        {messages.map((msg, idx) => {
          const urls = parseFileUrls(msg.file_url);
          const showDay = idx === 0 || dayKey(msg.created_at) !== dayKey(messages[idx - 1].created_at);
          return (
          <React.Fragment key={msg.id}>
            {showDay && (
              <div className="day-separator"><span>{formatDayLabel(msg.created_at)}</span></div>
            )}
            <div className="message-row out">
            {/* Action buttons for owner: edit + delete; for others: heart reaction */}
            {isMember && (
              <div className="msg-action-btns channel-action">
                {isOwner ? (
                  <>
                    <button className="msg-gear-btn" onClick={() => startEditMsg(msg)} title="Редактировать">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button className="msg-gear-btn" onClick={() => setDeleteConfirmId(msg.id)} title="Удалить">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                  </>
                ) : (
                  <button className="msg-gear-btn reaction-btn" onClick={(e) => { e.stopPropagation(); setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id); }} title="Реакция">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                  </button>
                )}
              </div>
            )}
            {/* Reaction picker popup */}
            {reactionPickerMsgId === msg.id && (
              <div className="reaction-picker" onClick={(e) => e.stopPropagation()}>
                {['❤️', '👍', '👎'].map((emoji) => (
                  <button key={emoji} className="reaction-picker-btn" onClick={() => toggleReaction(msg.id, emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            <div className="message out channel-msg">
              {urls.length === 1 && isVideo(urls[0]) && (
                <video
                  src={urls[0]}
                  className="msg-video"
                  controls
                  playsInline
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              {urls.length === 1 && !isVideo(urls[0]) && (
                <img
                  src={urls[0]}
                  className="msg-image"
                  alt=""
                  onClick={(e) => { e.stopPropagation(); openLightbox(urls, 0); }}
                />
              )}
              {urls.length > 1 && (
                <div className={`msg-collage c${urls.length}`}>
                  {urls.map((url, i) => (
                    isVideo(url) ? (
                      <video
                        key={i}
                        src={url}
                        className="msg-collage-img"
                        controls
                        playsInline
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <img
                        key={i}
                        src={url}
                        className="msg-collage-img"
                        alt=""
                        onClick={(e) => { e.stopPropagation(); openLightbox(urls.filter(u => !isVideo(u)), urls.filter(u => !isVideo(u)).indexOf(url)); }}
                      />
                    )
                  ))}
                </div>
              )}
              {msg.content && <div className="message-text"><Linkify>{msg.content}</Linkify></div>}
              {/* Reactions display */}
              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                <div className="reactions-row">
                  {Object.entries(msg.reactions).map(([emoji, data]) => (
                    <button
                      key={emoji}
                      className={`reaction-chip ${data.me ? 'my' : ''}`}
                      onClick={() => toggleReaction(msg.id, emoji)}
                    >
                      <span>{emoji}</span>
                      <span className="reaction-count">{data.count}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="message-meta">
                {msg.edited ? <span className="message-edited">ред.</span> : null}
                <span className="message-time">{formatTime(msg.created_at)}</span>
              </div>
            </div>
          </div>
          </React.Fragment>
          );
        })}

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
        <>
          {/* Edit bar */}
          {editingMsgId && (
            <div className="edit-bar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span className="edit-bar-label">Редактирование</span>
              <button className="edit-bar-cancel" onClick={cancelEditMsg}>✕</button>
            </div>
          )}
          {/* Pending files preview */}
          {pendingFiles.length > 0 && (
            <div className="file-preview-bar multi">
              {pendingFiles.map((f, i) => (
                <div key={i} className="file-preview-item">
                  {f.type.startsWith('image/') ? (
                    <img src={URL.createObjectURL(f)} alt="" className="file-preview-thumb" />
                  ) : f.type.startsWith('video/') ? (
                    <video src={URL.createObjectURL(f)} className="file-preview-thumb" muted />
                  ) : (
                    <span className="file-preview-name">{f.name}</span>
                  )}
                  <button className="file-preview-cancel" onClick={() => removePendingFile(i)}>✕</button>
                </div>
              ))}
              {pendingFiles.length < 5 && (
                <button className="file-preview-add" onClick={() => fileInputRef.current?.click()}>+</button>
              )}
            </div>
          )}
          <div className="message-input-bar">
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; }}
            />
            {!editingMsgId && (
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
            )}
            <textarea
              className="message-input"
              placeholder={editingMsgId ? 'Редактировать...' : 'Написать в канал...'}
              value={editingMsgId ? editMsgText : text}
              onChange={(e) => editingMsgId ? setEditMsgText(e.target.value) : setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  editingMsgId ? saveEditMsg() : sendMessage();
                }
              }}
              onFocus={() => setTimeout(scrollToBottom, 300)}
              rows={1}
            />
            <button
              className="send-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={editingMsgId ? saveEditMsg : sendMessage}
              disabled={editingMsgId ? !editMsgText.trim() : (!text.trim() && pendingFiles.length === 0)}
              aria-label="Отправить"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        </>
      )}

      {/* Delete message confirm */}
      {deleteConfirmId && (
        <div className="modal-overlay" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-name" style={{ fontSize: '1rem', marginBottom: 8 }}>Удалить запись?</div>
            <div className="modal-status-text">Запись будет удалена для всех подписчиков</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteConfirmId(null)}>Отмена</button>
              <button className="btn btn-danger" onClick={() => deleteMessage(deleteConfirmId)}>Удалить</button>
            </div>
          </div>
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

      {/* Lightbox with navigation */}
      {lightboxImages.length > 0 && (
        <div className="lightbox-overlay" onClick={() => { setLightboxImages([]); setLightboxScale(1); }}>
          <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setLightboxImages([]); setLightboxScale(1); }}>✕</button>
          {lightboxImages.length > 1 && lightboxIndex > 0 && (
            <button className="lightbox-nav lightbox-prev" onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i - 1); setLightboxScale(1); }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
          )}
          {lightboxImages.length > 1 && lightboxIndex < lightboxImages.length - 1 && (
            <button className="lightbox-nav lightbox-next" onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i + 1); setLightboxScale(1); }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
            </button>
          )}
          {lightboxImages.length > 1 && (
            <div className="lightbox-counter">{lightboxIndex + 1} / {lightboxImages.length}</div>
          )}
          <img
            src={lightboxImages[lightboxIndex]}
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
