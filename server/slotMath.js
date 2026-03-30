/**
 * Casino Slot Machine Math
 * 3x5 grid (3 rows, 5 reels)
 * 8 symbols with equal probability
 * 20 paylines
 * Target RTP: 80%
 */

const SYMBOLS = ['🍎', '🍊', '🍋', '🍌', '🍇', '💎', '⭐', '👑'];
const ROWS = 3;
const REELS = 5;
const PAYLINES = 20;

// Define all 20 paylines (positions in 3x5 grid)
// Grid layout: row 0,1,2 and column 0,1,2,3,4
// Each payline is array of [row, col] positions
const PAYLINES_MAP = [
  // Horizontal lines
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], // Top row
  [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4]], // Middle row
  [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]], // Bottom row
  
  // V-shapes and diagonal patterns
  [[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]], // V-shape up-down-up
  [[2, 0], [1, 1], [0, 2], [1, 3], [2, 4]], // V-shape down-up-down
  
  // Slight diagonal lines
  [[0, 0], [0, 1], [1, 2], [2, 3], [2, 4]], // Diagonal right
  [[2, 0], [2, 1], [1, 2], [0, 3], [0, 4]], // Diagonal left
  
  // Double V
  [[1, 0], [0, 1], [1, 2], [0, 3], [1, 4]], // W-shape up
  [[1, 0], [2, 1], [1, 2], [2, 3], [1, 4]], // W-shape down
  
  // Step patterns
  [[0, 0], [0, 1], [0, 2], [1, 3], [2, 4]], // Step down-right
  [[2, 0], [2, 1], [2, 2], [1, 3], [0, 4]], // Step up-right
  [[0, 0], [1, 1], [1, 2], [1, 3], [2, 4]], // Middle bias down
  [[2, 0], [1, 1], [1, 2], [1, 3], [0, 4]], // Middle bias up
  
  // Triple line combinations
  [[0, 0], [1, 1], [0, 2], [1, 3], [0, 4]], // Top-middle-top-middle-top
  [[2, 0], [1, 1], [2, 2], [1, 3], [2, 4]], // Bottom-middle-bottom-middle-bottom
  
  // Center with expansion
  [[1, 0], [1, 1], [0, 2], [1, 3], [1, 4]], // Center with top middle
  [[1, 0], [1, 1], [2, 2], [1, 3], [1, 4]], // Center with bottom middle
  
  // Outer edges
  [[0, 0], [2, 1], [0, 2], [2, 3], [0, 4]], // Alternating top-bottom
  [[2, 0], [0, 1], [2, 2], [0, 3], [2, 4]], // Alternating bottom-top
];

// Payout structure: match 3, 4, or 5 symbols
// Based on 80% RTP target with 0.20 RUB per spin (common slot bet)
// Adjusted to ensure ~80% return over time
const PAYOUTS = {
  3: { // 3 matching symbols (most common)
    '🍎': 0.38,   // 1.9x bet
    '🍊': 0.38,   // 1.9x bet
    '🍋': 0.44,   // 2.2x bet
    '🍌': 0.44,   // 2.2x bet
    '🍇': 0.52,   // 2.6x bet
    '💎': 0.70,   // 3.5x bet
    '⭐': 1.00,   // 5x bet
    '👑': 1.30,   // 6.5x bet
  },
  4: { // 4 matching symbols (rare)
    '🍎': 1.60,   // 8x bet
    '🍊': 1.60,   // 8x bet
    '🍋': 2.60,   // 13x bet
    '🍌': 2.60,   // 13x bet
    '🍇': 3.30,   // 16.5x bet
    '💎': 6.50,   // 32.5x bet
    '⭐': 10.00,  // 50x bet
    '👑': 16.00,  // 80x bet
  },
  5: { // 5 matching symbols (very rare)
    '🍎': 8.00,   // 40x bet
    '🍊': 8.00,   // 40x bet
    '🍋': 16.00,  // 80x bet
    '🍌': 16.00,  // 80x bet
    '🍇': 24.00,  // 120x bet
    '💎': 80.00,  // 400x bet
    '⭐': 160.00, // 800x bet
    '👑': 400.00, // 2000x bet
  },
};

/**
 * Spin the reels - return random grid
 */
function spinReels() {
  const grid = [];
  for (let row = 0; row < ROWS; row++) {
    grid[row] = [];
    for (let col = 0; col < REELS; col++) {
      grid[row][col] = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    }
  }
  return grid;
}

/**
 * Calculate winnings for a spin
 */
function calculateWinnings(grid, betAmount = 0.20) {
  let totalWinnings = 0;
  const winningLines = [];

  for (let lineIdx = 0; lineIdx < PAYLINES_MAP.length; lineIdx++) {
    const payline = PAYLINES_MAP[lineIdx];
    const symbols = payline.map(([row, col]) => grid[row][col]);

    // Check for consecutive matching symbols from left
    for (let matchLength = 5; matchLength >= 3; matchLength--) {
      const matchSymbol = symbols[0];
      let isMatch = true;
      
      for (let i = 0; i < matchLength; i++) {
        if (symbols[i] !== matchSymbol) {
          isMatch = false;
          break;
        }
      }

      if (isMatch) {
        const payout = PAYOUTS[matchLength][matchSymbol] || 0;
        const winnings = betAmount * payout;
        totalWinnings += winnings;
        
        winningLines.push({
          line: lineIdx,
          symbol: matchSymbol,
          matchLength,
          payout,
          winnings,
        });
        
        break; // Only match once per line, take best match
      }
    }
  }

  return {
    totalWinnings,
    winningLines,
  };
}

/**
 * Run test with N spins to calculate actual RTP
 * Returns RTP percentage (goal: ~80)
 */
function testRTP(totalSpins = 50000, betAmount = 0.20) {
  let totalBet = totalSpins * betAmount;
  let totalReturn = 0;

  for (let i = 0; i < totalSpins; i++) {
    const grid = spinReels();
    const { totalWinnings } = calculateWinnings(grid, betAmount);
    totalReturn += totalWinnings;
  }

  const rtp = (totalReturn / totalBet) * 100;
  return {
    totalSpins,
    totalBet,
    totalReturn,
    rtp: parseFloat(rtp.toFixed(2)),
  };
}

module.exports = {
  SYMBOLS,
  ROWS,
  REELS,
  PAYLINES: PAYLINES_MAP.length,
  PAYLINES_MAP,
  PAYOUTS,
  spinReels,
  calculateWinnings,
  testRTP,
};
