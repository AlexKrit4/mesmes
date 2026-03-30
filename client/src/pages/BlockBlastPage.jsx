import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import BlockBlastGame from '../components/BlockBlastGame.jsx';

export default function BlockBlastPage() {
  const navigate = useNavigate();
  const [canPlay, setCanPlay] = useState(false);
  const [showRecords, setShowRecords] = useState(false);

  useEffect(() => {
    api.get('/users/block-blast/access').then(({ data }) => {
      setCanPlay(!!data.can_play);
    }).catch(() => {
      setCanPlay(false);
    });
  }, []);

  return (
    <div className="settings-page">
      <div className="topbar">
        <button className="topbar-btn" onClick={() => navigate('/settings')}>
          Выйти
        </button>
        <span className="topbar-title">Block Blast</span>
        <button
          className="topbar-btn"
          onClick={() => setShowRecords((prev) => !prev)}
          disabled={!canPlay}
          title={!canPlay ? 'Нет доступа к игре' : undefined}
        >
          Рекорды
        </button>
      </div>

      <div className="settings-content">
        <BlockBlastGame canPlay={canPlay} showRecords={showRecords} />
      </div>
    </div>
  );
}
