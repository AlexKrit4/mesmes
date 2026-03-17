import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api.js';
import AvatarCropModal from '../AvatarCropModal.jsx';

function parseUTC(dateStr) {
  if (!dateStr) return null;
  const s = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  return new Date(s);
}

function timeSince(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - parseUTC(dateStr).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} дн назад`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return parseUTC(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Profile() {
  const { publicId } = useParams();
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || '{}');
  const fileInputRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  // Edit fields
  const [editName, setEditName] = useState('');
  const [editPublicId, setEditPublicId] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  // Rate limit info
  const [idRateLimitHours, setIdRateLimitHours] = useState(0);
  const [phoneRateLimitDays, setPhoneRateLimitDays] = useState(0);

  // Avatar crop
  const [cropFile, setCropFile] = useState(null);

  // Reports
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('Аватарка');
  const [reportComment, setReportComment] = useState('');
  const [reportMsg, setReportMsg] = useState(null);
  const [isReporting, setIsReporting] = useState(false);

  // Avatar lightbox
  const [avatarLightbox, setAvatarLightbox] = useState(false);
  const [lightboxScale, setLightboxScale] = useState(1);
  const pinchDistRef = useRef(null);

  // Stories
  const [stories, setStories] = useState([]);
  const [storyPlaying, setStoryPlaying] = useState(null); // story object or null
  const storyInputRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    api.get(`/users/profile/${publicId}`).then(({ data }) => {
      setProfile(data);
      setEditName(data.username || '');
      setEditPublicId(data.public_id || '');
      setEditBio(data.bio || '');
      setEditPhone(data.phone || '');

      // Rate limits for own profile
      if (data.isMe) {
        if (data.last_public_id_change) {
          const diff = Date.now() - parseUTC(data.last_public_id_change).getTime();
          if (diff < 24 * 60 * 60 * 1000) setIdRateLimitHours(Math.ceil((24 * 60 * 60 * 1000 - diff) / 3600000));
        }
        if (data.last_phone_change) {
          const diff = Date.now() - parseUTC(data.last_phone_change).getTime();
          if (diff < 30 * 24 * 60 * 60 * 1000) setPhoneRateLimitDays(Math.ceil((30 * 24 * 60 * 60 * 1000 - diff) / 86400000));
        }
      }

      // Fetch stories
      api.get(`/users/stories/${data.id}`).then(r => setStories(r.data)).catch(() => {});
    }).catch(() => {
      setProfile(null);
    }).finally(() => setLoading(false));
  }, [publicId]);

  const onFileSelected = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    // GIF: check premium, upload directly (no crop)
    if (file.type === 'image/gif') {
      const myPremium = profile.premium_until && new Date(profile.premium_until) > new Date();
      if (!myPremium) {
        setMsg('GIF-аватар доступен только с mes-premium');
        return;
      }
      uploadGifAvatar(file);
      return;
    }
    setCropFile(file);
  };

  const uploadGifAvatar = async (file) => {
    const formData = new FormData();
    formData.append('avatar', file, file.name);
    try {
      const { data } = await api.post('/users/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setProfile((p) => ({ ...p, avatar: data.avatar }));
      const meData = JSON.parse(localStorage.getItem('me') || '{}');
      meData.avatar = data.avatar;
      localStorage.setItem('me', JSON.stringify(meData));
    } catch (err) {
      setMsg(err.response?.data?.error || 'Ошибка загрузки');
    }
  };

  const uploadCroppedAvatar = async (blob) => {
    setCropFile(null);
    const formData = new FormData();
    formData.append('avatar', blob, 'avatar.jpg');
    try {
      const { data } = await api.post('/users/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setProfile((p) => ({ ...p, avatar: data.avatar }));
      const meData = JSON.parse(localStorage.getItem('me') || '{}');
      meData.avatar = data.avatar;
      localStorage.setItem('me', JSON.stringify(meData));
    } catch { /* */ }
  };

  const uploadStory = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const formData = new FormData();
    formData.append('video', file, file.name);
    try {
      const { data } = await api.post('/users/stories', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setStories(prev => [data, ...prev]);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Ошибка загрузки истории');
    }
  };

  const deleteStory = async (storyId) => {
    try {
      await api.delete(`/users/stories/${storyId}`);
      setStories(prev => prev.filter(s => s.id !== storyId));
      if (storyPlaying?.id === storyId) setStoryPlaying(null);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Ошибка удаления');
    }
  };

  const handleReport = async () => {
    if (!reportReason) return;
    setIsReporting(true);
    setReportMsg(null);
    try {
      await api.post('/users/report', {
        reported_id: profile.id,
        reason: reportReason,
        comment: reportComment
      });
      setReportMsg({ type: 'success', text: 'Жалоба успешно отправлена' });
      setTimeout(() => {
        setShowReportModal(false);
        setReportMsg(null);
        setReportComment('');
      }, 2000);
    } catch (err) {
      setReportMsg({ type: 'error', text: err.response?.data?.error || 'Ошибка при отправке жалобы' });
    } finally {
      setIsReporting(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    setMsg('');
    try {
      const payload = {};
      if (editName.trim() && editName.trim() !== profile.username) payload.username = editName.trim();
      if (editPublicId.trim() && editPublicId.trim() !== profile.public_id) payload.public_id = editPublicId.trim();
      if (editBio !== (profile.bio || '')) payload.bio = editBio;
      if (editPhone !== (profile.phone || '')) payload.phone = editPhone;

      if (Object.keys(payload).length === 0) {
        setEditing(false);
        return;
      }

      const { data } = await api.patch('/users/me', payload);

      // Update local storage
      const meData = JSON.parse(localStorage.getItem('me') || '{}');
      if (data.username) meData.username = data.username;
      if (data.public_id) meData.public_id = data.public_id;
      localStorage.setItem('me', JSON.stringify(meData));

      // Refresh profile
      const refreshed = await api.get(`/users/profile/${data.public_id || profile.public_id}`);
      setProfile(refreshed.data);
      setEditing(false);

      // If public_id changed, navigate to new URL
      if (data.public_id && data.public_id !== publicId) {
        navigate(`/${data.public_id}`, { replace: true });
      }

      setMsg('✓ Сохранено');
      setTimeout(() => setMsg(''), 3000);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const sendFriendRequest = async () => {
    try {
      await api.post('/users/friend-request', { public_id: profile.public_id });
      setMsg('✓ Заявка отправлена');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Ошибка');
    }
  };

  if (loading) {
    return (
      <div className="profile-page">
        <div className="topbar">
          <button className="topbar-btn" onClick={() => navigate(-1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="topbar-title">Профиль</span>
          <div style={{ width: 40 }} />
        </div>
        <div className="spinner" style={{ marginTop: 80 }} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="profile-page">
        <div className="topbar">
          <button className="topbar-btn" onClick={() => navigate(-1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span className="topbar-title">Профиль</span>
          <div style={{ width: 40 }} />
        </div>
        <div className="empty-state" style={{ marginTop: 60 }}>
          <div className="empty-icon">🤷</div>
          <div className="empty-title">Пользователь не найден</div>
        </div>
      </div>
    );
  }

  const isMe = profile.isMe;

  return (
    <div className="profile-page">
      <div className="topbar">
        <button className="topbar-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="topbar-title">{isMe ? 'Мой профиль' : 'Профиль'}</span>
        {isMe && !editing && (
          <button className="topbar-btn" onClick={() => setEditing(true)} title="Редактировать">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        )}
        {isMe && editing && (
          <button className="topbar-btn" onClick={() => { setEditing(false); setMsg(''); }} title="Отменить">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
        {!isMe && <div style={{ width: 40 }} />}
      </div>

      <div className="profile-content">
        {/* Avatar */}
        <div
          className="profile-avatar-wrap"
          onClick={() => {
            if (isMe && editing) { fileInputRef.current?.click(); return; }
            if (profile.avatar) { setAvatarLightbox(true); setLightboxScale(1); }
          }}
          style={{ cursor: (isMe && editing) || profile.avatar ? 'pointer' : 'default' }}
        >
          {isMe && <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={onFileSelected} />}
          {profile.avatar ? (
            <img className="profile-avatar" src={profile.avatar} alt="" />
          ) : (
            <div className="profile-avatar profile-avatar-letter">{(profile.username || '?')[0].toUpperCase()}</div>
          )}
          {isMe && editing && (
            <div className="profile-avatar-overlay">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M3 21h3l12.2-12.2-3-3L3 18v3zM21.7 7.3a1 1 0 000-1.4l-1.6-1.6a1 1 0 00-1.4 0l-1.8 1.8 3 3 1.8-1.8z"/></svg>
            </div>
          )}
          {!editing && profile.avatar && (
            <div className="profile-avatar-view-hint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
            </div>
          )}
        </div>

        {/* Info — view mode */}
        {!editing && (
          <>
            <div className="profile-name">
              {profile.username}
              {profile.premium_until && new Date(profile.premium_until) > new Date() && <span className="premium-badge" title="mes-premium">✓</span>}
              {!isMe && (
                <button 
                  className="report-btn" 
                  onClick={() => setShowReportModal(true)} 
                  title="Пожаловаться"
                  style={{ background: 'none', border: 'none', marginLeft: '8px', cursor: 'pointer', verticalAlign: 'middle', padding: 0 }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="red" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                    <line x1="4" y1="22" x2="4" y2="15"></line>
                  </svg>
                </button>
              )}
            </div>
            <div className="profile-id">@{profile.public_id}</div>
            {profile.bio && <div className="profile-bio">{profile.bio}</div>}

            <div className="profile-meta">
              {!(profile.hide_last_seen && profile.premium_until && new Date(profile.premium_until) > new Date() && !isMe) && (
              <div className="profile-meta-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>Был(а) {timeSince(profile.last_seen)}</span>
              </div>
              )}
              <div className="profile-meta-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>Зарегистрирован {formatDate(profile.created_at)}</span>
              </div>
            </div>

            {/* Actions for other users */}
            {!isMe && (
              <div className="profile-actions">
                {profile.isFriend ? (
                  <button className="btn btn-accent" onClick={() => navigate(`/chat/${profile.id}`)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Написать
                  </button>
                ) : (
                  <button className="btn btn-accent" onClick={sendFriendRequest}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                    Добавить в друзья
                  </button>
                )}
              </div>
            )}

            {/* Stories section */}
            {(stories.length > 0 || isMe) && (
              <div className="profile-stories-section">
                <div className="profile-stories-header">
                  <span className="profile-stories-title">Истории</span>
                  {isMe && (
                    <>
                      <button className="btn btn-sm btn-accent" onClick={() => {
                        const myPremium = profile.premium_until && new Date(profile.premium_until) > new Date();
                        if (!myPremium) { setMsg('Видео-истории доступны только с mes-premium'); return; }
                        storyInputRef.current?.click();
                      }}>+ Добавить</button>
                      <input type="file" accept="video/mp4,video/webm,video/quicktime" ref={storyInputRef} style={{ display: 'none' }} onChange={uploadStory} />
                    </>
                  )}
                </div>
                {stories.length === 0 ? (
                  <div className="profile-stories-empty">Нет историй</div>
                ) : (
                  <div className="profile-stories-grid">
                    {stories.map(s => (
                      <div key={s.id} className="profile-story-card" onClick={() => setStoryPlaying(s)}>
                        <video src={s.video_url} className="profile-story-thumb" muted preload="metadata" />
                        <div className="profile-story-play">▶</div>
                        {isMe && (
                          <button className="profile-story-delete" onClick={(e) => { e.stopPropagation(); deleteStory(s.id); }}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Edit mode */}
        {editing && (
          <div className="profile-edit-form">
            <div className="form-group">
              <label>Имя</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Ваше имя" maxLength={32} />
            </div>

            <div className="form-group">
              <label>Публичный ID</label>
              <input
                value={editPublicId}
                onChange={(e) => setEditPublicId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="your_id"
                maxLength={24}
                disabled={idRateLimitHours > 0}
              />
              {idRateLimitHours > 0 && (
                <div className="hint" style={{ color: 'var(--accent)' }}>ID можно менять раз в сутки. Следующая смена через {idRateLimitHours} ч.</div>
              )}
            </div>

            <div className="form-group">
              <label>О себе</label>
              <textarea
                className="profile-bio-input"
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                placeholder="Расскажите о себе..."
                maxLength={200}
                rows={3}
              />
              <div className="hint">{editBio.length}/200</div>
            </div>

            <div className="form-group">
              <label>Номер телефона</label>
              <div className="phone-input-wrap">
                <span className="phone-prefix">+7</span>
                <input
                  value={editPhone.startsWith('+7') ? editPhone.slice(2) : editPhone.replace(/^[+78]/, '')}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setEditPhone(digits ? '+7' + digits : '');
                  }}
                  placeholder="999 123 45 67"
                  maxLength={10}
                  inputMode="tel"
                  disabled={phoneRateLimitDays > 0 && editPhone === (profile.phone || '')}
                />
              </div>
              <div className="hint" style={{ color: 'var(--text2)' }}>
                {phoneRateLimitDays > 0
                  ? `Номер можно менять раз в 30 дней. Осталось ${phoneRateLimitDays} дн.`
                  : 'По номеру вас смогут найти друзья, а также при входе в аккаунт вы можете указывать номер телефона, вместо ID. Другие пользователи не видят ваш телефон.'
                }
              </div>
            </div>

            <button className="btn btn-accent" onClick={saveProfile} disabled={saving} style={{ marginTop: 8 }}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        )}

        {msg && (
          <p className={`settings-msg ${msg.startsWith('✓') ? 'success' : 'error'}`} style={{ textAlign: 'center', marginTop: 12 }}>{msg}</p>
        )}
      </div>

      {/* Avatar crop modal */}
      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onConfirm={uploadCroppedAvatar}
          onCancel={() => setCropFile(null)}
        />
      )}

      {/* Avatar lightbox */}
      {avatarLightbox && profile.avatar && (
        <div
          className="lightbox-overlay"
          onClick={() => { setAvatarLightbox(false); setLightboxScale(1); }}
        >
          <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setAvatarLightbox(false); setLightboxScale(1); }}>✕</button>
          <img
            src={profile.avatar}
            className="lightbox-img"
            alt=""
            style={{ transform: `scale(${lightboxScale})`, borderRadius: '50%' }}
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
                const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
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

      {/* Story player overlay */}
      {storyPlaying && (
        <div className="lightbox-overlay story-player-overlay" onClick={() => setStoryPlaying(null)}>
          <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setStoryPlaying(null); }}>✕</button>
          <video
            src={storyPlaying.video_url}
            className="story-player-video"
            autoPlay
            controls
            playsInline
            onClick={(e) => e.stopPropagation()}
            onEnded={() => setStoryPlaying(null)}
          />
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="lightbox-overlay" onClick={() => setShowReportModal(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div className="settings-card" onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '20px', borderRadius: '12px', width: '90%', maxWidth: '400px', color: '#000' }}>
            <h3 style={{ marginTop: 0, marginBottom: '15px' }}>Пожаловаться на пользователя</h3>
            
            <div className="settings-field">
              <label>Причина жалобы</label>
              <select 
                value={reportReason} 
                onChange={(e) => setReportReason(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', marginBottom: '15px' }}
              >
                <option value="Аватарка">Неподобающая аватарка</option>
                <option value="Имя">Неподобающее имя / био</option>
                <option value="Спам">Спам / реклама</option>
                <option value="Оскорбление">Оскорбления / травля</option>
                <option value="Мошенничество">Мошенничество</option>
                <option value="Другое">Другое</option>
              </select>
            </div>

            <div className="settings-field">
              <label>Комментарий (опционально)</label>
              <textarea 
                value={reportComment} 
                onChange={(e) => setReportComment(e.target.value)}
                placeholder="Опишите проблему подробнее..."
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', minHeight: '80px', resize: 'vertical' }}
              />
            </div>

            {reportMsg && (
              <div className={`message ${reportMsg.type}`} style={{ padding: '10px', marginTop: '10px', borderRadius: '8px', background: reportMsg.type === 'error' ? '#ffebee' : '#e8f5e9', color: reportMsg.type === 'error' ? '#c62828' : '#2e7d32' }}>
                {reportMsg.text}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => setShowReportModal(false)}
                style={{ flex: 1 }}
                disabled={isReporting}
              >Отмена</button>
              <button 
                className="btn btn-primary" 
                onClick={handleReport}
                style={{ flex: 1, backgroundColor: '#d32f2f' }}
                disabled={isReporting}
              >
                {isReporting ? 'Отправка...' : 'Отправить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
