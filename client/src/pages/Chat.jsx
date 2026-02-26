import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, getSocket } from '../socket.js';

function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function timeSince(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
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
  const [contextMenu, setContextMenu] = useState(null); // { msgId, x, y }
  const [showFriendProfile, setShowFriendProfile] = useState(false);

  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);
  const messagesRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

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

  // Close context menu on any tap/click outside
  useEffect(() => {
    const close = () => setContextMenu(null);
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

    const onPresence = ({ userId, online }) => {
      if (userId === friendIdNum) setIsOnline(online);
    };

    const onMessageDeleted = ({ messageId }) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    };

    socket.on('new_message', onNewMsg);
    socket.on('message_sent', onSent);
    socket.on('user_typing', onTyping);
    socket.on('user_stop_typing', onStopTyping);
    socket.on('presence', onPresence);
    socket.on('message_deleted', onMessageDeleted);

    return () => {
      socket.off('new_message', onNewMsg);
      socket.off('message_sent', onSent);
      socket.off('user_typing', onTyping);
      socket.off('user_stop_typing', onStopTyping);
      socket.off('presence', onPresence);
      socket.off('message_deleted', onMessageDeleted);
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

  const deleteMessage = async (msgId) => {
    try {
      await api.delete(`/users/messages/${msgId}`);
      const socket = getSocket();
      if (socket) {
        socket.emit('delete_message', { messageId: msgId, friendId: friendIdNum });
      }
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    } catch (err) {
      console.error('Delete failed', err);
    }
    setContextMenu(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
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
    if (msg.sender_id !== me.id) return; // only own messages
    e.preventDefault();
    e.stopPropagation();
    const rect = messagesRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    setContextMenu({
      msgId: msg.id,
      x: (e.touches ? e.touches[0].clientX : e.clientX) - rect.left,
      y: (e.touches ? e.touches[0].clientY : e.clientY) - rect.top,
    });
  };

  // long press for mobile
  const longPressTimer = useRef(null);
  const handleTouchStart = (e, msg) => {
    longPressTimer.current = setTimeout(() => openContextMenu(e, msg), 500);
  };
  const handleTouchEnd = () => {
    clearTimeout(longPressTimer.current);
  };

  if (loading) {
    return (
      <div className="chat-page">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="chat-page">
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

        {/* Context menu for message deletion */}
        {contextMenu && (
          <div
            className="msg-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="ctx-btn delete" onClick={() => deleteMessage(contextMenu.msgId)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Удалить
            </button>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="message-input-bar">
        <textarea
          className="message-input"
          placeholder="Сообщение..."
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={sendMessage}
          disabled={!text.trim()}
          aria-label="Отправить"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>

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
