import { useEffect, useRef, useState } from 'react';
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
const BOARD_CELL_GAP = 4;

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
  const [dragPointer, setDragPointer] = useState(null);
  const [boardCellSize, setBoardCellSize] = useState(16);
  const boardRef = useRef(null);
  const draggingPieceIdRef = useRef(null);
  const previewPosRef = useRef(null);
  const piecesRef = useRef(pieces);
  const boardStateRef = useRef(board);

  useEffect(() => {
    draggingPieceIdRef.current = draggingPieceId;
  }, [draggingPieceId]);

  useEffect(() => {
    previewPosRef.current = previewPos;
  }, [previewPos]);

  useEffect(() => {
    piecesRef.current = pieces;
  }, [pieces]);

  useEffect(() => {
    boardStateRef.current = board;
  }, [board]);

  useEffect(() => {
    const updateBoardCellSize = () => {
      const boardEl = boardRef.current;
      if (!boardEl) return;
      const firstCell = boardEl.querySelector('.block-blast-cell');
      if (!firstCell) return;
      const cellRect = firstCell.getBoundingClientRect();
      setBoardCellSize(Math.max(12, Math.round(cellRect.width)));
    };

    updateBoardCellSize();
    window.addEventListener('resize', updateBoardCellSize);
    return () => window.removeEventListener('resize', updateBoardCellSize);
  }, []);

  const draggingPiece = pieces.find((p) => p?.id === draggingPieceId) || null;

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
    setDragPointer(null);
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
    setDragPointer(null);

    await tryFinishIfNoMoves(afterClear.board, finalPieces, nextScore);
  };

  const getBoardRect = (boardEl) => {
    if (!boardEl) return null;
    const rect = boardEl.getBoundingClientRect();
    const cellSize = (rect.width - 16 - BOARD_CELL_GAP * 7) / 8;
    return { rect, cellSize };
  };

  const handleMove = (clientX, clientY) => {
    const activePieceId = draggingPieceIdRef.current;
    if (!activePieceId) return;

    setDragPointer({ x: clientX, y: clientY });

    const boardEl = boardRef.current;
    const boardData = getBoardRect(boardEl);
    if (!boardData) return;

    const { rect, cellSize } = boardData;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const step = cellSize + BOARD_CELL_GAP;
    const pointerCol = (x - cellSize / 2) / step;
    const pointerRow = (y - cellSize / 2) / step;

    if (pointerRow >= -0.5 && pointerRow <= BOARD_SIZE - 0.5 && pointerCol >= -0.5 && pointerCol <= BOARD_SIZE - 0.5) {
      const piece = piecesRef.current.find((p) => p?.id === activePieceId);
      if (piece) {
        const { width, height } = getPieceSize(piece.cells);
        const centerColOffset = (width - 1) / 2;
        const centerRowOffset = (height - 1) / 2;
        const targetCol = Math.round(pointerCol - centerColOffset);
        const targetRow = Math.round(pointerRow - centerRowOffset);

        if (canPlace(boardStateRef.current, piece, targetRow, targetCol)) {
          setPreviewPos({ row: targetRow, col: targetCol });
          return;
        }
      }
    }
    setPreviewPos(null);
  };

  const handleMoveEnd = () => {
    const activePieceId = draggingPieceIdRef.current;
    const activePreviewPos = previewPosRef.current;

    if (activePieceId && activePreviewPos) {
      const piece = piecesRef.current.find((p) => p?.id === activePieceId);
      placePieceAt(piece, activePreviewPos.row, activePreviewPos.col);
    } else {
      setDraggingPieceId(null);
      setPreviewPos(null);
      setDragPointer(null);
    }
  };

  useEffect(() => {
    if (!draggingPieceId) return;

    const onPointerMove = (e) => {
      if (e.pointerType === 'touch') e.preventDefault();
      handleMove(e.clientX, e.clientY);
    };

    const onPointerUp = () => {
      handleMoveEnd();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [draggingPieceId]);

  const onPiecePointerDown = (pieceId, e) => {
    e.preventDefault();
    if (gameOver) return;
    setDraggingPieceId(pieceId);
    draggingPieceIdRef.current = pieceId;
    setDragPointer({ x: e.clientX, y: e.clientY });
    handleMove(e.clientX, e.clientY);
  };

  const draggingPieceSize = draggingPiece ? getPieceSize(draggingPiece.cells) : null;

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

      <div className="block-blast-board" ref={boardRef}>
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
                onPointerDown={(e) => onPiecePointerDown(piece.id, e)}
              >
                <div
                  className="block-blast-piece-grid"
                  style={{
                    gap: `${BOARD_CELL_GAP}px`,
                    gridTemplateColumns: `repeat(${width}, ${boardCellSize}px)`,
                    gridTemplateRows: `repeat(${height}, ${boardCellSize}px)`,
                  }}
                >
                  {Array.from({ length: width * height }).map((_, i) => {
                    const rr = Math.floor(i / width);
                    const cc = i % width;
                    const filled = piece.cells.some(([r, c]) => r === rr && c === cc);
                    return (
                      <span
                        key={`${piece.id}-${i}`}
                        className="block-blast-piece-dot"
                        style={{
                          width: `${boardCellSize}px`,
                          height: `${boardCellSize}px`,
                          borderRadius: `${Math.max(4, Math.floor(boardCellSize * 0.2))}px`,
                          background: filled ? piece.color : 'transparent',
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {draggingPiece && dragPointer ? (
        <div
          className="block-blast-drag-ghost"
          style={{
            left: dragPointer.x,
            top: dragPointer.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div
            className="block-blast-piece-grid"
            style={{
              gap: `${BOARD_CELL_GAP}px`,
              gridTemplateColumns: `repeat(${draggingPieceSize.width}, ${boardCellSize}px)`,
              gridTemplateRows: `repeat(${draggingPieceSize.height}, ${boardCellSize}px)`,
            }}
          >
            {Array.from({ length: draggingPieceSize.width * draggingPieceSize.height }).map((_, i) => {
              const rr = Math.floor(i / draggingPieceSize.width);
              const cc = i % draggingPieceSize.width;
              const filled = draggingPiece.cells.some(([r, c]) => r === rr && c === cc);
              return (
                <span
                  key={`ghost-${draggingPiece.id}-${i}`}
                  className="block-blast-piece-dot"
                  style={{
                    width: `${boardCellSize}px`,
                    height: `${boardCellSize}px`,
                    borderRadius: `${Math.max(4, Math.floor(boardCellSize * 0.2))}px`,
                    background: filled ? draggingPiece.color : 'transparent',
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {message ? <div className="settings-msg" style={{ color: gameOver ? 'var(--accent)' : 'var(--red)' }}>{message}</div> : null}
    </div>
  );
}
