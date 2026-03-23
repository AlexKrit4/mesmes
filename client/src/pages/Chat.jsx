import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';
import { connectSocket, getSocket } from '../socket.js';
import SimpleVoiceRecorder from '../components/SimpleVoiceRecorder.jsx';
import CircleVideoMessage from '../components/CircleVideoMessage.jsx';

const RTC_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
const PENDING_INCOMING_CALL_KEY = 'pending_incoming_call';

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



const VIDEO_EXT_RE = /\.(mp4|webm|mov|avi|mkv|3gp)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a)$/i;
const IMAGE_EXT_RE = /\.(jpg|jpeg|png|gif|webp)$/i;
const VOICE_HINT_RE = /(voice[_-]?\d*|audio[_-]?\d*|record|opus)/i;
const CIRCLE_VIDEO_HINT_RE = /(video[_-]?circle|ch_video_circle|circle[_-]?video|videonote|video_note|round)/i;

function getFileType(fileObj) {
  return String((typeof fileObj === 'object' && fileObj?.type) ? fileObj.type : '').toLowerCase();
}

function getFileUrl(fileObj) {
  if (typeof fileObj === 'string') return fileObj;
  return String((typeof fileObj === 'object' && fileObj?.url) ? fileObj.url : '');
}

function getFileName(fileObj) {
  if (typeof fileObj !== 'object' || !fileObj) return '';
  return String(fileObj.name || '');
}

function isLikelyVoiceWebm(fileObj) {
  const type = getFileType(fileObj);
  const url = getFileUrl(fileObj);
  const name = getFileName(fileObj);

  if (type.startsWith('audio/')) return true;
  if (type.startsWith('video/')) {
    return VOICE_HINT_RE.test(name) || VOICE_HINT_RE.test(url);
  }
  return /\.webm$/i.test(url) && (VOICE_HINT_RE.test(name) || VOICE_HINT_RE.test(url));
}

function isVideo(fileObj) {
  if (!fileObj) return false;
  const type = getFileType(fileObj);
  const url = getFileUrl(fileObj);

  if (type.startsWith('audio/')) return false;
  if (type.startsWith('video/')) return !isLikelyVoiceWebm(fileObj);
  if (!url) return false;

  return VIDEO_EXT_RE.test(url) && !isLikelyVoiceWebm(fileObj);
}
function isCircleVideo(fileObj) {
  if (!fileObj || !isVideo(fileObj)) return false;
  const url = getFileUrl(fileObj);
  const name = getFileName(fileObj);
  return CIRCLE_VIDEO_HINT_RE.test(url) || CIRCLE_VIDEO_HINT_RE.test(name);
}

function isAudio(fileObj) {
  if (!fileObj) return false;
  const type = getFileType(fileObj);
  const url = getFileUrl(fileObj);

  if (type.startsWith('audio/')) return true;
  if (type.startsWith('video/')) return isLikelyVoiceWebm(fileObj);
  if (!url) return false;

  return AUDIO_EXT_RE.test(url) || isLikelyVoiceWebm(fileObj);
}

function isImage(fileObj) {
  if (!fileObj) return false;
  if (typeof fileObj === 'string') return IMAGE_EXT_RE.test(fileObj);
  const type = getFileType(fileObj);
  const url = getFileUrl(fileObj);
  return (!isVideo(fileObj) && !isAudio(fileObj)) && (type ? type.startsWith('image/') : IMAGE_EXT_RE.test(url));
}

function parseFileUrls(fileUrl) {
  if (!fileUrl) return [];

  if (Array.isArray(fileUrl)) {
    return fileUrl
      .map((entry) => (typeof entry === 'string' ? { url: entry } : entry))
      .filter((entry) => entry?.url);
  }

  if (typeof fileUrl === 'object') {
    return fileUrl.url ? [fileUrl] : [];
  }

  if (typeof fileUrl !== 'string') return [];

  let parsed = [];
  if (fileUrl.startsWith('[')) {
    try {
      parsed = JSON.parse(fileUrl);
    } catch {
      return [{ url: fileUrl }];
    }
  } else {
    parsed = [fileUrl];
  }

  return parsed
    .map((entry) => (typeof entry === 'string' ? { url: entry } : entry))
    .filter((entry) => entry?.url);
}

function hasActivePremium(premiumUntil) {
  return !!(premiumUntil && new Date(premiumUntil) > new Date());
}

