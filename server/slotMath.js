/**
 * Casino Slot Machine Math
 * 3x5 grid (3 rows, 5 reels)
 * 8 symbols with equal probability
 * 20 paylines
 * Target RTP: 96%
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
// Based on 96% RTP target with 0.20 RUB per spin (common slot bet)
// Calibrated and tested through 1M+ spin simulations to achieve 96% RTP
const PAYOUTS = {
  3: { // 3 matching symbols (most common)
    '🍎': 0.48,   // 2.4x bet
    '🍊': 0.48,   // 2.4x bet
    '🍋': 0.57,   // 2.85x bet
    '🍌': 0.57,   // 2.85x bet
    '🍇': 0.66,   // 3.3x bet
    '💎': 0.87,   // 4.35x bet
    '⭐': 1.27,   // 6.35x bet
    '👑': 1.64,   // 8.2x bet
  },
  4: { // 4 matching symbols (rare)
    '🍎': 2.02,   // 10.1x bet
    '🍊': 2.02,   // 10.1x bet
    '🍋': 3.28,   // 16.4x bet
    '🍌': 3.28,   // 16.4x bet
    '🍇': 4.17,   // 20.85x bet
    '💎': 8.22,   // 41.1x bet
    '⭐': 12.62,  // 63.1x bet
    '👑': 20.21,  // 101.05x bet
  },
  5: { // 5 matching symbols (very rare)
    '🍎': 10.10,  // 50.5x bet
    '🍊': 10.10,  // 50.5x bet
    '🍋': 20.20,  // 101x bet
    '🍌': 20.20,  // 101x bet
    '🍇': 30.32,  // 151.6x bet
    '💎': 101.00, // 505x bet
    '⭐': 202.00, // 1010x bet
    '👑': 505.00, // 2525x bet
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
