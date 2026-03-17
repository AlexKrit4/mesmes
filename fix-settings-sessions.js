const fs = require('fs');
let code = fs.readFileSync('client/src/pages/Settings.jsx', 'utf8');

const oldState = `  const [meData, setMeData] = useState(me);

  // Fetch fresh me data
  useState(() => {
    api.get('/users/me').then(({ data }) => {
      setMeData(data);
      setHideLastSeen(!!data.hide_last_seen);
      localStorage.setItem('me', JSON.stringify(data));
    }).catch(() => {});
  });`;

const newState = `  const [meData, setMeData] = useState(me);
  const [sessions, setSessions] = useState([]);

  // Fetch fresh me data
  useState(() => {
    api.get('/users/me').then(({ data }) => {
      setMeData(data);
      setHideLastSeen(!!data.hide_last_seen);
      localStorage.setItem('me', JSON.stringify(data));
    }).catch(() => {});

    api.get('/users/sessions').then(({ data }) => {
      setSessions(data);
    }).catch(() => {});
  });

  const terminateSession = async (id) => {
    try {
      await api.delete(\`/users/sessions/\${id}\`);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      alert('Ошибка завершения сессии');
    }
  };`;

code = code.replace(oldState, newState);

const oldLogout = `<div className="settings-section">
          <button className="settings-action-btn danger" onClick={() => setShowLogoutConfirm(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Выйти из аккаунта
          </button>
        </div>`;

const newLogout = `<div className="settings-divider" />
        <div className="settings-section">
          <div className="settings-section-title">Активные сессии</div>
          {sessions.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: 'var(--bg-mid)', borderRadius: '8px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '15px', fontWeight: '500' }}>{s.device_info} {s.is_current ? '(Текущая)' : ''}</span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>IP: {s.ip_address} | {new Date(s.last_active).toLocaleString()}</span>
              </div>
              {!s.is_current && (
                <button onClick={() => terminateSession(s.id)} style={{ padding: '6px 12px', background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                  Завершить
                </button>
              )}
            </div>
          ))}
          {sessions.length === 0 && <span style={{fontSize: '14px', color:'gray'}}>Нет данных о сессиях. Перезайдите в аккаунт!</span>}
        </div>
        <div className="settings-divider" />
        <div className="settings-section">
          <button className="settings-action-btn danger" onClick={() => setShowLogoutConfirm(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Выйти из аккаунта
          </button>
        </div>`;

code = code.replace(oldLogout, newLogout);

fs.writeFileSync('client/src/pages/Settings.jsx', code);
console.log('done settings sess');
