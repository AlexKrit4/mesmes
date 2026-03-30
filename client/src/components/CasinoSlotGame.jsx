import React, { useState, useRef, useEffect } from 'react';
import api from '../api';
import './CasinoSlotGame.css';

const SYMBOLS = ['🍎', '🍊', '🍋', '🍌', '🍇', '💎', '⭐', '👑'];
const PAYLINES_MAP = [
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]],
  [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
  [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]],
  [[2, 0], [1, 1], [0, 2], [1, 3], [2, 4]],
  [[0, 0], [0, 1], [1, 2], [2, 3], [2, 4]],
  [[2, 0], [2, 1], [1, 2], [0, 3], [0, 4]],
  [[1, 0], [0, 1], [1, 2], [0, 3], [1, 4]],
  [[1, 0], [2, 1], [1, 2], [2, 3], [1, 4]],
  [[0, 0], [0, 1], [0, 2], [1, 3], [2, 4]],
  [[2, 0], [2, 1], [2, 2], [1, 3], [0, 4]],
  [[0, 0], [1, 1], [1, 2], [1, 3], [2, 4]],
  [[2, 0], [1, 1], [1, 2], [1, 3], [0, 4]],
  [[0, 0], [1, 1], [0, 2], [1, 3], [0, 4]],
  [[2, 0], [1, 1], [2, 2], [1, 3], [2, 4]],
  [[1, 0], [1, 1], [0, 2], [1, 3], [1, 4]],
  [[1, 0], [1, 1], [2, 2], [1, 3], [1, 4]],
  [[0, 0], [2, 1], [0, 2], [2, 3], [0, 4]],
  [[2, 0], [0, 1], [2, 2], [0, 3], [2, 4]],
];

function randomSymbol() {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

function updateColumn(grid, col, columnValues) {
  const next = grid.map((row) => [...row]);
  for (let r = 0; r < 3; r += 1) {
    next[r][col] = columnValues[r];
  }
  return next;
}

export default function CasinoSlotGame({ onSpinComplete, balance }) {
  const [grid, setGrid] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [betAmount, setBetAmount] = useState(0.20);
  const [winnings, setWinnings] = useState(0);
  const [winningLines, setWinningLines] = useState([]);
  const [message, setMessage] = useState('');
  const [reelSpinning, setReelSpinning] = useState([false, false, false, false, false]);
  const [previewBalance, setPreviewBalance] = useState(balance || 0);
  const spinTimeoutRef = useRef([]);
  const spinIntervalRef = useRef([]);
  const finalizeTimeoutRef = useRef(null);

  const clearSpinTimers = () => {
    spinTimeoutRef.current.forEach((t) => clearTimeout(t));
    spinIntervalRef.current.forEach((t) => clearInterval(t));
    spinTimeoutRef.current = [];
    spinIntervalRef.current = [];
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    const emptyGrid = Array(3).fill().map(() => Array(5).fill('🍎'));
    setGrid(emptyGrid);
    return () => {
      clearSpinTimers();
    };
  }, []);

  useEffect(() => {
    if (!spinning) {
      setPreviewBalance(balance || 0);
    }
  }, [balance, spinning]);

  const getWinningCellSet = () => {
    const winCells = new Set();
    winningLines.forEach((wl) => {
      const path = PAYLINES_MAP[wl.line];
      if (!path) return;
      for (let i = 0; i < wl.matchLength; i += 1) {
        const [row, col] = path[i];
        winCells.add(`${row}-${col}`);
      }
    });
    return winCells;
  };

  const startAnimatedStop = (targetGrid, winAmount, lines, finalBalance) => {
    const stopDelays = [800, 1040, 1280, 1520, 1760];

    for (let col = 0; col < 5; col += 1) {
      spinIntervalRef.current[col] = setInterval(() => {
        setGrid((prev) => updateColumn(prev, col, [randomSymbol(), randomSymbol(), randomSymbol()]));
      }, 80);

      spinTimeoutRef.current[col] = setTimeout(() => {
        clearInterval(spinIntervalRef.current[col]);
        const finalColumn = [targetGrid[0][col], targetGrid[1][col], targetGrid[2][col]];
        setGrid((prev) => updateColumn(prev, col, finalColumn));
        setReelSpinning((prev) => {
          const next = [...prev];
          next[col] = false;
          return next;
        });
      }, stopDelays[col]);
    }

    finalizeTimeoutRef.current = setTimeout(() => {
      setWinningLines(lines);
      setWinnings(winAmount);
      setPreviewBalance(finalBalance);

      if (winAmount > 0) {
        setMessage(`🎉 Выигрыш: ${winAmount.toFixed(2)} ₽ (линий: ${lines.length})`);
      } else {
        setMessage('Без выигрыша. Попробуйте еще раз!');
      }

      setSpinning(false);
      onSpinComplete(finalBalance);
    }, stopDelays[4] + 220);
  };

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

    clearSpinTimers();
    setSpinning(true);
    setMessage('Ставка списана, барабаны крутятся...');
    setWinnings(0);
    setWinningLines([]);
    setReelSpinning([true, true, true, true, true]);
    setPreviewBalance((prev) => Math.max(0, Number(prev || balance || 0) - Number(betAmount)));

    try {
      const response = await api.post('/casino/spin', { betAmount });
      const {
        grid: newGrid,
        winnings: winAmount,
        winningLines: lines,
        balance: finalBalance,
      } = response.data;

      startAnimatedStop(newGrid, winAmount, lines, finalBalance);
    } catch (error) {
      clearSpinTimers();
      setMessage(error.response?.data?.error || 'Ошибка спина');
      setReelSpinning([false, false, false, false, false]);
      setPreviewBalance(balance || 0);
      setSpinning(false);
    }
  };

  if (!grid) return <div className="casino-game-container">Загрузка...</div>;

  const winningCellSet = getWinningCellSet();

  return (
    <div className="casino-game-container">
      <div className="casino-reels">
        {grid.map((row, rowIdx) => (
          <div key={rowIdx} className="reel-row">
            {row.map((symbol, colIdx) => (
              <div
                key={`${rowIdx}-${colIdx}`}
                className={`reel-cell ${reelSpinning[colIdx] ? 'spinning' : ''} ${
                  winningCellSet.has(`${rowIdx}-${colIdx}`) ? 'winning' : ''
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

        <div className="round-balance">
          Баланс в раунде: <span>{Number(previewBalance || 0).toFixed(2)} ₽</span>
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

        {winningLines.length > 0 && (
          <div className="winning-lines-display">
            Линии: {winningLines.map((wl) => `#${wl.line + 1}`).join(', ')}
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