function getAttachmentLabel(fileUrlValue) {
  const first = parseFileUrls(fileUrlValue)[0];
  if (!first) return '📎 Файл';
  if (isAudio(first)) return '🎤 Голосовое';
  if (isVideo(first)) return '📹 Видео';
  if (isImage(first)) return '🖼️ Изображение';
  return '📎 Файл';
}

function fileTypeStartsWith(file, prefix) {
  return String(file?.type || '').startsWith(prefix);
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

function formatAudioTime(value) {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function VoiceMessagePlayer({ src }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);

  const togglePlay = (e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const onSeek = (e) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    const next = Number(e.target.value);
    audio.currentTime = next;
    setPosition(next);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const onTimeUpdate = () => {
      setPosition(audio.currentTime || 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setPosition(0);
    };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [src]);

  const max = Math.max(duration, 1);
  const value = Math.min(position, max);

  return (
    <div className="voice-msg-player" onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} src={src} preload="metadata" />
      <button className="voice-msg-play" onClick={togglePlay} aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}>
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
      <div className="voice-msg-main">
        <div className="voice-msg-title">Голосовое сообщение</div>
        <input
          type="range"
          className="voice-msg-progress"
          min="0"
          max={max}
          value={value}
          step="0.01"
          onChange={onSeek}
          onClick={(e) => e.stopPropagation()}
        />
        <div className="voice-msg-time">{formatAudioTime(position)} / {formatAudioTime(duration)}</div>
      </div>
    </div>
  );
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
  const [blockState, setBlockState] = useState({ blockedByMe: false, blockedMe: false });
  const [blockActionLoading, setBlockActionLoading] = useState(false);

  // Chat wallpaper
  const [wallpaper, setWallpaper] = useState(null);
  const wallpaperInputRef = useRef(null);

  // Lightbox with navigation
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxScale, setLightboxScale] = useState(1);
  const [fileUploading, setFileUploading] = useState(false);
  const [isPremium, setIsPremium] = useState(hasActivePremium(me?.premium_until));
  const [recordingMode, setRecordingMode] = useState('voice');
  const [showRecorderPanel, setShowRecorderPanel] = useState(true);
  const [callState, setCallState] = useState('idle'); // idle | calling | incoming | connecting | in-call
  const [incomingCall, setIncomingCall] = useState(null); // { from, username, offer }
  const [activeCallPeer, setActiveCallPeer] = useState(null);
  const [callError, setCallError] = useState('');






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
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const activeCallPeerRef = useRef(null);
  const pendingRemoteCandidatesRef = useRef([]);

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
  }, []);

  const closePeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    pendingRemoteCandidatesRef.current = [];
    remoteStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  const resetCallState = useCallback((clearIncoming = true) => {
    closePeerConnection();
    stopLocalStream();
    setActiveCallPeer(null);
    activeCallPeerRef.current = null;
    setCallState('idle');
    if (clearIncoming) setIncomingCall(null);
  }, [closePeerConnection, stopLocalStream]);

  const showCallError = useCallback((msg) => {
    setCallError(msg);
    setTimeout(() => setCallError(''), 3000);
  }, []);

  const ensureLocalAudio = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;
    return stream;
  }, []);

  const createPeerConnection = useCallback((targetUserId, socket) => {
    closePeerConnection();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (!event.candidate || !targetUserId) return;
      socket.emit('call_ice_candidate', { to: targetUserId, candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      const streamTracks = event.streams?.[0]?.getTracks?.() || [];
      const track = streamTracks[0] || event.track || null;
      if (track && !remoteStreamRef.current.getTracks().some((t) => t.id === track.id)) {
        remoteStreamRef.current.addTrack(track);
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStreamRef.current;
      }
      setCallState('in-call');
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connecting') setCallState('connecting');
      if (pc.connectionState === 'connected') setCallState('in-call');
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        resetCallState();
      }
    };

    return pc;
  }, [closePeerConnection, resetCallState]);

  const startVoiceCall = useCallback(async () => {
    if (callState !== 'idle' || hasBlock || !friendIdNum) return;
    const socket = getSocket();
    if (!socket) return;

    try {
      setCallError('');
      const stream = await ensureLocalAudio();
      const pc = createPeerConnection(friendIdNum, socket);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      activeCallPeerRef.current = friendIdNum;
      setActiveCallPeer(friendIdNum);
      setCallState('calling');
      socket.emit('call_offer', { to: friendIdNum, offer });
    } catch (err) {
      console.error('Call start error:', err);
      showCallError('Не удалось начать звонок');
      resetCallState();
    }
  }, [callState, createPeerConnection, ensureLocalAudio, friendIdNum, hasBlock, resetCallState, showCallError]);

  const rejectIncomingCall = useCallback(() => {
    const socket = getSocket();
    if (socket && incomingCall?.from) {
      socket.emit('call_reject', { to: incomingCall.from, reason: 'rejected' });
    }
    setIncomingCall(null);
    setCallState('idle');
  }, [incomingCall]);

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall?.from || !incomingCall?.offer) return;
    const socket = getSocket();
    if (!socket) return;

    try {
      setCallError('');
      const stream = await ensureLocalAudio();
      const peerId = incomingCall.from;
      const pc = createPeerConnection(peerId, socket);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      for (const candidate of pendingRemoteCandidatesRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingRemoteCandidatesRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      activeCallPeerRef.current = peerId;
      setActiveCallPeer(peerId);
      setIncomingCall(null);
      setCallState('connecting');
      socket.emit('call_answer', { to: peerId, answer });
    } catch (err) {
      console.error('Accept call error:', err);
      showCallError('Не удалось принять звонок');
      resetCallState();
    }
  }, [incomingCall, ensureLocalAudio, createPeerConnection, showCallError, resetCallState]);

  const endCall = useCallback((notify = true) => {
    const socket = getSocket();
    const peerId = activeCallPeerRef.current || incomingCall?.from;
    if (notify && socket && peerId) {
      socket.emit('call_end', { to: peerId });
    }
    resetCallState();
  }, [incomingCall, resetCallState]);

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

  const loadBlockState = useCallback(async () => {
    try {
      const { data } = await api.get(`/users/blocks/${friendIdNum}`);
      setBlockState({ blockedByMe: !!data?.blockedByMe, blockedMe: !!data?.blockedMe });
    } catch {
      setBlockState({ blockedByMe: false, blockedMe: false });
    }
  }, [friendIdNum]);

  const hasBlock = blockState.blockedByMe || blockState.blockedMe;
  const blockedBannerText = blockState.blockedByMe
    ? 'Вы заблокировали пользователя'
    : (blockState.blockedMe ? 'Вы были заблокированы для этого пользователя' : '');

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
        const [friendRes, msgsRes, meRes] = await Promise.all([
          api.get('/users/friends'),
          api.get(`/users/messages/${friendId}`),
          api.get('/users/me').catch(() => ({ data: {} })),
        ]);
        const friends = friendRes.data;
        const f = friends.find((x) => x.id === friendIdNum);
        setFriend(f || { id: friendIdNum, username: '?', public_id: '?' });
        setMessages(msgsRes.data);
        setIsPremium(hasActivePremium(meRes?.data?.premium_until));
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

  useEffect(() => {
    loadBlockState();
  }, [loadBlockState]);

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

    const onChatError = ({ msg }) => {
      if (msg) alert(msg);
    };

    const onBlockStatusChanged = ({ by, target }) => {
      if ((by === friendIdNum && target === me.id) || (by === me.id && target === friendIdNum)) {
        loadBlockState();
      }
    };

    const onCallAnswer = async ({ from, answer }) => {
      if (!answer || from !== activeCallPeerRef.current || !peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        for (const candidate of pendingRemoteCandidatesRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingRemoteCandidatesRef.current = [];
        setCallState('connecting');
      } catch (err) {
        console.error('Call answer error:', err);
        showCallError('Ошибка соединения');
        resetCallState();
      }
    };

    const onCallIceCandidate = async ({ from, candidate }) => {
      const isCurrentPeer = from === activeCallPeerRef.current || from === incomingCall?.from;
      if (!candidate || !isCurrentPeer || !peerConnectionRef.current) return;
      try {
        if (peerConnectionRef.current.remoteDescription?.type) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          pendingRemoteCandidatesRef.current.push(candidate);
        }
      } catch (err) {
        console.error('ICE candidate error:', err);
      }
    };

    const onCallReject = ({ from, reason }) => {
      if (from !== activeCallPeerRef.current && from !== friendIdNum) return;
      const text = reason === 'busy' ? 'Пользователь занят' : 'Звонок отклонён';
      showCallError(text);
      resetCallState();
    };

    const onCallEnd = ({ from }) => {
      if (from !== activeCallPeerRef.current && from !== friendIdNum) return;
      showCallError('Звонок завершён');
      resetCallState();
    };

    const onCallUnavailable = ({ to }) => {
      if (to !== friendIdNum) return;
      showCallError('Пользователь не в сети');
      resetCallState();
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
    socket.on('chat_error', onChatError);
    socket.on('chat_block_status_changed', onBlockStatusChanged);
    socket.on('call_answer', onCallAnswer);
    socket.on('call_ice_candidate', onCallIceCandidate);
    socket.on('call_reject', onCallReject);
    socket.on('call_end', onCallEnd);
    socket.on('call_unavailable', onCallUnavailable);

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
      socket.off('chat_error', onChatError);
      socket.off('chat_block_status_changed', onBlockStatusChanged);
      socket.off('call_answer', onCallAnswer);
      socket.off('call_ice_candidate', onCallIceCandidate);
      socket.off('call_reject', onCallReject);
      socket.off('call_end', onCallEnd);
      socket.off('call_unavailable', onCallUnavailable);
    };
  }, [friendIdNum, incomingCall, loadBlockState, me.id, resetCallState, showCallError]);

  useEffect(() => {
    activeCallPeerRef.current = activeCallPeer;
  }, [activeCallPeer]);

  useEffect(() => {
    return () => {
      endCall(false);
    };
  }, [endCall]);

  useEffect(() => {
    let parsed = null;
    try {
      const raw = sessionStorage.getItem(PENDING_INCOMING_CALL_KEY);
      if (!raw) return;
      parsed = JSON.parse(raw);
    } catch {
      sessionStorage.removeItem(PENDING_INCOMING_CALL_KEY);
      return;
    }

    if (!parsed?.from || !parsed?.offer || Number(parsed.from) !== friendIdNum) return;

    sessionStorage.removeItem(PENDING_INCOMING_CALL_KEY);
    setIncomingCall({
      from: parsed.from,
      username: parsed.username || friend?.username || 'Пользователь',
      offer: parsed.offer,
    });
    setCallState('incoming');

    if (parsed.autoAccept) {
      setTimeout(() => {
        connectSocket();
        acceptIncomingCall();
      }, 80);
    }
  }, [acceptIncomingCall, friend?.username, friendIdNum]);

  const onSendVoice = async (blob, mode, duration) => {
    try {
      const formData = new FormData();
      const extension = mode === 'video' ? 'webm' : 'webm';
      const mime = mode === 'video' ? 'video/webm' : 'audio/webm';
      const file = new File([blob], `${mode}_${Date.now()}.${extension}`, { type: mime });
      formData.append('voiceCircle', file);
      formData.append('receiverId', String(friendIdNum));
      formData.append('duration', duration);
      const res = await api.post('/users/voice-circles/file', formData);
      const { file_url } = res.data;
      
      const socket = getSocket();
      if (socket) {
        socket.emit('send_message', { to: friendIdNum, content: '', file_url, reply_to_id: null });
        scrollToBottomInstant();
      }
    } catch (err) {
      console.error('Voice upload error:', err);
      alert(err.response?.data?.error || 'Ошибка отправки голосового/видеосообщения');
    }
  };

  const sendMessage = () => {
    if (hasBlock) return;
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

  const blockUser = async () => {
    if (blockActionLoading) return;
    setBlockActionLoading(true);
    try {
      await api.post(`/users/blocks/${friendIdNum}`);
      setBlockState((prev) => ({ ...prev, blockedByMe: true }));
      setShowChatMenu(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось заблокировать пользователя');
    } finally {
      setBlockActionLoading(false);
    }
  };

  const unblockUser = async () => {
    if (blockActionLoading) return;
    setBlockActionLoading(true);
    try {
      await api.delete(`/users/blocks/${friendIdNum}`);
      setBlockState((prev) => ({ ...prev, blockedByMe: false }));
      setShowChatMenu(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось разблокировать пользователя');
    } finally {
      setBlockActionLoading(false);
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
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions: data.reactions } : m));
    } catch { /* */ }
    setContextMenu(null);
  };

  const pinMessage = async (messageId) => {
    try {
      const msgInfo = messages.find(m => m.id === messageId);
      const isCurrentlyPinned = msgInfo && msgInfo.is_pinned === 1;
      const action = isCurrentlyPinned ? 'unpin' : 'pin';
      const { data } = await api.post(`/users/messages/${messageId}/pin`, { action });
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, is_pinned: data.is_pinned } : m));
    } catch (err) { console.error('Pin check error:', err); }
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
    if (hasBlock) return;
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
        <button className="topbar-back" onClick={() => navigate('/')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="chat-topbar-info" onClick={() => friend?.public_id ? navigate(`/${friend.public_id}`) : null} style={{ cursor: 'pointer' }}>
          {friend?.avatar ? (
            <img className="avatar avatar-topbar" src={friend.avatar} alt="" />
          ) : (
            <div className="avatar avatar-topbar">{(friend?.username || '?')[0].toUpperCase()}</div>
          )}
          <div className="chat-topbar-text">
            <div className="chat-topbar-name">
              {friend?.username || '...'}
              {friend?.premium_until && new Date(friend.premium_until) > new Date() && <span className="premium-badge" title="mes-premium">✓</span>}
            </div>
            <div className={`chat-topbar-status ${isOnline ? 'online' : ''}`}>
              {isTyping ? 'печатает...' : isOnline ? 'в сети' : (friend?.hide_last_seen && friend?.premium_until && new Date(friend.premium_until) > new Date()) ? '' : friend?.last_seen ? `был(а) ${timeSince(friend.last_seen)}` : ''}
            </div>
          </div>
        </div>
        <button
          className="topbar-btn"
          onClick={startVoiceCall}
          disabled={hasBlock || !isOnline || ['calling', 'connecting', 'in-call'].includes(callState)}
          title="Позвонить"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.466 15.466 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.85 21 3 13.15 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z"/></svg>
        </button>
        {/* Three-dots menu */}
        <div className="chat-menu-wrap">
          <button className="topbar-btn" onClick={(e) => { e.stopPropagation(); setShowChatMenu((v) => !v); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
          </button>
          {showChatMenu && (
            <div className="chat-dropdown" onClick={(e) => e.stopPropagation()}>
              <button className="chat-dropdown-item" onClick={() => {
                const meData = JSON.parse(localStorage.getItem('me') || '{}');
                const hasPremium = meData.premium_until && new Date(meData.premium_until) > new Date();
                if (!hasPremium) { alert('Обои чата доступны только с mes-premium'); setShowChatMenu(false); return; }
                wallpaperInputRef.current?.click();
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                Настроить фон чата
              </button>
              {wallpaper && (
                <button className="chat-dropdown-item" onClick={removeWallpaper}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Убрать фон
                </button>
              )}
              {blockState.blockedByMe ? (
                <button className="chat-dropdown-item" onClick={unblockUser} disabled={blockActionLoading}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16v-2a4 4 0 0 0-4-4H8"/><path d="M3 8v2a4 4 0 0 0 4 4h9"/><polyline points="17 1 21 5 17 9"/><polyline points="7 23 3 19 7 15"/></svg>
                  Разблокировать пользователя
                </button>
              ) : (
                <button className="chat-dropdown-item danger" onClick={blockUser} disabled={blockActionLoading}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><line x1="5" y1="19" x2="19" y2="5"/></svg>
                  Заблокировать пользователя
                </button>
              )}
              <button className="chat-dropdown-item danger" onClick={() => { setShowChatMenu(false); setShowRemoveFriendConfirm(true); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                Удалить из друзей
              </button>
            </div>
          )}
        </div>
        <input type="file" accept="image/jpeg,image/png,image/webp" ref={wallpaperInputRef} style={{ display: 'none' }} onChange={uploadWallpaper} />
      </div>

      {(callState !== 'idle' || callError) && (
        <div className="call-panel">
          {callState === 'incoming' && incomingCall ? (
            <>
              <div className="call-panel-title">Входящий звонок от {incomingCall.username}</div>
              <div className="call-panel-actions">
                <button className="call-btn-accept" onClick={acceptIncomingCall}>Принять</button>
                <button className="call-btn-decline" onClick={rejectIncomingCall}>Отклонить</button>
              </div>
            </>
          ) : callState === 'calling' ? (
            <>
              <div className="call-panel-title">Звоним {friend?.username || 'пользователю'}…</div>
              <div className="call-panel-actions">
                <button className="call-btn-decline" onClick={() => endCall(true)}>Сбросить</button>
              </div>
            </>
          ) : callState === 'connecting' ? (
            <>
              <div className="call-panel-title">Соединяем звонок…</div>
              <div className="call-panel-actions">
                <button className="call-btn-decline" onClick={() => endCall(true)}>Завершить</button>
              </div>
            </>
          ) : callState === 'in-call' ? (
            <>
              <div className="call-panel-title">Идёт звонок с {friend?.username || 'пользователем'}</div>
              <div className="call-panel-actions">
                <button className="call-btn-decline" onClick={() => endCall(true)}>Завершить</button>
              </div>
            </>
          ) : null}
          {callError && <div className="call-panel-error">{callError}</div>}
        </div>
      )}

      {/* Pinned message bar */}
      {(() => {
        const pinned = messages.filter(m => m.is_pinned === 1);
        const topPinned = pinned[pinned.length - 1]; // Show most recent pinned
        if (!topPinned) return null;
        return (
          <div className="pinned-message-bar" onClick={() => {
            const el = document.getElementById(`msg-${topPinned.id}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('msg-highlight');
              setTimeout(() => el.classList.remove('msg-highlight'), 1500);
            }
          }}>
            <div className="pinned-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
            </div>
            <div className="pinned-content">
              <div className="pinned-title">Закрепленное сообщение</div>
              <div className="pinned-text">{topPinned.file_url ? 'Вложение' : (topPinned.content || '...')}</div>
            </div>
            <button className="pinned-close" onClick={(e) => { e.stopPropagation(); pinMessage(topPinned.id); }} title="Открепить">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        );
      })()}

      {/* Messages */}
      <div
        className="messages-area"
        ref={messagesRef}
        onScroll={handleMessagesScroll}
        style={wallpaper ? { backgroundImage: `url(${wallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        {messages.length === 0 && (
          <div className="empty-state chat-empty">
            <div className="empty-icon">👋</div>
            <div className="empty-title">Начните переписку!</div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isOut = msg.sender_id === me.id;
          const urls = parseFileUrls(msg.file_url);
          const hasOnlyCircleVideo = urls.length === 1 && isCircleVideo(urls[0]) && !msg.content && !msg.reply_to;
          const showDay = idx === 0 || dayKey(msg.created_at) !== dayKey(messages[idx - 1].created_at);
          return (
            <React.Fragment key={msg.id}>
              {showDay && (
                <div className="day-separator"><span>{formatDayLabel(msg.created_at)}</span></div>
              )}
              <div id={`msg-${msg.id}`} className={`message-row ${isOut ? 'out' : 'in'}`}>
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
              <div className={`message ${isOut ? 'out' : 'in'}${hasOnlyCircleVideo ? ' message-circle-only' : ''}`} onClick={() => handleDoubleTap(msg.id)}>
                {msg.is_pinned === 1 && (
                  <div className="pinned-indicator" style={{ fontSize: '12px', color: 'var(--accent)', marginBottom: '4px', display: 'flex', alignItems: 'center' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '4px'}}><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
                    Закрепленное сообщение
                  </div>
                )}
                {msg.reply_to && (
                  <div className="reply-quote" onClick={() => {
                    const el = document.getElementById(`msg-${msg.reply_to.id}`);
                    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('msg-highlight'); setTimeout(() => el.classList.remove('msg-highlight'), 1500); }
                  }}>
                    <div className="reply-quote-name">{msg.reply_to.sender_id === me.id ? 'Вы' : (msg.reply_to.sender_username || 'Пользователь')}</div>
                    <div className="reply-quote-text">{msg.reply_to.file_url ? getAttachmentLabel(msg.reply_to.file_url) : (msg.reply_to.content || '...')}</div>
                  </div>
                )}
                {urls.map((fileObj, i) => {
                  if (isAudio(fileObj)) {
                    return <VoiceMessagePlayer key={i} src={fileObj.url} />;
                  } else if (isVideo(fileObj)) {
                                        if (isCircleVideo(fileObj)) {
                                          return <CircleVideoMessage key={i} src={fileObj.url} onLoadedMetadata={scrollToBottomInstant} />;
                                        }
                    return <video key={i} src={fileObj.url} className="msg-video" controls playsInline onClick={e => e.stopPropagation()} onLoadedMetadata={scrollToBottomInstant} style={{maxWidth: '100%', borderRadius: '8px'}} />;
                  } else if (isImage(fileObj)) {
                    return <img key={i} src={fileObj.url} onLoad={scrollToBottomInstant} className="msg-image" alt="" onClick={(e) => {
                      e.stopPropagation();
                      const imgUrls = urls.filter(isImage).map(u => u.url);
                      openLightbox(imgUrls, imgUrls.indexOf(fileObj.url));
                    }} style={{maxWidth: '100%', borderRadius: '8px', cursor: 'pointer', display: 'block', marginBottom: urls.length > 1 ? '5px' : 0}} />;
                  } else {
                    return <a key={i} href={fileObj.url} download target="_blank" rel="noopener noreferrer" className="msg-file-link" onClick={e => e.stopPropagation()} style={{display: 'flex', alignItems: 'center', padding: '10px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', textDecoration: 'none', color: 'inherit', marginBottom: '5px'}}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{marginRight: '10px'}}><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                      <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{fileObj.name || (fileObj.url ? fileObj.url.split('/').pop() : 'Файл')}</span>
                    </a>;
                  }
                })}
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
            </React.Fragment>
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
            <button className="ctx-btn" onClick={() => pinMessage(contextMenu.msgId)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
              {(() => {
                 const msgInfo = messages.find(m => m.id === contextMenu.msgId);
                 return msgInfo && msgInfo.is_pinned === 1 ? 'Открепить' : 'Закрепить';
              })()}
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
            <div className="reply-bar-text">{replyTo.file_url ? getAttachmentLabel(replyTo.file_url) : (replyTo.content?.slice(0, 80) || '...')}</div>
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

      {/* Pending files preview */}
      {pendingFiles.length > 0 && (
        <div className="file-preview-bar multi">
          {pendingFiles.map((f, i) => (
            <div key={i} className="file-preview-item">
              {fileTypeStartsWith(f, 'image/') ? (
                <img src={URL.createObjectURL(f)} alt="" className="file-preview-thumb" />
              ) : fileTypeStartsWith(f, 'video/') ? (
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

      {/* Input bar */}
      {hasBlock ? (
        <div className="chat-blocked-banner">
          <span className="chat-blocked-text">{blockedBannerText}</span>
          {blockState.blockedByMe && (
            <button
              className="chat-blocked-action"
              onClick={unblockUser}
              disabled={blockActionLoading}
            >
              Разблокировать
            </button>
          )}
        </div>
      ) : (
        <div className="message-input-bar">
          <input
            type="file"
            accept="*/*"
            multiple
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; }}
          />

          <>
              <button
                className="attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={fileUploading}
                title="Прикрепить файл"
              >
                {fileUploading
                  ? <span className="attach-spinner" />
                  : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                }
              </button>
              {isPremium && showRecorderPanel && (
                <>
                  <button
                    className="record-mode-btn"
                    type="button"
                    onClick={() => setRecordingMode((prev) => (prev === 'voice' ? 'video' : 'voice'))}
                    title={recordingMode === 'voice' ? 'Режим: голос' : 'Режим: видеосообщение'}
                    aria-label={recordingMode === 'voice' ? 'Переключить на видео' : 'Переключить на голос'}
                  >
                    {recordingMode === 'voice' ? '🎤' : '🎥'}
                  </button>
                  <SimpleVoiceRecorder
                    mode={recordingMode}
                    onSend={onSendVoice}
                    onCancel={() => {}}
                  />
                </>
              )}
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
                onFocus={() => {
                  setShowRecorderPanel(false);
                  setTimeout(scrollToBottomInstant, 300);
                }}
                onBlur={() => setShowRecorderPanel(true)}
                rows={1}
              />
              <button
                className="send-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  if (editingMsgId) {
                    saveEdit();
                  } else {
                    sendMessage();
                  }
                }}
                disabled={editingMsgId ? !editText.trim() : (fileUploading || (!text.trim() && pendingFiles.length === 0))}
                aria-label={editingMsgId ? 'Сохранить' : 'Отправить'}
              >
                {editingMsgId ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                )}
              </button>
            </>
        </div>
      )}

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

      <audio ref={remoteAudioRef} autoPlay playsInline />
    </div>
  );
}
