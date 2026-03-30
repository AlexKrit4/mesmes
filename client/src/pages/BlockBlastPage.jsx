import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api.js';
import BlockBlastGame from '../components/BlockBlastGame.jsx';

export default function BlockBlastPage() {
  const navigate = useNavigate();
  const [canPlay, setCanPlay] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [myRecent, setMyRecent] = useState([]);
  const [bestScore, setBestScore] = useState(0);

  const refreshLeaderboard = async () => {
    try {
      const { data } = await api.get('/users/block-blast/leaderboard');
      setLeaderboard(data.leaderboard || []);
      setBestScore(data.my_best_score || 0);
      setMyRecent(data.my_recent?.slice(0, 5) || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    api.get('/users/block-blast/access').then(({ data }) => {
      setCanPlay(!!data.can_play);
      if (data.can_play) {
        refreshLeaderboard();
      }
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
        <BlockBlastGame canPlay={canPlay} onScoreSubmit={refreshLeaderboard} />
      </div>

      {showRecords && (
        <div className="block-blast-modal-overlay" onClick={() => setShowRecords(false)}>
          <div className="block-blast-modal" onClick={(e) => e.stopPropagation()}>
            <button className="block-blast-modal-close" onClick={() => setShowRecords(false)}>✕</button>

            <div className="block-blast-modal-section">
              <h3 className="block-blast-modal-title">Рейтинг лучших рекордов</h3>
              {leaderboard.length === 0 ? (
                <p className="block-blast-modal-empty">Пока нет результатов</p>
              ) : (
                <div className="block-blast-modal-leaderboard">
                  {leaderboard.map((entry, index) => (
                    <div key={`${entry.id}-${entry.best_score}`} className="block-blast-modal-row">
                      <span className="block-blast-modal-rank">#{index + 1}</span>
                      <span className="block-blast-modal-name">{entry.username}</span>
                      <span className="block-blast-modal-score">{entry.best_score}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="block-blast-modal-divider"></div>

            <div className="block-blast-modal-section">
              <h3 className="block-blast-modal-title">Мои последние результаты</h3>
              {myRecent.length === 0 ? (
                <p className="block-blast-modal-empty">Пока нет сыгранных партий</p>
              ) : (
                <div className="block-blast-modal-leaderboard">
                  {myRecent.map((entry, index) => (
                    <div key={`${entry.created_at}-${index}`} className="block-blast-modal-row">
                      <span className="block-blast-modal-date">
                        {new Date(entry.created_at).toLocaleDateString('ru-RU')}
                      </span>
                      <span className="block-blast-modal-time">
                        {new Date(entry.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="block-blast-modal-score">{entry.score}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
