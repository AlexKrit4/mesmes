import { useEffect, useMemo, useState } from 'react';
import api from '../api.js';

const BOARD_SIZE = 8;

const SHAPES = [
  [[0, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 1], [1, 1], [2, 1], [2, 0]],
  [[0, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 1]],
  [[0, 1], [1, 0], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[0, 1], [1, 1], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
];

const PIECE_COLORS = ['#4fb3ff', '#8bd450', '#ffa647', '#ff6b9d', '#9d7bff', '#32d9c8'];

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
}

function getPieceSize(cells) {
  const maxRow = Math.max(...cells.map((c) => c[0]));
  const maxCol = Math.max(...cells.map((c) => c[1]));
  return { height: maxRow + 1, width: maxCol + 1 };
}

function randomPiece() {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    cells: shape,
    color: PIECE_COLORS[Math.floor(Math.random() * PIECE_COLORS.length)],
  };
}

function canPlace(board, piece, row, col) {
  return piece.cells.every(([r, c]) => {
    const rr = row + r;
    const cc = col + c;
    if (rr < 0 || rr >= BOARD_SIZE || cc < 0 || cc >= BOARD_SIZE) return false;
    return !board[rr][cc];
  });
}

function boardHasAnyMove(board, pieces) {
  const livePieces = pieces.filter(Boolean);
  if (livePieces.length === 0) return true;

  for (const piece of livePieces) {
    const { width, height } = getPieceSize(piece.cells);
    for (let row = 0; row <= BOARD_SIZE - height; row += 1) {
      for (let col = 0; col <= BOARD_SIZE - width; col += 1) {
        if (canPlace(board, piece, row, col)) return true;
      }
    }
  }
  return false;
}

function clearCompleted(board) {
  const rowsToClear = [];
  const colsToClear = [];

  for (let r = 0; r < BOARD_SIZE; r += 1) {
    if (board[r].every(Boolean)) rowsToClear.push(r);
  }

  for (let c = 0; c < BOARD_SIZE; c += 1) {
    let full = true;
    for (let r = 0; r < BOARD_SIZE; r += 1) {
      if (!board[r][c]) {
        full = false;
        break;
      }
    }
    if (full) colsToClear.push(c);
  }

  if (rowsToClear.length === 0 && colsToClear.length === 0) {
    return { board, cleared: 0 };
  }

  const nextBoard = board.map((row) => row.slice());
  rowsToClear.forEach((r) => {
    for (let c = 0; c < BOARD_SIZE; c += 1) nextBoard[r][c] = null;
  });
  colsToClear.forEach((c) => {
    for (let r = 0; r < BOARD_SIZE; r += 1) nextBoard[r][c] = null;
  });

  return { board: nextBoard, cleared: rowsToClear.length + colsToClear.length };
}

