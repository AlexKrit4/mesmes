import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api.js';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [me, setMe] = useState(JSON.parse(localStorage.getItem('me') || '{}'));
  const isPaymentReturn = searchParams.get('payment') === 'return';

  const hasPremium = useMemo(
    () => !!(me?.premium_until && new Date(me.premium_until) > new Date()),
    [me]
  );

  const refreshMe = async () => {
    try {
      const { data } = await api.get('/users/me');
      setMe(data);
      localStorage.setItem('me', JSON.stringify(data));
    } catch {}
  };

  useEffect(() => {
    refreshMe();
  }, []);

  useEffect(() => {
    const paymentFlag = searchParams.get('payment');
    const label = searchParams.get('label');
    if (paymentFlag !== 'return' || !label) return;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const confirmPayment = async () => {
      setIsLoading(true);
      setStatusText('Проверяем оплату в ЮMoney...');
      try {
        for (let attempt = 0; attempt < 6; attempt++) {
          const { data } = await api.post('/payments/premium/confirm', { label });
          if (data?.paid) {
            await refreshMe();
            setStatusText('✅ Оплата подтверждена. mes-premium активирован на 1 месяц.');
            const next = new URLSearchParams(searchParams);
            next.delete('payment');
            next.delete('label');
            setSearchParams(next, { replace: true });
            return;
          }

          if (data?.check_error) {
            setStatusText(`Платёж не подтверждён автоматически: ${data.check_error}. Проверь webhook и токен YooMoney.`);
            return;
          }

          if (attempt < 5) {
            setStatusText('Платёж обрабатывается. Проверяем ещё раз...');
            await sleep(5000);
          }
        }

        setStatusText('Платёж ещё обрабатывается. Подождите 10–30 секунд и нажмите «Проверить оплату».');
      } catch (err) {
        if (err.response?.status === 202) {
          setStatusText('Платёж ещё обрабатывается ЮMoney. Нажмите «Проверить оплату» чуть позже.');
        } else {
          setStatusText(err.response?.data?.error || 'Не удалось проверить оплату. Подождите и повторите.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    confirmPayment();
  }, [searchParams, setSearchParams]);

  const startPayment = async () => {
    setIsLoading(true);
    setStatusText('Создаём ссылку оплаты...');
    try {
      const { data } = await api.post('/payments/premium/create');
      if (!data?.payment_url) throw new Error('Ссылка оплаты не получена');
      window.location.href = data.payment_url;
    } catch (err) {
      setStatusText(err.response?.data?.error || err.message || 'Ошибка создания платежа');
      setIsLoading(false);
    }
  };

  const checkPaymentAgain = async () => {
    const label = searchParams.get('label');
    if (!label) {
      setStatusText('Нет идентификатора платежа для проверки. Начните оплату заново.');
      return;
    }
    setIsLoading(true);
    try {
      const { data } = await api.post('/payments/premium/confirm', { label });
      if (data?.paid) {
        await refreshMe();
        setStatusText('✅ Оплата подтверждена. mes-premium активирован.');
      } else if (data?.check_error) {
        setStatusText(`Платёж не подтверждён автоматически: ${data.check_error}. Проверь webhook и токен YooMoney.`);
      } else {
        setStatusText('Платёж ещё не подтверждён. Подождите и проверьте снова.');
      }
    } catch (err) {
      if (err.response?.status === 202) {
        setStatusText('Платёж ещё обрабатывается, попробуйте через несколько секунд.');
      } else {
        setStatusText(err.response?.data?.error || 'Ошибка проверки платежа');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="premium-page">
      <div className="topbar">
        <button className="topbar-btn" onClick={() => (isPaymentReturn ? navigate('/settings') : navigate(-1))}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className="topbar-title">mes-premium</span>
        <div style={{ width: 40 }} />
      </div>

      <div className="premium-content">
        <div className="premium-hero">
          <div className="premium-hero-icon">⭐</div>
          <h1 className="premium-hero-title">mes-premium</h1>
          <p className="premium-hero-sub">50 ₽ / месяц • оплата через ЮMoney</p>
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
          {hasPremium ? (
            <p className="premium-cta-text" style={{ color: 'var(--accent)' }}>
              Premium активен до {new Date(me.premium_until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          ) : (
            <button className="btn btn-accent" onClick={startPayment} disabled={isLoading}>
              {isLoading ? 'Подождите...' : 'Оплатить 50 ₽ / месяц через ЮMoney'}
            </button>
          )}

          {searchParams.get('label') && !hasPremium && (
            <button className="btn btn-ghost" onClick={checkPaymentAgain} disabled={isLoading} style={{ marginTop: 10 }}>
              Проверить оплату
            </button>
          )}

          {!!statusText && <p className="premium-cta-text" style={{ marginTop: 12 }}>{statusText}</p>}
        </div>
      </div>
    </div>
  );
}
