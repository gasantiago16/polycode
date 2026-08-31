const readline = require('readline');

let board = Array(9).fill(null);
let currentPlayer = 'X';
let gameOver = false;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function printBoard() {
  console.log(`
   ${board[0] || '1'} | ${board[1] || '2'} | ${board[2] || '3'}
  ---------
   ${board[3] || '4'} | ${board[4] || '5'} | ${board[5] || '6'}
  ---------
   ${board[6] || '7'} | ${board[7] || '8'} | ${board[8] || '9'}
  `);
}

function checkWin() {
  const wins = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  return wins.some(([a,b,c]) => board[a] && board[a] === board[b] && board[a] === board[c]);
}

function checkDraw() {
  return board.every(cell => cell !== null);
}

function makeMove(pos) {
  if (board[pos] || gameOver) return false;
  board[pos] = currentPlayer;
  if (checkWin()) {
    printBoard();
    console.log(`${currentPlayer} wins!`);
    gameOver = true;
  } else if (checkDraw()) {
    printBoard();
    console.log("It's a draw!");
    gameOver = true;
  } else {
    currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
    playTurn();
  }
  return true;
}

function playTurn() {
  printBoard();
  rl.question(`Player ${currentPlayer}, enter position (1-9): `, answer => {
    const pos = parseInt(answer) - 1;
    if (pos < 0 || pos > 8 || !makeMove(pos)) {
      console.log('Invalid move, try again.');
      playTurn();
    }
  });
}

function startGame() {
  console.log('Tic Tac Toe');
  playTurn();
}

startGame();