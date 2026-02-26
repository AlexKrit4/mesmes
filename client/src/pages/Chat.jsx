import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, getSocket } from '../socket.js';

function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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

  const bottomRef = useRef(null);
  const typingTimeout = useRef(null);

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

    socket.on('new_message', onNewMsg);
    socket.on('message_sent', onSent);
    socket.on('user_typing', onTyping);
    socket.on('user_stop_typing', onStopTyping);
    socket.on('presence', onPresence);

    return () => {
      socket.off('new_message', onNewMsg);
      socket.off('message_sent', onSent);
      socket.off('user_typing', onTyping);
      socket.off('user_stop_typing', onStopTyping);
      socket.off('presence', onPresence);
    };
  }, [friendIdNum, me.id]);

  const sendMessage = () => {
    const content = text.trim();
    if (!content) return;

    const socket = getSocket();
    if (!socket) return;

    socket.emit('send_message', { to: friendIdNum, content });
    setText('');

    // Stop typing indicator
    socket.emit('stop_typing', { to: friendIdNum });
    clearTimeout(typingTimeout.current);
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
      <div className="topbar">
        <button className="topbar-back" onClick={() => navigate('/')}>← Назад</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div className="topbar-title">{friend?.username || '...'}</div>
          <div style={{ fontSize: 11, color: isOnline ? 'var(--green)' : 'var(--text2)' }}>
            {isOnline ? 'онлайн' : `@${friend?.public_id || ''}`}
          </div>
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* Messages */}
      <div className="messages-area">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="icon">👋</div>
            <p>Начните переписку!</p>
          </div>
        )}

        {messages.map((msg) => {
          const isOut = msg.sender_id === me.id;
          return (
            <div key={msg.id} className={`message ${isOut ? 'out' : 'in'}`}>
              {msg.content}
              <div className="message-time">
                {formatTime(msg.created_at)}
                {isOut && (
                  <span style={{ marginLeft: 4, color: msg.read_at ? 'var(--accent)' : 'var(--text2)' }}>
                    {msg.read_at ? '✓✓' : '✓'}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="typing-indicator">{friend?.username} печатает...</div>
        )}

        <div ref={bottomRef} />
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
          ➤
        </button>
      </div>
    </div>
  );
}