export default function BlockBlastGame({ canPlay }) {
  const [board, setBoard] = useState(createEmptyBoard());
  const [pieces, setPieces] = useState([randomPiece(), randomPiece(), randomPiece()]);
  const [selectedPieceId, setSelectedPieceId] = useState(null);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [myRecent, setMyRecent] = useState([]);
  const [message, setMessage] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [savingResult, setSavingResult] = useState(false);

  const selectedPiece = useMemo(
    () => pieces.find((p) => p?.id === selectedPieceId) || null,
    [pieces, selectedPieceId]
  );

  const refreshLeaderboard = async () => {
    try {
      const { data } = await api.get('/users/block-blast/leaderboard');
      setLeaderboard(data.leaderboard || []);
      setBestScore(data.my_best_score || 0);
      setMyRecent(data.my_recent || []);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Не удалось загрузить рейтинг');
    }
  };

  useEffect(() => {
    if (canPlay) refreshLeaderboard();
  }, [canPlay]);

  const submitScore = async (value) => {
    if (savingResult) return;
    setSavingResult(true);
    try {
      const { data } = await api.post('/users/block-blast/score', { score: value });
      setBestScore(data.best_score || value);
      await refreshLeaderboard();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Не удалось сохранить результат');
    } finally {
      setSavingResult(false);
    }
  };

  const resetGame = () => {
    setBoard(createEmptyBoard());
    setPieces([randomPiece(), randomPiece(), randomPiece()]);
    setSelectedPieceId(null);
    setScore(0);
    setGameOver(false);
    setMessage('');
  };

  const tryFinishIfNoMoves = async (nextBoard, nextPieces, nextScore) => {
    const hasMoves = boardHasAnyMove(nextBoard, nextPieces);
    if (!hasMoves) {
      setGameOver(true);
      setMessage('Игра окончена. Результат сохранён в таблицу.');
      await submitScore(nextScore);
    }
  };

  const onCellClick = async (row, col) => {
    if (!selectedPiece || gameOver) return;
    if (!canPlace(board, selectedPiece, row, col)) return;

    const placedBoard = board.map((r) => r.slice());
    selectedPiece.cells.forEach(([r, c]) => {
      placedBoard[row + r][col + c] = selectedPiece.color;
    });

    const baseGain = selectedPiece.cells.length;
    const afterClear = clearCompleted(placedBoard);
    const clearBonus = afterClear.cleared * 10;
    const nextScore = score + baseGain + clearBonus;

    const nextPieces = pieces.map((p) => (p?.id === selectedPiece.id ? null : p));
    const finalPieces = nextPieces.every((p) => !p) ? [randomPiece(), randomPiece(), randomPiece()] : nextPieces;

    setBoard(afterClear.board);
    setScore(nextScore);
    setPieces(finalPieces);
    setSelectedPieceId(null);

    await tryFinishIfNoMoves(afterClear.board, finalPieces, nextScore);
  };

  if (!canPlay) {
    return (
      <div className="settings-section">
        <div className="settings-section-title">Block Blast</div>
        <p className="settings-msg" style={{ color: 'var(--text2)' }}>
          Доступ к игре есть только у админа и пользователей, которым админ выдал доступ.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Block Blast</div>
      <div className="settings-msg" style={{ color: 'var(--text2)', marginBottom: 8 }}>
        Ставь фигуры, собирай линии и колонки. Лучшие рекорды попадают в рейтинг.
      </div>

      <div className="block-blast-stats">
        <div className="block-blast-stat">
          <span>Очки</span>
          <strong>{score}</strong>
        </div>
        <div className="block-blast-stat">
          <span>Мой рекорд</span>
          <strong>{bestScore}</strong>
        </div>
        <button className="settings-action-btn" onClick={resetGame} style={{ marginTop: 0 }}>
          Новая игра
        </button>
      </div>

      <div className="block-blast-board">
        {board.map((row, rIdx) =>
          row.map((cell, cIdx) => (
            <button
              key={`${rIdx}-${cIdx}`}
              className="block-blast-cell"
              onClick={() => onCellClick(rIdx, cIdx)}
              style={{ background: cell || 'rgba(255,255,255,0.06)' }}
              title={selectedPiece ? 'Поставить фигуру' : 'Выбери фигуру ниже'}
            />
          ))
        )}
      </div>

      <div className="block-blast-pieces">
        {pieces.map((piece, idx) => {
          if (!piece) {
            return (
              <div key={`empty-${idx}`} className="block-blast-piece-card empty">
                Использована
              </div>
            );
          }

          const { width, height } = getPieceSize(piece.cells);

          return (
            <button
              key={piece.id}
              className={`block-blast-piece-card ${selectedPieceId === piece.id ? 'active' : ''}`}
              onClick={() => setSelectedPieceId(piece.id)}
            >
              <div
                className="block-blast-piece-grid"
                style={{ gridTemplateColumns: `repeat(${width}, 16px)`, gridTemplateRows: `repeat(${height}, 16px)` }}
              >
                {Array.from({ length: width * height }).map((_, i) => {
                  const rr = Math.floor(i / width);
                  const cc = i % width;
                  const filled = piece.cells.some(([r, c]) => r === rr && c === cc);
                  return (
                    <span
                      key={`${piece.id}-${i}`}
                      className="block-blast-piece-dot"
                      style={{ background: filled ? piece.color : 'transparent' }}
                    />
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      {message ? <div className="settings-msg" style={{ color: gameOver ? 'var(--accent)' : 'var(--red)' }}>{message}</div> : null}

      <div className="block-blast-leaderboard">
        <div className="block-blast-leaderboard-title">Рейтинг лучших рекордов</div>
        {leaderboard.length === 0 ? (
          <div className="settings-msg" style={{ color: 'var(--text2)' }}>Пока нет результатов</div>
        ) : (
          leaderboard.map((entry, index) => (
            <div key={`${entry.id}-${entry.best_score}`} className="block-blast-leader-row">
              <span>#{index + 1}</span>
              <span>{entry.username} (@{entry.public_id})</span>
              <strong>{entry.best_score}</strong>
            </div>
          ))
        )}
      </div>

      <div className="block-blast-leaderboard" style={{ marginTop: 10 }}>
        <div className="block-blast-leaderboard-title">Мои последние результаты</div>
        {myRecent.length === 0 ? (
          <div className="settings-msg" style={{ color: 'var(--text2)' }}>Пока нет сыгранных партий</div>
        ) : (
          myRecent.map((entry, index) => (
            <div key={`${entry.created_at}-${index}`} className="block-blast-leader-row">
              <span>{new Date(entry.created_at).toLocaleDateString('ru-RU')}</span>
              <span>{new Date(entry.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
              <strong>{entry.score}</strong>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
