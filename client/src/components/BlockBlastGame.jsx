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

export default function BlockBlastGame({ canPlay, onScoreSubmit }) {
  const [board, setBoard] = useState(createEmptyBoard());
  const [pieces, setPieces] = useState([randomPiece(), randomPiece(), randomPiece()]);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [message, setMessage] = useState('');
  const [gameOver, setGameOver] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [draggingPieceId, setDraggingPieceId] = useState(null);
  const [previewPos, setPreviewPos] = useState(null);

  const submitScore = async (value) => {
    if (savingResult) return;
    setSavingResult(true);
    try {
      await api.post('/users/block-blast/score', { score: value });
      if (onScoreSubmit) await onScoreSubmit();
    } catch (err) {
      setMessage(err.response?.data?.error || 'Не удалось сохранить результат');
    } finally {
      setSavingResult(false);
    }
  };

  const resetGame = () => {
    setBoard(createEmptyBoard());
    setPieces([randomPiece(), randomPiece(), randomPiece()]);
    setScore(0);
    setGameOver(false);
    setMessage('');
    setPreviewPos(null);
    setDraggingPieceId(null);
  };

  const tryFinishIfNoMoves = async (nextBoard, nextPieces, nextScore) => {
    const hasMoves = boardHasAnyMove(nextBoard, nextPieces);
    if (!hasMoves) {
      setGameOver(true);
      setMessage('Игра окончена. Результат сохранён в таблицу.');
      await submitScore(nextScore);
    }
  };

  const placePieceAt = async (piece, row, col) => {
    if (!piece || gameOver) return;
    if (!canPlace(board, piece, row, col)) return;

    const placedBoard = board.map((r) => r.slice());
    piece.cells.forEach(([r, c]) => {
      placedBoard[row + r][col + c] = piece.color;
    });

    const baseGain = piece.cells.length;
    const afterClear = clearCompleted(placedBoard);
    const clearBonus = afterClear.cleared * 10;
    const nextScore = score + baseGain + clearBonus;

    const nextPieces = pieces.map((p) => (p?.id === piece.id ? null : p));
    const finalPieces = nextPieces.every((p) => !p) ? [randomPiece(), randomPiece(), randomPiece()] : nextPieces;

    setBoard(afterClear.board);
    setScore(nextScore);
    setPieces(finalPieces);
    setDraggingPieceId(null);
    setPreviewPos(null);

    await tryFinishIfNoMoves(afterClear.board, finalPieces, nextScore);
  };

  const getBoardRect = (boardEl) => {
    if (!boardEl) return null;
    const rect = boardEl.getBoundingClientRect();
    const cellSize = (rect.width - 28) / 8; // 8 клеток, padding 8px * 2, gap 4px * 7
    return { rect, cellSize };
  };

  const handleMove = (clientX, clientY) => {
    if (!draggingPieceId) return;

    const boardEl = document.querySelector('.block-blast-board');
    const boardData = getBoardRect(boardEl);
    if (!boardData) return;

    const { rect, cellSize } = boardData;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const col = Math.floor(x / (cellSize + 4));
    const row = Math.floor(y / (cellSize + 4));

    if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
      const piece = pieces.find((p) => p?.id === draggingPieceId);
      if (piece && canPlace(board, piece, row, col)) {
        setPreviewPos({ row, col });
        return;
      }
    }
    setPreviewPos(null);
  };

  const handleMoveEnd = () => {
    if (draggingPieceId && previewPos) {
      const piece = pieces.find((p) => p?.id === draggingPieceId);
      placePieceAt(piece, previewPos.row, previewPos.col);
    } else {
      setDraggingPieceId(null);
      setPreviewPos(null);
    }
  };

  const onBoardMouseMove = (e) => {
    handleMove(e.clientX, e.clientY);
  };

  const onBoardMouseUp = () => {
    handleMoveEnd();
  };

  const onBoardMouseLeave = () => {
    if (!draggingPieceId) return;
    setPreviewPos(null);
  };

  const onBoardTouchMove = (e) => {
    if (!draggingPieceId) return;
    e.preventDefault();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    }
  };

  const onBoardTouchEnd = () => {
    handleMoveEnd();
  };

  const onPieceMouseDown = (pieceId) => {
    setDraggingPieceId(pieceId);
  };

  const onPieceTouchStart = (pieceId) => {
    setDraggingPieceId(pieceId);
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

      <div className="block-blast-board" onMouseMove={onBoardMouseMove} onMouseLeave={onBoardMouseLeave} onMouseUp={onBoardMouseUp} onTouchMove={onBoardTouchMove} onTouchEnd={onBoardTouchEnd}>
        {board.map((row, rIdx) =>
          row.map((cell, cIdx) => {
            const piece = pieces.find((p) => p?.id === draggingPieceId);
            let previewColor = null;
            
            if (previewPos && piece) {
              // Check if this cell is part of the preview shape
              if (piece.cells.some(([dr, dc]) => rIdx === previewPos.row + dr && cIdx === previewPos.col + dc)) {
                previewColor = piece.color;
              }
            }

            return (
              <button
                key={`${rIdx}-${cIdx}`}
                className="block-blast-cell"
                style={{
                  background: cell ? cell : (previewColor ? `${previewColor}60` : 'rgba(255,255,255,0.06)'),
                  transition: previewColor ? 'background 0.05s' : 'background 0.15s',
                }}
              />
            );
          })
        )}
      </div>

      <div className="block-blast-pieces-container">
        <div className="block-blast-pieces">
          {pieces.map((piece, idx) => {
            if (!piece) {
              return (
                <div key={`empty-${idx}`} className="block-blast-piece-card empty">
                  ✓
                </div>
              );
            }

            const { width, height } = getPieceSize(piece.cells);
            const isDragging = draggingPieceId === piece.id;

            return (
              <div
                key={piece.id}
                className={`block-blast-piece-card ${isDragging ? 'dragging' : ''}`}
                onMouseDown={() => onPieceMouseDown(piece.id)}
                onTouchStart={() => onPieceTouchStart(piece.id)}
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
              </div>
            );
          })}
        </div>
      </div>

      {message ? <div className="settings-msg" style={{ color: gameOver ? 'var(--accent)' : 'var(--red)' }}>{message}</div> : null}
    </div>
  );
}
