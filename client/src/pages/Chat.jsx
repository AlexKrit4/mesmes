import { useEffect, useRef, useState, useCallback } from 'react';
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

  // Image viewer (lightbox)
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [fileUploading, setFileUploading] = useState(false);

  // Pending file attachment (preview before send)
  const [pendingFile, setPendingFile] = useState(null);

  // Reply state
  const [replyTo, setReplyTo] = useState(null); // { id, content, sender_id, sender_username, file_url }
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const messagesRef = useRef(null);
  const chatPageRef = useRef(null);
  const inputBarRef = useRef(null);
  const fileInputRef = useRef(null);
  const pinchDistRef = useRef(null);
  const hasInitiallyScrolled = useRef(false);
  const lastTapRef = useRef({ time: 0, msgId: null });

  const scrollToBottomInstant = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    setShowScrollBtn(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 150) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
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
      setTimeout(scrollToBottomInstant, 50);
    };

    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);
    // Set initial height
    handleResize();

    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
    };
  }, [scrollToBottomInstant]);

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
    if (!messages.length) return;
    if (!hasInitiallyScrolled.current) {
      hasInitiallyScrolled.current = true;
      // First load — jump instantly, no fly-through animation
      setTimeout(scrollToBottomInstant, 30);
    } else {
      // New messages: only auto-scroll if already near bottom
      scrollToBottom();
    }
  }, [messages, scrollToBottom, scrollToBottomInstant]);

  // Tell server + service worker we are viewing this chat (suppresses push notifications)
  useEffect(() => {
    const socket = getSocket();
    if (socket) socket.emit('viewing_chat', { friendId: friendIdNum });
    // Notify SW via postMessage (works in TWA where clients.matchAll fails)
    navigator.serviceWorker?.controller?.postMessage({ type: 'VIEWING_CHAT', friendId: friendIdNum });
    // Also handle SW becoming active later
    const onControllerChange = () => {
      navigator.serviceWorker?.controller?.postMessage({ type: 'VIEWING_CHAT', friendId: friendIdNum });
    };
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange);
    return () => {
      const s = getSocket();
      if (s) s.emit('viewing_chat', { friendId: null });
      navigator.serviceWorker?.controller?.postMessage({ type: 'VIEWING_CHAT', friendId: null });
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange);
    };
  }, [friendIdNum]);

  // Close context menu / chat menu on click outside
  useEffect(() => {
    const close = () => { setContextMenu(null); setShowChatMenu(false); };
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

    const onMessageReaction = ({ messageId, reactions }) => {
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, reactions } : m)
      );
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
    socket.on('message_reaction', onMessageReaction);

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
      socket.off('message_reaction', onMessageReaction);
    };
  }, [friendIdNum, me.id]);

  const sendMessage = () => {
    const content = text.trim();
    if (!content && !pendingFile) return;

    // If there's a pending file, upload it first then send
    if (pendingFile) {
      const file = pendingFile;
      setPendingFile(null);
      setText('');
      const currentReplyTo = replyTo;
      setReplyTo(null);
      setFileUploading(true);
      (async () => {
        try {
          const formData = new FormData();
          formData.append('file', file);
          const res = await api.post('/users/messages/file', formData);
          const { file_url } = res.data;
          const socket = getSocket();
          if (socket) socket.emit('send_message', { to: friendIdNum, content, file_url, reply_to_id: currentReplyTo?.id || null });
        } catch (err) {
          console.error('File upload error', err);
        } finally {
          setFileUploading(false);
        }
      })();
      return;
    }

    const socket = getSocket();
    if (!socket) return;

    socket.emit('send_message', { to: friendIdNum, content, reply_to_id: replyTo?.id || null });
    setText('');
    setReplyTo(null);

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

  const autoResize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 6 * 24 + 20) + 'px';
  };

  const reactToMessage = async (messageId, emoji) => {
    try {
      const { data } = await api.post(`/users/messages/${messageId}/react`, { emoji });
      setMessages((prev) =>
        prev.map((m) => m.id === messageId ? { ...m, reactions: data.reactions } : m)
      );
    } catch { /* */ }
    setContextMenu(null);
  };

  const handleDoubleTap = (msgId) => {
    const now = Date.now();
    if (lastTapRef.current.msgId === msgId && now - lastTapRef.current.time < 350) {
      reactToMessage(msgId, '❤️');
      lastTapRef.current = { time: 0, msgId: null };
    } else {
      lastTapRef.current = { time: now, msgId };
    }
  };

  const handleInput = (e) => {
    setText(e.target.value);
    autoResize(e.target);
    const socket = getSocket();
    if (!socket) return;

    socket.emit('typing', { to: friendIdNum });
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('stop_typing', { to: friendIdNum });
    }, 2000);
  };

  const sendFile = async (file) => {
    if (!file || fileUploading) return;
    // Instead of sending immediately, set as pending attachment
    setPendingFile(file);
  };

  // Gear button click — position menu in fixed (viewport) coordinates
  const openContextMenu = (e, msg) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const btnRect = btn.getBoundingClientRect();
    const isOut = msg.sender_id === me.id;
    const MENU_H = isOut ? 126 : 88;
    const MENU_W = 178;
    const VH = window.innerHeight;
    const VW = window.innerWidth;

    // Horizontal: for outgoing, align menu's right edge to gear's right edge;
    // for incoming, align menu's left edge to gear's left edge.
    // Always clamp so the menu stays within the viewport.
    let xProp;
    if (isOut) {
      // Try right-aligning to gear button. If that pushes menu off-left, switch to left-aligning.
      const rightVal = VW - btnRect.right;
      if (rightVal + MENU_W > VW) {
        xProp = { left: Math.max(4, btnRect.left) };
      } else {
        // Also check if menu goes off the left edge (right + MENU_W > VW means left edge < 0)
        const menuLeft = VW - rightVal - MENU_W;
        if (menuLeft < 4) {
          xProp = { left: 4 };
        } else {
          xProp = { right: rightVal };
        }
      }
    } else {
      xProp = { left: Math.max(4, Math.min(btnRect.left, VW - MENU_W - 4)) };
    }

    // Vertical: below button or above if not enough space
    const belowY = btnRect.bottom + 4;
    const aboveY = btnRect.top - MENU_H - 4;
    const fixedTop = belowY + MENU_H <= VH ? belowY : Math.max(4, aboveY);

    setContextMenu({ msgId: msg.id, content: msg.content, xProp, fixedTop, isOut });
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
              {isTyping ? 'печатает...' : isOnline ? 'в сети' : friend?.last_seen ? `был(а) ${timeSince(friend.last_seen)}` : ''}
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
      <div className="messages-area" ref={messagesRef} onScroll={handleMessagesScroll}>
        {messages.length === 0 && (
          <div className="empty-state chat-empty">
            <div className="empty-icon">👋</div>
            <div className="empty-title">Начните переписку!</div>
          </div>
        )}

        {messages.map((msg) => {
          const isOut = msg.sender_id === me.id;
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`message-row ${isOut ? 'out' : 'in'}`}>
              <div className="msg-action-btns">
                <button
                  className="msg-gear-btn"
                  onClick={() => {
                    const replyMsg = {
                      id: msg.id,
                      content: msg.content,
                      sender_id: msg.sender_id,
                      sender_username: msg.sender_id === me.id ? me.username : (friend?.username || '?'),
                      file_url: msg.file_url,
                    };
                    setReplyTo(replyMsg);
                  }}
                  title="Ответить"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
                </button>
                <button
                  className="msg-gear-btn"
                  onClick={(e) => openContextMenu(e, msg)}
                  title="Действия"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.34.07-.69.07-1.08 0-.39-.03-.74-.07-1.08l2.32-1.81c.21-.16.27-.46.13-.7l-2.2-3.81c-.13-.24-.42-.33-.67-.24l-2.73 1.1c-.57-.43-1.18-.8-1.87-1.07L14.5 2.42C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42L9.13 5.29C8.44 5.56 7.83 5.93 7.26 6.36L4.53 5.26c-.25-.09-.54 0-.67.24L1.66 9.31c-.14.24-.08.54.13.7L4.11 11.82C4.07 12.16 4 12.51 4 12.92c0 .39.03.74.07 1.08l-2.32 1.81c-.21.16-.27.46-.13.7l2.2 3.81c.13.24.42.33.67.24l2.73-1.1c.57.43 1.18.8 1.87 1.07l.37 2.87c.04.24.25.42.5.42h4c.25 0 .46-.18.49-.42l.37-2.87c.69-.27 1.3-.64 1.87-1.07l2.73 1.1c.25.09.54 0 .67-.24l2.2-3.81c.14-.24.08-.54-.13-.7l-2.32-1.81z"/></svg>
                </button>
              </div>
              <div className={`message ${isOut ? 'out' : 'in'}`} onClick={() => handleDoubleTap(msg.id)}>
                {msg.reply_to && (
                  <div className="reply-quote" onClick={() => {
                    const el = document.getElementById(`msg-${msg.reply_to.id}`);
                    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-highlight'); setTimeout(() => el.classList.remove('msg-highlight'), 1500); }
                  }}>
                    <div className="reply-quote-name">{msg.reply_to.sender_id === me.id ? 'Вы' : (msg.reply_to.sender_username || 'Пользователь')}</div>
                    <div className="reply-quote-text">{msg.reply_to.file_url ? '🖼️ Изображение' : (msg.reply_to.content || '...')}</div>
                  </div>
                )}
                {msg.file_url && (
                  <img
                    src={msg.file_url}
                    className="msg-image"
                    alt=""
                    onClick={(e) => { e.stopPropagation(); setLightboxSrc(msg.file_url); setLightboxScale(1); }}
                  />
                )}
                {msg.content && <div className="message-text"><Linkify>{msg.content}</Linkify></div>}
                <div className="message-meta">
                  {msg.edited ? <span className="message-edited">ред.</span> : null}
                  <span className="message-time">{formatTime(msg.created_at)}</span>
                  {isOut && (
                    <span className={`message-check ${msg.read_at ? 'read' : ''}`}>
                      {msg.read_at ? '✓✓' : '✓'}
                    </span>
                  )}
                </div>
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div className="reactions-row dm">
                    {Object.entries(msg.reactions).map(([emoji, info]) => (
                      <button
                        key={emoji}
                        className={`reaction-chip${info.me ? ' active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); reactToMessage(msg.id, emoji); }}
                      >
                        <span className="reaction-emoji">{emoji}</span>
                        {info.count > 1 && <span className="reaction-count">{info.count}</span>}
                      </button>
                    ))}
                  </div>
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
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollBtn && (
        <button className="scroll-to-bottom-btn" onClick={scrollToBottomInstant} aria-label="Смотреть последнее сообщение">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
        </button>
      )}

      {/* Context menu — rendered at fixed position outside scroll area */}
      {contextMenu && (
        <>
          <div className="msg-ctx-overlay" onClick={() => setContextMenu(null)} />
          <div
            className={`msg-context-menu${contextMenu.isOut ? '' : ' in-side'}`}
            style={{ position: 'fixed', ...contextMenu.xProp, top: contextMenu.fixedTop }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ctx-reactions-row">
              {['❤️', '👍', '👎', '😂', '😮', '😢'].map((emoji) => (
                <button key={emoji} className="ctx-reaction-btn" onClick={() => reactToMessage(contextMenu.msgId, emoji)}>{emoji}</button>
              ))}
            </div>
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
        </>
      )}

      {/* Reply bar */}
      {replyTo && !editingMsgId && (
        <div className="reply-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, color: 'var(--accent)' }}><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
          <div className="reply-bar-content">
            <div className="reply-bar-name">{replyTo.sender_id === me.id ? 'Вы' : (replyTo.sender_username || 'Пользователь')}</div>
            <div className="reply-bar-text">{replyTo.file_url ? '🖼️ Изображение' : (replyTo.content?.slice(0, 80) || '...')}</div>
          </div>
          <button className="reply-bar-cancel" onClick={() => setReplyTo(null)}>✕</button>
        </div>
      )}

      {/* Edit bar */}
      {editingMsgId && (
        <div className="edit-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <div className="edit-bar-text">Редактирование</div>
          <button className="edit-bar-cancel" onClick={cancelEdit}>✕</button>
        </div>
      )}

      {/* Pending file preview */}
      {pendingFile && (
        <div className="file-preview-bar">
          {pendingFile.type.startsWith('image/') ? (
            <img src={URL.createObjectURL(pendingFile)} alt="" className="file-preview-thumb" />
          ) : (
            <div className="file-preview-name">{pendingFile.name}</div>
          )}
          <button className="file-preview-cancel" onClick={() => setPendingFile(null)}>✕</button>
        </div>
      )}

      {/* Input bar */}
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
          placeholder={editingMsgId ? 'Изменить сообщение...' : 'Сообщение...'}
          value={editingMsgId ? editText : text}
          onChange={editingMsgId
            ? (e) => { setEditText(e.target.value); autoResize(e.target); }
            : handleInput
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              editingMsgId ? saveEdit() : sendMessage();
            }
            if (e.key === 'Escape' && editingMsgId) cancelEdit();
          }}
          onFocus={() => setTimeout(scrollToBottomInstant, 300)}
          rows={1}
        />
        <button
          className="send-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={editingMsgId ? saveEdit : sendMessage}
          disabled={editingMsgId ? !editText.trim() : (!text.trim() && !pendingFile)}
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
      {/* Lightbox image viewer */}
      {lightboxSrc && (
        <div
          className="lightbox-overlay"
          onClick={() => { setLightboxSrc(null); setLightboxScale(1); }}
        >
          <button
            className="lightbox-close"
            onClick={(e) => { e.stopPropagation(); setLightboxSrc(null); setLightboxScale(1); }}
          >✕</button>
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
