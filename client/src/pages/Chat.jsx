import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, getSocket } from '../socket.js';

function parseUTC(dateStr) {
  if (!dateStr) return null;
  // Ensure UTC interpretation — append Z if missing
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  return new Date(s);
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  return parseUTC(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function timeSince(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - parseUTC(dateStr).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} дн назад`;
}

export default function Chat() {
  const { friendId } = useParams();
  const friendIdNum = parseInt(friendId);
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');

  const [friend, setFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState(null); // { msgId, x, y, isOut, containerWidth, containerHeight }
  const [showFriendProfile, setShowFriendProfile] = useState(false);

  // Edit state
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editText, setEditText] = useState('');

  // Delete confirm dialog
  const [deleteDialog, setDeleteDialog] = useState(null); // msgId or null
  const [deleteForBoth, setDeleteForBoth] = useState(true);

  // Three-dots menu + remove friend
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showRemoveFriendConfirm, setShowRemoveFriendConfirm] = useState(false);

  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const messagesRef = useRef(null);
  const chatPageRef = useRef(null);
  const inputBarRef = useRef(null);
  const suppressNextClose = useRef(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Handle mobile keyboard: resize layout using visualViewport API
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handleResize = () => {
      const el = chatPageRef.current;
      if (!el) return;
      // Set height to actual visible viewport (accounts for keyboard)
      el.style.height = `${vv.height}px`;
      // Scroll to bottom when keyboard opens
      setTimeout(scrollToBottom, 50);
    };

    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);
    // Set initial height
    handleResize();

    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
    };
  }, [scrollToBottom]);

  useEffect(() => {
    (async () => {
      try {
        const [friendRes, msgsRes] = await Promise.all([
          api.get('/users/friends'),
          api.get(`/users/messages/${friendId}`),
        ]);
        const friends = friendRes.data;
        const f = friends.find((x) => x.id === friendIdNum);
        setFriend(f || { id: friendIdNum, username: '?', public_id: '?' });
        setMessages(msgsRes.data);
        // Mark friend's messages as read now that we opened the chat
        const socket = getSocket();
        if (socket) socket.emit('mark_read', { friendId: friendIdNum });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [friendId, friendIdNum]);

  useEffect(() => {
    if (messages.length) setTimeout(scrollToBottom, 50);
  }, [messages, scrollToBottom]);

  // Close context menu / chat menu on any tap/click outside
  // suppressClose флаг нужен чтобы игнорировать синтетический click после long-press
  useEffect(() => {
    const close = () => {
      if (suppressNextClose.current) { suppressNextClose.current = false; return; }
      setContextMenu(null);
      setShowChatMenu(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // Socket events
  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    const onNewMsg = (msg) => {
      if (
        (msg.sender_id === friendIdNum && msg.receiver_id === me.id) ||
        (msg.sender_id === me.id && msg.receiver_id === friendIdNum)
      ) {
        setMessages((prev) => {
          if (prev.find((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        // If the message is from the friend, mark it as read immediately
        if (msg.sender_id === friendIdNum) {
          socket.emit('mark_read', { friendId: friendIdNum });
        }
      }
    };

    const onSent = (msg) => {
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    const onTyping = ({ from }) => {
      if (from === friendIdNum) setIsTyping(true);
    };

    const onStopTyping = ({ from }) => {
      if (from === friendIdNum) setIsTyping(false);
    };

    const onPresence = ({ userId, online, lastSeen }) => {
      if (userId === friendIdNum) {
        setIsOnline(online);
        if (!online && lastSeen) {
          setFriend((prev) => prev ? { ...prev, last_seen: lastSeen } : prev);
        }
      }
    };

    const onMessagesRead = ({ by, at }) => {
      if (by === friendIdNum) {
        setMessages((prev) =>
          prev.map((m) =>
            m.sender_id === me.id && !m.read_at ? { ...m, read_at: at } : m
          )
        );
      }
    };

    const onMessageDeleted = ({ messageId }) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    };

    const onMessageEdited = ({ messageId, content }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, content, edited: 1 } : m)
      );
    };

    const onFriendRemoved = ({ by }) => {
      if (by === friendIdNum) navigate('/');
    };

    socket.on('new_message', onNewMsg);
    socket.on('message_sent', onSent);
    socket.on('user_typing', onTyping);
    socket.on('user_stop_typing', onStopTyping);
    socket.on('presence', onPresence);
    socket.on('message_deleted', onMessageDeleted);
    socket.on('messages_read', onMessagesRead);
    socket.on('message_edited', onMessageEdited);
    socket.on('friend_removed', onFriendRemoved);

    return () => {
      socket.off('new_message', onNewMsg);
      socket.off('message_sent', onSent);
      socket.off('user_typing', onTyping);
      socket.off('user_stop_typing', onStopTyping);
      socket.off('presence', onPresence);
      socket.off('message_deleted', onMessageDeleted);
      socket.off('messages_read', onMessagesRead);
      socket.off('message_edited', onMessageEdited);
      socket.off('friend_removed', onFriendRemoved);
    };
  }, [friendIdNum, me.id]);

  const sendMessage = () => {
    const content = text.trim();
    if (!content) return;

    const socket = getSocket();
    if (!socket) return;

    socket.emit('send_message', { to: friendIdNum, content });
    setText('');

    socket.emit('stop_typing', { to: friendIdNum });
    clearTimeout(typingTimeout.current);
  };

  const openDeleteDialog = (msgId) => {
    setDeleteDialog(msgId);
    setDeleteForBoth(true);
    setContextMenu(null);
  };

  const deleteFriendMessage = async (msgId) => {
    setContextMenu(null);
    try {
      await api.delete(`/users/messages/${msgId}`, { data: { deleteForReceiver: true } });
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const copyMessage = (content) => {
    navigator.clipboard.writeText(content).catch(() => {});
    setContextMenu(null);
  };

  const confirmDelete = async () => {
    const msgId = deleteDialog;
    setDeleteDialog(null);
    try {
      await api.delete(`/users/messages/${msgId}`, { data: { deleteForBoth } });
      const socket = getSocket();
      if (socket && deleteForBoth) {
        socket.emit('delete_message', { messageId: msgId, friendId: friendIdNum, deleteForBoth: true });
      }
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const startEdit = (msg) => {
    setEditingMsgId(msg.id);
    setEditText(msg.content);
    setContextMenu(null);
  };

  const cancelEdit = () => {
    setEditingMsgId(null);
    setEditText('');
  };

  const saveEdit = async () => {
    const content = editText.trim();
    if (!content || !editingMsgId) return;
    try {
      await api.patch(`/users/messages/${editingMsgId}`, { content });
      const socket = getSocket();
      if (socket) socket.emit('edit_message', { messageId: editingMsgId, content, friendId: friendIdNum });
      setMessages((prev) =>
        prev.map((m) => m.id === editingMsgId ? { ...m, content, edited: 1 } : m)
      );
      cancelEdit();
    } catch (err) {
      console.error('Edit failed', err);
    }
  };

  const removeFriend = async () => {
    setShowRemoveFriendConfirm(false);
    try {
      await api.delete(`/users/friends/${friendIdNum}`);
      navigate('/');
    } catch (err) {
      console.error('Remove friend failed', err);
    }
  };

  const handleInput = (e) => {
    setText(e.target.value);
    const socket = getSocket();
    if (!socket) return;

    socket.emit('typing', { to: friendIdNum });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('stop_typing', { to: friendIdNum });
    }, 2000);
  };

  const openContextMenu = (e, msg) => {
    e.preventDefault();
    e.stopPropagation();
    const container = messagesRef.current;
    const rect = container?.getBoundingClientRect() || { left: 0, top: 0, width: 320, height: 600 };
    // For touch events, read from changedTouches/touches at call time
    const touch = e.changedTouches?.[0] || e.touches?.[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const isOut = msg.sender_id === me.id;
    suppressNextClose.current = true;
    setContextMenu({
      msgId: msg.id,
      content: msg.content,
      x,
      y,
      isOut,
      containerWidth: rect.width,
      containerHeight: rect.height,
    });
  };

  // long press for mobile — capture coordinates in touchstart, not inside setTimeout
  const longPressTimer = useRef(null);
  const longPressData = useRef(null);
  const handleTouchStart = (e, msg) => {
    const touch = e.touches[0];
    longPressData.current = { clientX: touch.clientX, clientY: touch.clientY, msg };
    longPressTimer.current = setTimeout(() => {
      const d = longPressData.current;
      if (!d) return;
      const container = messagesRef.current;
      const rect = container?.getBoundingClientRect() || { left: 0, top: 0, width: 320, height: 600 };
      const isOut = d.msg.sender_id === me.id;
      suppressNextClose.current = true;
      setContextMenu({
        msgId: d.msg.id,
        content: d.msg.content,
        x: d.clientX - rect.left,
        y: d.clientY - rect.top,
        isOut,
        containerWidth: rect.width,
        containerHeight: rect.height,
      });
    }, 500);
  };
  const handleTouchEnd = () => {
    clearTimeout(longPressTimer.current);
    longPressData.current = null;
  };

  if (loading) {
    return (
      <div className="chat-page" ref={chatPageRef}>
        <div className="spinner" />
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
        <div className="chat-topbar-info" onClick={() => setShowFriendProfile(true)} style={{ cursor: 'pointer' }}>
          {friend?.avatar ? (
            <img className="avatar avatar-topbar" src={friend.avatar} alt="" />
          ) : (
            <div className="avatar avatar-topbar">{(friend?.username || '?')[0].toUpperCase()}</div>
          )}
          <div className="chat-topbar-text">
            <div className="chat-topbar-name">{friend?.username || '...'}</div>
            <div className={`chat-topbar-status ${isOnline ? 'online' : ''}`}>
              {isTyping ? 'печатает...' : isOnline ? 'в сети' : `@${friend?.public_id || ''}`}
            </div>
          </div>
        </div>
        {/* Three-dots menu */}
        <div className="chat-menu-wrap">
          <button className="topbar-btn" onClick={(e) => { e.stopPropagation(); setShowChatMenu((v) => !v); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
          {showChatMenu && (
            <div className="chat-dropdown" onClick={(e) => e.stopPropagation()}>
              <button className="chat-dropdown-item danger" onClick={() => { setShowChatMenu(false); setShowRemoveFriendConfirm(true); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                Удалить из друзей
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="messages-area" ref={messagesRef}>
        {messages.length === 0 && (
          <div className="empty-state chat-empty">
            <div className="empty-icon">👋</div>
            <div className="empty-title">Начните переписку!</div>
          </div>
        )}

        {messages.map((msg) => {
          const isOut = msg.sender_id === me.id;
          return (
            <div
              key={msg.id}
              className={`message ${isOut ? 'out' : 'in'}`}
              onContextMenu={(e) => openContextMenu(e, msg)}
              onTouchStart={(e) => handleTouchStart(e, msg)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchEnd}
            >
              <div className="message-text">{msg.content}</div>
              <div className="message-meta">
                {msg.edited ? <span className="message-edited">ред.</span> : null}
                <span className="message-time">{formatTime(msg.created_at)}</span>
                {isOut && (
                  <span className={`message-check ${msg.read_at ? 'read' : ''}`}>
                    {msg.read_at ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {isTyping && !messages.some(m => false) && (
          <div className="typing-indicator">
            <span className="typing-dots"><span/><span/><span/></span>
            {friend?.username} печатает
          </div>
        )}

        <div ref={bottomRef} />

        {/* Context menu */}
        {contextMenu && (() => {
          const MENU_W = 178;
          const MENU_H = contextMenu.isOut ? 126 : 88;
          const xPos = contextMenu.isOut
            ? { right: Math.max(0, contextMenu.containerWidth - contextMenu.x) }
            : { left: Math.min(contextMenu.x, Math.max(0, contextMenu.containerWidth - MENU_W)) };
          const topPos = Math.min(contextMenu.y, Math.max(0, contextMenu.containerHeight - MENU_H));
          return (
            <div
              className={`msg-context-menu${contextMenu.isOut ? '' : ' in-side'}`}
              style={{ ...xPos, top: topPos }}
              onClick={(e) => e.stopPropagation()}
            >
              {contextMenu.isOut && (
                <button className="ctx-btn edit" onClick={() => {
                  const msg = messages.find((m) => m.id === contextMenu.msgId);
                  if (msg) startEdit(msg);
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Редактировать
                </button>
              )}
              <button className="ctx-btn" onClick={() => copyMessage(contextMenu.content)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Копировать
              </button>
              <button className="ctx-btn delete" onClick={() =>
                contextMenu.isOut
                  ? openDeleteDialog(contextMenu.msgId)
                  : deleteFriendMessage(contextMenu.msgId)
              }>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Удалить
              </button>
            </div>
          );
        })()}
      </div>

      {/* Edit bar */}
      {editingMsgId && (
        <div className="edit-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <div className="edit-bar-text">Редактирование</div>
          <button className="edit-bar-cancel" onClick={cancelEdit}>✕</button>
        </div>
      )}

      {/* Input bar */}
      <div className="message-input-bar">
        <textarea
          className="message-input"
          placeholder={editingMsgId ? 'Изменить сообщение...' : 'Сообщение...'}
          value={editingMsgId ? editText : text}
          onChange={editingMsgId
            ? (e) => setEditText(e.target.value)
            : handleInput
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              editingMsgId ? saveEdit() : sendMessage();
            }
            if (e.key === 'Escape' && editingMsgId) cancelEdit();
          }}
          onFocus={() => setTimeout(scrollToBottom, 300)}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={editingMsgId ? saveEdit : sendMessage}
          disabled={editingMsgId ? !editText.trim() : !text.trim()}
          aria-label={editingMsgId ? 'Сохранить' : 'Отправить'}
        >
          {editingMsgId ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          )}
        </button>
      </div>

      {/* Delete message confirm dialog */}
      {deleteDialog && (
        <div className="modal-overlay" onClick={() => setDeleteDialog(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-name" style={{ fontSize: '1rem', marginBottom: 8 }}>Удалить сообщение?</div>
            <label className="delete-option">
              <input type="checkbox" checked={deleteForBoth} onChange={(e) => setDeleteForBoth(e.target.checked)} />
              <span>Удалить у собеседника</span>
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteDialog(null)}>Отмена</button>
              <button className="btn btn-danger" onClick={confirmDelete}>Удалить</button>
            </div>
          </div>
        </div>
      )}

      {/* Remove friend confirm dialog */}
      {showRemoveFriendConfirm && (
        <div className="modal-overlay" onClick={() => setShowRemoveFriendConfirm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-name" style={{ fontSize: '1rem', marginBottom: 8 }}>Удалить из друзей?</div>
            <div className="modal-status-text">Вы больше не сможете переписываться с {friend?.username}</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowRemoveFriendConfirm(false)}>Отмена</button>
              <button className="btn btn-danger" onClick={removeFriend}>Удалить</button>
            </div>
          </div>
        </div>
      )}

      {/* Friend profile modal */}
      {showFriendProfile && friend && (
        <div className="modal-overlay" onClick={() => setShowFriendProfile(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowFriendProfile(false)}>✕</button>
            <div className="modal-avatar-wrap">
              {friend.avatar ? (
                <img className="avatar avatar-xl" src={friend.avatar} alt="" />
              ) : (
                <div className="avatar avatar-xl">{(friend.username || '?')[0].toUpperCase()}</div>
              )}
              <div className={`modal-status-dot ${isOnline ? 'online' : ''}`} />
            </div>
            <div className="modal-name">{friend.username}</div>
            <div className="modal-id">@{friend.public_id}</div>
            <div className="modal-status-text">
              {isOnline ? '🟢 В сети' : `Был(а) ${timeSince(friend.last_seen) || 'недавно'}`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
