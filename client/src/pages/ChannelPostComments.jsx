import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';
import { connectSocket } from '../socket.js';

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

  if (fileUrl.startsWith('[')) {
    try {
      const parsed = JSON.parse(fileUrl);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (typeof entry === 'string' ? { url: entry } : entry))
          .filter((entry) => entry?.url);
      }
    } catch {
      return [{ url: fileUrl }];
    }
  }

  return [{ url: fileUrl }];
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : `${dateStr}Z`;
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ChannelPostComments() {
  const { id, postId } = useParams();
  const channelId = Number(id);
  const messageId = Number(postId);
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');

  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const { data } = await api.get(`/channels/${channelId}/messages/${messageId}/comments`);
      setPost(data.post);
      setComments(Array.isArray(data.comments) ? data.comments : []);
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось загрузить комментарии');
      navigate(`/channel/${channelId}`);
    } finally {
      setLoading(false);
    }
  }, [channelId, messageId, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const socket = connectSocket();
    if (!socket) return;

    const onComment = (comment) => {
      if (comment?.channel_id !== channelId || comment?.message_id !== messageId) return;
      setComments((prev) => {
        if (prev.some((c) => c.id === comment.id)) return prev;
        return [...prev, comment];
      });
    };

    socket.on('channel_post_comment', onComment);
    return () => socket.off('channel_post_comment', onComment);
  }, [channelId, messageId]);

  const postFiles = useMemo(() => parseFileUrls(post?.file_url), [post?.file_url]);

  const sendComment = async () => {
    const content = text.trim();
    if (!content || sending) return;

    setSending(true);
    try {
      const { data } = await api.post(`/channels/${channelId}/messages/${messageId}/comments`, { content });
      setComments((prev) => {
        if (prev.some((c) => c.id === data.id)) return prev;
        return [...prev, data];
      });
      setText('');
    } catch (err) {
      alert(err.response?.data?.error || 'Не удалось отправить комментарий');
    } finally {
      setSending(false);
    }
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
      <div className="topbar chat-topbar">
        <button className="topbar-back" onClick={() => navigate(`/channel/${channelId}`)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="chat-topbar-info">
          <div className="chat-topbar-text">
            <div className="chat-topbar-name">Комментарии</div>
            <div className="chat-topbar-status">Пост #{messageId}</div>
          </div>
        </div>
        <div style={{ width: 40 }} />
      </div>

      <div className="messages-area comments-page-body">
        {post && (
          <div className="comment-post-card">
            <div className="comment-post-header">
              <span>{post.sender_username}</span>
              <span>{formatTime(post.created_at)}</span>
            </div>
            {post.content ? <div className="message-text">{post.content}</div> : null}
            {postFiles.length > 0 && (
              <div className="channel-attachments">
                {postFiles.map((file, index) => (
                  <a key={index} href={file.url} target="_blank" rel="noreferrer" className="channel-file-link">
                    {file.name || 'Открыть вложение'}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {comments.length === 0 ? (
          <div className="empty-state chat-empty">
            <div className="empty-title">Комментариев пока нет</div>
          </div>
        ) : (
          comments.map((comment) => (
            <div className={`comment-item ${comment.user_id === me.id ? 'mine' : ''}`} key={comment.id}>
              <div className="comment-item-head">
                <span>{comment.username}</span>
                <span>{formatTime(comment.created_at)}</span>
              </div>
              <div className="comment-item-content">{comment.content}</div>
            </div>
          ))
        )}
      </div>

      <div className="message-input-bar">
        <textarea
          className="message-input"
          placeholder="Оставить комментарий..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendComment();
            }
          }}
          rows={1}
        />
        <button className="send-btn" onClick={sendComment} disabled={!text.trim() || sending}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  );
}
