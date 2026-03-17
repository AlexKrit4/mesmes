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



function isImage(fileObj) {
  if (!fileObj) return false;
  return (!isVideo(fileObj) && !isAudio(fileObj)) && (fileObj.type ? fileObj.type.startsWith('image/') : fileObj.url.match(/\.(jpg|jpeg|png|gif|webp)$/i));
}

function isAudio(fileObj) {
  if (!fileObj) return false;
  return (fileObj.type && fileObj.type.startsWith('audio/')) || (fileObj.url && fileObj.url.match(/\.(mp3|wav|ogg|m4a|webm)$/i));
}

function parseFileUrls(file_url) {
  if (!file_url) return [];
  let parsed = [];
  if (file_url.startsWith('[')) {
    try { parsed = JSON.parse(file_url); } catch { return [{url: file_url}]; }
  } else {
    parsed = [file_url];
  }
  return parsed.map(p => typeof p === 'string' ? { url: p, type: p.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' } : p);
}

function isVideo(url) {
  return /\.(mp4|webm|mov|avi|mkv|3gp)$/i.test(url);
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

function dayKey(dateStr) {
  if (!dateStr) return '';
  const d = parseUTC(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDayLabel(dateStr) {
  if (!dateStr) return '';
  const d = parseUTC(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
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

  // Edit state
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editText, setEditText] = useState('');

  // Delete confirm dialog
  const [deleteDialog, setDeleteDialog] = useState(null); // msgId or null
  const [deleteForBoth, setDeleteForBoth] = useState(true);

  // Three-dots menu + remove friend
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [showRemoveFriendConfirm, setShowRemoveFriendConfirm] = useState(false);

  // Chat wallpaper
  const [wallpaper, setWallpaper] = useState(null);
  const wallpaperInputRef = useRef(null);

  // Lightbox with navigation
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [fileUploading, setFileUploading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const audioChunksRef = React.useRef([]);






  // Pending files (multiple, up to 5)
  const [pendingFiles, setPendingFiles] = useState([]);

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
  const anchorScrollRef = useRef(false);
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
        // Fetch wallpaper
        try {
          const wpRes = await api.get(`/users/wallpaper/${friendId}`);
          if (wpRes.data.wallpaper_url) setWallpaper(wpRes.data.wallpaper_url);
        } catch { /* */ }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [friendId, friendIdNum]);

  // Initial scroll: fires once after loading finishes and messages are rendered
  useEffect(() => {
    if (!loading && !hasInitiallyScrolled.current && messages.length) {
      hasInitiallyScrolled.current = true;
      setTimeout(scrollToBottomInstant, 30);
      // Pin bottom for 5 s while media (images/videos) finishes loading
      anchorScrollRef.current = true;
      setTimeout(() => { anchorScrollRef.current = false; }, 5000);
    }
  }, [loading, messages, scrollToBottomInstant]);

  // ResizeObserver: re-scroll to bottom while media (images/videos) loads
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (anchorScrollRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Subsequent messages: auto-scroll if already near bottom
  useEffect(() => {
    if (!hasInitiallyScrolled.current) return;
    scrollToBottom();
  }, [messages, scrollToBottom]);

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
    if (!content && pendingFiles.length === 0) return;

    // If there are pending files, upload them first then send
    if (pendingFiles.length > 0) {
      const files = [...pendingFiles];
      setPendingFiles([]);
      setText('');
      const currentReplyTo = replyTo;
      setReplyTo(null);
      setFileUploading(true);
      (async () => {
        try {
          const formData = new FormData();
          files.forEach(f => formData.append('files', f));
          const res = await api.post('/users/messages/file', formData);
          const { file_url } = res.data;
          const socket = getSocket();
          if (socket) socket.emit('send_message', { to: friendIdNum, content, file_url, reply_to_id: currentReplyTo?.id || null });
        } catch (err) {
          console.error('File upload error', err);
          if (err.response?.status === 413) {
             alert(err.response?.data?.error || 'Размер файла превышает допустимый лимит.');
          } else {
             alert(err.response?.data?.error || 'Ошибка загрузки файла');
          }
          if (err.response?.status === 413) {
             alert(err.response?.data?.error || 'Размер файла превышает допустимый лимит.');
          } else {
             alert(err.response?.data?.error || 'Ошибка загрузки файла');
          }
        } finally {
          setFileUploading(false);
        }
      })();
      const socket = getSocket();
      if (socket) {
        socket.emit('stop_typing', { to: friendIdNum });
        clearTimeout(typingTimeout.current);
      }
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

  const uploadWallpaper = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const formData = new FormData();
    formData.append('wallpaper', file, file.name);
    try {
      const { data } = await api.post(`/users/wallpaper/${friendIdNum}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setWallpaper(data.wallpaper_url);
    } catch (err) {
      alert(err.response?.data?.error || 'Ошибка');
    }
    setShowChatMenu(false);
  };

  const removeWallpaper = async () => {
    try {
      await api.delete(`/users/wallpaper/${friendIdNum}`);
      setWallpaper(null);
    } catch { /* */ }
    setShowChatMenu(false);
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

  const addFiles = (newFiles) => {
    if (!newFiles || fileUploading) return;
    const arr = Array.from(newFiles);
    setPendingFiles(prev => [...prev, ...arr].slice(0, 5));
  };

  const removePendingFile = (idx) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const openLightbox = (urls, startIndex = 0) => {
    setLightboxImages(urls);
    setLightboxIndex(startIndex);
    setLightboxScale(1);
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
        
        {isRecording ? (
          <button className="send-btn" onClick={stopRecording} title="Остановить запись" style={{background: 'red', animation: 'pulse 1s infinite'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
          </button>
        ) : (
          <button className="send-btn" onClick={(e) => {
            if (!text.trim() && pendingFiles.length === 0) {
               e.preventDefault();
               startRecording();
            } else {
               sendMessage();
            }
          }} title={!text.trim() && pendingFiles.length === 0 ? "Голосовое сообщение" : "Отправить"} disabled={fileUploading}>
            {(!text.trim() && pendingFiles.length === 0) ? (
               <svg fill="currentColor" viewBox="0 0 24 24" width="24" height="24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            ) : (
               <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            )}
          </button>
        )}
  
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

      {/* Lightbox with navigation */}
      {lightboxImages.length > 0 && (
        <div
          className="lightbox-overlay"
          onClick={() => { setLightboxImages([]); setLightboxScale(1); }}
        >
          <button
            className="lightbox-close"
            onClick={(e) => { e.stopPropagation(); setLightboxImages([]); setLightboxScale(1); }}
          >✕</button>
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
