import React, { useState, useEffect } from 'react';
import api from '../api';
import { getSocket } from '../socket';

export default function CasinoSpinsAdmin({ selectedUserId }) {
  const [spins, setSpins] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState('date'); // date, bet, multiplier, winnings
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedSpin, setSelectedSpin] = useState(null);

  useEffect(() => {
    if (selectedUserId) {
      fetchSpins();
    }
  }, [selectedUserId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket?.connected || !selectedUserId) {
      console.log('[CasinoSpinsAdmin] Socket not ready or userId not selected');
      return;
    }

    console.log('[CasinoSpinsAdmin] Setting up socket listener for user:', selectedUserId);

    const handleNewSpin = (spinData) => {
      try {
        if (!spinData) {
          console.warn('[CasinoSpinsAdmin] Received empty spin data');
          return;
        }

        // If the new spin is for the currently selected user, add it to the list
        if (Number(spinData.user_id) === Number(selectedUserId)) {
          console.log('[CasinoSpinsAdmin] Received new spin for selected user:', spinData);
          setSpins((prev) => [
            {
              id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              bet_amount: parseFloat(spinData.bet_amount),
              multiplier: parseFloat(spinData.multiplier),
              winnings: parseFloat(spinData.winnings),
              created_at: spinData.created_at || new Date().toISOString(),
              grid: '[]',
            },
            ...prev,
          ]);
        }
      } catch (error) {
        console.error('[CasinoSpinsAdmin] Error handling new spin event:', error);
      }
    };

    const handleSocketConnect = () => {
      console.log('[CasinoSpinsAdmin] Socket connected');
    };

    const handleSocketDisconnect = () => {
      console.warn('[CasinoSpinsAdmin] Socket disconnected');
    };

    socket.on('casino_new_spin', handleNewSpin);
    socket.on('connect', handleSocketConnect);
    socket.on('disconnect', handleSocketDisconnect);

    return () => {
      socket.off('casino_new_spin', handleNewSpin);
      socket.off('connect', handleSocketConnect);
      socket.off('disconnect', handleSocketDisconnect);
    };
  }, [selectedUserId]);

  const fetchSpins = async () => {
    if (!selectedUserId) return;
    
    setLoading(true);
    try {
      const response = await api.get(`/casino/admin/spins/${selectedUserId}`);
      setSpins(response.data.spins || []);
    } catch (error) {
      console.error('Error fetching spins:', error);
      setSpins([]);
    } finally {
      setLoading(false);
    }
  };

  const getSortedSpins = () => {
    let sorted = [...spins];

    sorted.sort((a, b) => {
      let compareValue = 0;

      switch (sortBy) {
        case 'bet':
          compareValue = a.bet_amount - b.bet_amount;
          break;
        case 'multiplier':
          compareValue = a.multiplier - b.multiplier;
          break;
        case 'winnings':
          compareValue = a.winnings - b.winnings;
          break;
        case 'date':
        default:
          compareValue = new Date(b.created_at) - new Date(a.created_at);
          break;
      }

      return sortOrder === 'asc' ? compareValue : -compareValue;
    });

    return sorted;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const sortedSpins = getSortedSpins();

  // Расчет статистики
  const calculateStats = () => {
    if (spins.length === 0) {
      return {
        totalBets: 0,
        totalSpent: 0,
        totalWinnings: 0,
        balance: 0,
      };
    }

    const totalSpent = spins.reduce((sum, spin) => sum + spin.bet_amount, 0);
    const totalWinnings = spins.reduce((sum, spin) => sum + spin.winnings, 0);
    const balance = totalWinnings - totalSpent;

    return {
      totalBets: spins.length,
      totalSpent,
      totalWinnings,
      balance,
    };
  };

  const stats = calculateStats();

  return (
    <div className="admin-section">
      <h2>🎰 Спины казино</h2>

      {loading ? (
        <div>Загрузка спинов...</div>
      ) : spins.length === 0 ? (
        <div>Нет спинов для отображения</div>
      ) : (
        <>
          {/* Статистика */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr 1fr 1fr', 
            gap: '15px',
            marginBottom: '25px'
          }}>
            <div style={{
              backgroundColor: 'rgba(25, 95, 150, 0.3)',
              border: '2px solid rgba(100, 200, 255, 0.5)',
              borderRadius: '8px',
              padding: '20px',
              textAlign: 'center'
            }}>
              <div style={{ color: '#64c8ff', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>ВСЕГО СТАВОК</div>
              <div style={{ color: '#fff', fontSize: '24px', fontWeight: 'bold' }}>{stats.totalBets}</div>
            </div>

            <div style={{
              backgroundColor: 'rgba(150, 50, 50, 0.3)',
              border: '2px solid rgba(255, 100, 100, 0.5)',
              borderRadius: '8px',
              padding: '20px',
              textAlign: 'center'
            }}>
              <div style={{ color: '#ff6464', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>ПОТРАЧЕНО</div>
              <div style={{ color: '#fff', fontSize: '24px', fontWeight: 'bold' }}>{stats.totalSpent.toFixed(2)} ₽</div>
            </div>

            <div style={{
              backgroundColor: 'rgba(50, 150, 50, 0.3)',
              border: '2px solid rgba(100, 255, 100, 0.5)',
              borderRadius: '8px',
              padding: '20px',
              textAlign: 'center'
            }}>
              <div style={{ color: '#64ff64', fontSize: '12px', fontWeight: 'bold', marginBottom: '8px' }}>ВЫИГРАНО</div>
              <div style={{ color: '#fff', fontSize: '24px', fontWeight: 'bold' }}>{stats.totalWinnings.toFixed(2)} ₽</div>
            </div>

            <div style={{
              backgroundColor: stats.balance >= 0 
                ? 'rgba(50, 150, 50, 0.3)' 
                : 'rgba(150, 50, 50, 0.3)',
              border: stats.balance >= 0 
                ? '2px solid rgba(100, 255, 100, 0.5)' 
                : '2px solid rgba(255, 100, 100, 0.5)',
              borderRadius: '8px',
              padding: '20px',
              textAlign: 'center'
            }}>
              <div style={{ 
                color: stats.balance >= 0 ? '#64ff64' : '#ff6464', 
                fontSize: '12px', 
                fontWeight: 'bold', 
                marginBottom: '8px' 
              }}>БАЛАНС</div>
              <div style={{ 
                color: stats.balance >= 0 ? '#64ff64' : '#ff6464', 
                fontSize: '24px', 
                fontWeight: 'bold' 
              }}>
                {stats.balance >= 0 ? '+' : ''}{stats.balance.toFixed(2)} ₽
              </div>
            </div>
          </div>

          {/* Таблица спинов */}
          <div className="spins-list">
          <div className="spins-table">
            <div className="spins-header">
              <div
                className="col col-bet"
                onClick={() => toggleSort('bet')}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Ставка {sortBy === 'bet' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
              <div
                className="col col-multiplier"
                onClick={() => toggleSort('multiplier')}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Множитель {sortBy === 'multiplier' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
              <div
                className="col col-winnings"
                onClick={() => toggleSort('winnings')}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Выигрыш {sortBy === 'winnings' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
              <div
                className="col col-date"
                onClick={() => toggleSort('date')}
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                Время {sortBy === 'date' && (sortOrder === 'asc' ? '↑' : '↓')}
              </div>
            </div>

            {sortedSpins.map((spin) => (
              <div
                key={spin.id}
                className="spins-row"
                onClick={() => setSelectedSpin(spin)}
                style={{ cursor: 'pointer' }}
              >
                <div className="col col-bet">{spin.bet_amount.toFixed(2)} ₽</div>
                <div className="col col-multiplier">{spin.multiplier.toFixed(2)}x</div>
                <div className="col col-winnings">{spin.winnings.toFixed(2)} ₽</div>
                <div className="col col-date">{formatDate(spin.created_at)}</div>
              </div>
            ))}
          </div>
          </div>
        </>
      )}

      {selectedSpin && (
        <div className="casino-modal-overlay" onClick={() => setSelectedSpin(null)}>
          <div className="casino-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedSpin(null)}>✕</button>

            <h3>Паттерн спина #{selectedSpin.id}</h3>

            <div className="spin-grid-display">
              {JSON.parse(selectedSpin.grid).map((row, rowIdx) => (
                <div key={rowIdx} className="spin-row">
                  {row.map((symbol, colIdx) => (
                    <div key={`${rowIdx}-${colIdx}`} className="spin-cell">
                      {symbol}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="spin-details">
              <div className="detail">
                <span className="label">Ставка:</span>
                <span className="value">{selectedSpin.bet_amount.toFixed(2)} ₽</span>
              </div>
              <div className="detail">
                <span className="label">Множитель:</span>
                <span className="value">{selectedSpin.multiplier.toFixed(2)}x</span>
              </div>
              <div className="detail">
                <span className="label">Выигрыш:</span>
                <span className="value">{selectedSpin.winnings.toFixed(2)} ₽</span>
              </div>
              <div className="detail">
                <span className="label">Время:</span>
                <span className="value">{formatDate(selectedSpin.created_at)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .spins-list {
          margin-top: 20px;
          background: rgba(15, 52, 96, 0.3);
          padding: 15px;
          border-radius: 8px;
          border: 1px solid rgba(255, 215, 0, 0.2);
        }

        .spins-table {
          max-height: 600px;
          overflow-y: auto;
        }

        .spins-header {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 2fr;
          gap: 10px;
          padding: 10px;
          background: rgba(255, 215, 0, 0.1);
          border-radius: 6px;
          border-bottom: 2px solid rgba(255, 215, 0, 0.3);
          font-weight: bold;
          color: #ffed4e;
          margin-bottom: 10px;
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .spins-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 2fr;
          gap: 10px;
          padding: 10px;
          border-bottom: 1px solid rgba(255, 215, 0, 0.1);
          transition: background 0.2s;
        }

        .spins-row:hover {
          background: rgba(255, 215, 0, 0.1);
        }

        .col {
          padding: 5px;
          text-align: right;
        }

        .col-bet, .col-multiplier, .col-winnings {
          text-align: right;
        }

        .col-date {
          text-align: left;
        }

        .spin-grid-display {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 20px 0;
          padding: 15px;
          background: rgba(15, 52, 96, 0.5);
          border-radius: 8px;
          min-width: fit-content;
        }

        .spin-row {
          display: flex;
          gap: 8px;
          justify-content: center;
        }

        .spin-cell {
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%);
          border: 2px solid #ffd700;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
        }

        .spin-details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          padding: 15px;
          background: rgba(255, 215, 0, 0.05);
          border-radius: 8px;
          margin-top: 15px;
        }

        .detail {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .detail .label {
          color: #aaa;
          font-size: 13px;
        }

        .detail .value {
          color: #ffed4e;
          font-weight: bold;
          font-size: 16px;
        }
      `}</style>
    </div>
  );
}
