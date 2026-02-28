import { useNavigate } from 'react-router-dom';

const privileges = [
  {
    icon: '✓',
    title: 'Синяя галочка',
    desc: 'Подтверждённый значок рядом с вашим именем во всех чатах, профилях и списке друзей.',
  },
  {
    icon: '🎞️',
    title: 'GIF-аватар',
    desc: 'Установите анимированный GIF в качестве аватара. Обычные пользователи — только статичные фото.',
  },
  {
    icon: '🖼️',
    title: 'Обои чата',
    desc: 'Выберите собственный фон для каждого чата. Виден только вам — через меню ⋮ → «Настроить фон чата».',
  },
  {
    icon: '👻',
    title: 'Скрытие статуса «в сети»',
    desc: 'Другие не увидят, когда вы были в сети — но вы по-прежнему видите их. Включается в Настройках.',
  },
  {
    icon: '🎬',
    title: 'Видео-истории',
    desc: 'Загружайте видео до 30 секунд на свой профиль. Все могут смотреть — добавлять только Premium.',
  },
];

export default function PremiumPage() {
  const navigate = useNavigate();

  return (
    <div className="premium-page">
      <div className="topbar">
        <button className="topbar-btn" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="topbar-title">mes-premium</span>
        <div style={{ width: 40 }} />
      </div>

      <div className="premium-content">
        <div className="premium-hero">
          <div className="premium-hero-icon">⭐</div>
          <h1 className="premium-hero-title">mes-premium</h1>
          <p className="premium-hero-sub">Раскройте все возможности мессенджера</p>
        </div>

        <div className="premium-privileges">
          {privileges.map((p, i) => (
            <div key={i} className="premium-priv-card">
              <div className="premium-priv-icon">{p.icon}</div>
              <div className="premium-priv-text">
                <div className="premium-priv-title">{p.title}</div>
                <div className="premium-priv-desc">{p.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="premium-cta">
          <p className="premium-cta-text">Для получения Premium обратитесь к администратору мессенджера.</p>
        </div>
      </div>
    </div>
  );
}
