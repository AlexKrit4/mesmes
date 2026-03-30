import React, { useState, useRef, useEffect } from 'react';
import api from '../api';
import './CasinoSlotGame.css';

const SYMBOLS = ['🍎', '🍊', '🍋', '🍌', '🍇', '💎', '⭐', '👑'];

export default function CasinoSlotGame({ onSpinComplete, balance }) {
  const [grid, setGrid] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [betAmount, setBetAmount] = useState(0.20);
  const [winnings, setWinnings] = useState(0);
  const [winningLines, setWinningLines] = useState([]);
  const [message, setMessage] = useState('');
  const [reelSpinning, setReelSpinning] = useState([false, false, false, false, false]);
  const spinTimeoutRef = useRef([]);

  useEffect(() => {
    // Initialize with empty grid
    const emptyGrid = Array(3).fill().map(() => Array(5).fill('🍎'));
    setGrid(emptyGrid);
  }, []);

  const handleSpin = async () => {
    if (spinning) return;
    if (betAmount < 0.20 || betAmount > 100) {
      setMessage('Ставка должна быть от 0.20 до 100 ₽');
      return;
    }
    if (balance < betAmount) {
      setMessage('Недостаточно средств');
      return;
    }

    setSpinning(true);
    setMessage('');
    setWinnings(0);
    setWinningLines([]);

    // Simulate reel spinning
    setReelSpinning([true, true, true, true, true]);
    const spinDurations = [1000, 1200, 1400, 1200, 1000];

    try {
      const response = await api.post('/casino/spin', { betAmount });
      const { grid: newGrid, winnings: winAmount, winningLines: lines } = response.data;

      setGrid(newGrid);
      setWinnings(winAmount);
      setWinningLines(lines);

      // Stop reels at staggered times
      spinDurations.forEach((duration, index) => {
        spinTimeoutRef.current[index] = setTimeout(() => {
          setReelSpinning(prev => {
            const newState = [...prev];
            newState[index] = false;
            return newState;
          });
        }, duration);
      });

      // Show message
      if (winAmount > 0) {
        setMessage(`🎉 Выигрыш: ${winAmount.toFixed(2)} ₽!`);
      } else {
        setMessage('Попробуйте еще раз!');
      }

      setTimeout(() => {
        setSpinning(false);
        onSpinComplete();
      }, 1400);
    } catch (error) {
      setMessage(error.response?.data?.error || 'Ошибка спина');
      setReelSpinning([false, false, false, false, false]);
      setSpinning(false);
    }
  };

  if (!grid) return <div className="casino-game-container">Загрузка...</div>;

  return (
    <div className="casino-game-container">
      <div className="casino-reels">
        {grid.map((row, rowIdx) => (
          <div key={rowIdx} className="reel-row">
            {row.map((symbol, colIdx) => (
              <div
                key={`${rowIdx}-${colIdx}`}
                className={`reel-cell ${reelSpinning[colIdx] ? 'spinning' : ''} ${
                  winningLines.some(wl => wl.line === (rowIdx * 5 + colIdx)) ? 'winning' : ''
                }`}
              >
                <span className="symbol">{symbol}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="casino-controls">
        <div className="bet-control">
          <label>Ставка (₽):</label>
          <input
            type="number"
            min="0.20"
            max="100"
            step="0.10"
            value={betAmount}
            onChange={(e) => setBetAmount(parseFloat(e.target.value))}
            disabled={spinning}
          />
        </div>

        <button
          className={`btn-spin ${spinning ? 'disabled' : ''}`}
          onClick={handleSpin}
          disabled={spinning}
        >
          {spinning ? 'КРУТИТСЯ...' : 'КРУТИТЬ'}
        </button>

        {message && (
          <div className={`message ${winnings > 0 ? 'success' : ''}`}>
            {message}
          </div>
        )}

        {winnings > 0 && (
          <div className="winnings-display">
            Выигрыш: <span className="amount">{winnings.toFixed(2)} ₽</span>
          </div>
        )}
      </div>

      <div className="paylines-info">
        <h3>Выигрышные линии (20)</h3>
        <p className="info-text">Минимум 3 совпадающих символа для выигрыша</p>
      </div>
    </div>
  );
}
