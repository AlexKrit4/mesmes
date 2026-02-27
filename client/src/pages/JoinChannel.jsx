import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';

export default function JoinChannel() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/channels/invite/${code}`);
        setChannel(res.data);
        // If already a member, redirect
        if (res.data.is_member) {
          navigate(`/channel/${res.data.id}`, { replace: true });
          return;
        }
      } catch (e) {
        setError('Канал не найден или ссылка недействительна');
      } finally {
        setLoading(false);
      }
    })();
  }, [code, navigate]);

  const handleJoin = async () => {
    if (!channel) return;
    setJoining(true);
    try {
      await api.post(`/channels/${channel.id}/join`);
      navigate(`/channel/${channel.id}`, { replace: true });
    } catch (e) {
      setError('Не удалось присоединиться');
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="page join-page">
        <div className="spinner" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page join-page">
        <div className="join-card">
          <div className="empty-icon">❌</div>
          <div className="empty-title">{error}</div>
          <button className="btn btn-accent" style={{ marginTop: 16 }} onClick={() => navigate('/')}>
            На главную
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page join-page">
      <div className="join-card">
        <div className="modal-avatar-wrap">
          {channel.avatar ? (
            <img className="avatar avatar-xl" src={channel.avatar} alt="" />
          ) : (
            <div className="avatar avatar-xl">📢</div>
          )}
        </div>
        <div className="modal-name">{channel.name}</div>
        {channel.description && (
          <div className="modal-status-text" style={{ marginBottom: 8 }}>{channel.description}</div>
        )}
        <div className="modal-id">{channel.member_count} подписчик{channel.member_count === 1 ? '' : channel.member_count < 5 ? 'а' : 'ов'}</div>
        <button
          className="btn btn-accent"
          style={{ width: '100%', marginTop: 20 }}
          onClick={handleJoin}
          disabled={joining}
        >
          {joining ? 'Присоединяемся...' : 'Присоединиться'}
        </button>
      </div>
    </div>
  );
}
