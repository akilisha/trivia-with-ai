const { io } = require("socket.io-client");
const Phaser = require("phaser");

// Establish Socket.IO connection as the first thing
const socket = io("http://localhost:3000");

// Phaser Game Configuration
const config = {
  type: Phaser.AUTO, // Automatically choose Canvas or WebGL
  width: 960, // Increased width slightly
  height: 600,
  parent: "phaser-game-container", // Phaser will create this div if it doesn't exist
  scene: {
    preload: preload,
    create: create,
    update: update,
  },
};

const game = new Phaser.Game(config);

// --- Global game variables (accessible within scene functions) ---
let currentQuestionText = null;
let answerButtons = [];
let gameTimerText = null;
let playerScoresText = null;
let gameFeedbackText = null;
let gameQuestionNumberText = null;
let gameRoomIdText = null;
let startGameButton = null; // Declare globally so `updateStartButtonVisibility` can access

let currentPhaserQuestion = null;
let currentPhaserTimerInterval = null;

// --- Game State Variables (managed on client to sync with server) ---
let currentRoomId = null;
let currentPlayerName = "Player" + Math.floor(Math.random() * 1000); // Unique name for testing
let currentPlayersInRoom = []; // Store player objects as received from server
let currentHostId = null;

// --- Phaser Scene Functions ---

function preload() {
  // No assets to preload for text-based trivia yet.
}

function create() {
  // Background rectangle
  this.add
    .rectangle(
      config.width / 2,
      config.height / 2,
      config.width,
      config.height,
      0x333333
    )
    .setOrigin(0.5);

  this.add
    .text(config.width / 2, 30, "Roya Trivia", {
      fontSize: "36px",
      fill: "#fff",
    })
    .setOrigin(0.5);
  gameRoomIdText = this.add
    .text(config.width - 20, 20, `Room: Loading...`, {
      fontSize: "18px",
      fill: "#aaa",
    })
    .setOrigin(1, 0);

  gameQuestionNumberText = this.add
    .text(config.width / 2, 90, "", { fontSize: "20px", fill: "#eee" })
    .setOrigin(0.5);
  gameTimerText = this.add
    .text(config.width / 2, 60, "", { fontSize: "24px", fill: "#ff0" })
    .setOrigin(0.5);

  currentQuestionText = this.add
    .text(config.width / 2, 180, "Waiting for players...", {
      fontSize: "28px",
      fill: "#fff",
      wordWrap: { width: config.width - 100 },
    })
    .setOrigin(0.5);

  gameFeedbackText = this.add
    .text(config.width / 2, config.height - 80, "", {
      fontSize: "28px",
      fill: "#fff",
      backgroundColor: "#333",
      padding: { x: 10, y: 5 },
    })
    .setOrigin(0.5);

  playerScoresText = this.add.text(20, 100, "Scores:", {
    fontSize: "20px",
    fill: "#fff",
  });

  // --- Temporary Control Buttons (will be replaced by React UI later) ---
  // Start Game Button
  startGameButton = this.add
    .text(config.width / 2, config.height - 30, "Start Game", {
      fontSize: "24px",
      fill: "#0f0",
      backgroundColor: "#005",
      padding: { x: 20, y: 10 },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });

  // Initial state: hidden and disabled, will be set correctly on roomJoinedSuccess
  startGameButton.setVisible(false).disableInteractive();

  startGameButton.on("pointerdown", () => {
    if (currentRoomId && socket.id === currentHostId) {
      socket.emit("startGame", currentRoomId);
      startGameButton.disableInteractive().setVisible(false); // Hide after clicking
    } else {
      gameFeedbackText
        .setText("Only the host can start the game!")
        .setColor("#f00");
    }
  });

  // Leave Room Button
  const leaveRoomButton = this.add
    .text(config.width / 2 + 150, config.height - 30, "Leave Room", {
      fontSize: "24px",
      fill: "#f00",
      backgroundColor: "#005",
      padding: { x: 20, y: 10 },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });
  leaveRoomButton.on("pointerdown", () => {
    if (currentRoomId) {
      socket.emit("leaveRoom", currentRoomId);
      currentRoomId = null;
      currentHostId = null;
      // Reset game state on client
      currentQuestionText.setText(
        "You have left the room. Refresh to join/create a new game."
      );
      gameTimerText.setText("");
      gameFeedbackText.setText("");
      playerScoresText.setText("Scores:");
      gameRoomIdText.setText("Room: N/A");
      clearAnswerButtons();
      // After leaving, ensure start button is not visible
      startGameButton.setVisible(false).disableInteractive();
    }
  });

  // --- Socket.IO Event Handlers ---

  // Handler for successful room join (from autoJoinTestRoom or create/join)
  socket.on("roomJoinedSuccess", (data) => {
    currentRoomId = data.roomId;
    currentHostId = data.roomState.hostId;
    currentPlayersInRoom = data.roomState.players;
    gameRoomIdText.setText(`Room: ${currentRoomId}`);
    updatePlayerScores(currentPlayersInRoom);
    currentQuestionText.setText("Joined room. Waiting for game to start...");

    // Call the new function to update button visibility
    updateStartButtonVisibility();
  });

  socket.on("gameStateUpdate", (data) => {
    if (data.state === "starting_game") {
      currentQuestionText.setText("Game starting...");
      gameFeedbackText.setText("");
      clearAnswerButtons();
      startGameButton.setVisible(false).disableInteractive(); // Hide start button once game starts
    }
    // Add more state handling as needed
  });

  socket.on("countdown", (count) => {
    gameTimerText.setText(`Game starting in: ${count}...`);
  });

  socket.on("newQuestion", (data) => {
    const { question, questionNumber, totalQuestions, isTimed, duration } =
      data;
    currentPhaserQuestion = question; // Store question data locally

    gameTimerText.setText(""); // Clear countdown text
    if (currentPhaserTimerInterval) clearInterval(currentPhaserTimerInterval); // Clear any previous timer

    // Update question display
    gameQuestionNumberText.setText(
      `Question ${questionNumber} of ${totalQuestions}`
    );
    currentQuestionText.setText(question.question);
    gameFeedbackText.setText(""); // Clear feedback from previous round

    // Clear old answer buttons
    clearAnswerButtons();

    // Create new answer buttons
    const startY = 320;
    const buttonSpacing = 60;
    question.answers.forEach((answer, index) => {
      const buttonY = startY + index * buttonSpacing;
      const answerButton = this.add
        .text(config.width / 2, buttonY, answer, {
          fontSize: "22px",
          fill: "#fff", // White text
          backgroundColor: "#005", // Dark blue background
          padding: { x: 20, y: 10 },
          fixedWidth: config.width - 200,
          align: "center",
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      answerButton.on("pointerdown", () => {
        // Style selected button
        answerButton.setBackgroundColor("#008"); // Darker blue
        // Disable all answer buttons after one is clicked
        answerButtons.forEach((btn) => btn.disableInteractive());

        socket.emit("submitAnswer", {
          roomId: currentRoomId,
          answer: answer,
        });
        gameFeedbackText.setText("Answer submitted!").setColor("#eee");
      });
      answerButtons.push(answerButton);
    });

    // Start client-side visual timer
    if (isTimed) {
      let timeLeft = duration / 1000;
      gameTimerText.setText(`Time left: ${timeLeft}s`);
      currentPhaserTimerInterval = setInterval(() => {
        timeLeft--;
        gameTimerText.setText(`Time left: ${timeLeft}s`);
        if (timeLeft <= 0) {
          clearInterval(currentPhaserTimerInterval);
          gameTimerText.setText("Time's up!");
          answerButtons.forEach((btn) => btn.disableInteractive()); // Disable answers
        }
      }, 1000);
    } else {
      gameTimerText.setText("Untimed round.");
    }
  });

  socket.on("roundResults", (data) => {
    const { correctAnswer, results, updatedPlayers } = data;
    if (currentPhaserTimerInterval) clearInterval(currentPhaserTimerInterval); // Stop client timer
    gameTimerText.setText(""); // Clear timer display

    // Highlight correct/incorrect answers on Phaser canvas
    answerButtons.forEach((btn) => {
      btn.disableInteractive(); // Ensure all are disabled
      if (btn.text === correctAnswer) {
        btn.setBackgroundColor("#050"); // Green for correct
      } else if (
        results[socket.id] &&
        results[socket.id].answer === btn.text &&
        !results[socket.id].correct
      ) {
        // If this button was selected by CURRENT player AND it was wrong
        btn.setBackgroundColor("#500"); // Red for incorrect selected
      } else {
        btn.setBackgroundColor("#333"); // Dim unselected/unanswered
      }
    });

    // Show feedback for current player
    const playerResult = results[socket.id];
    if (playerResult) {
      if (playerResult.correct) {
        gameFeedbackText.setText(
          `Correct! +${playerResult.pointsAwarded} points.`
        );
        gameFeedbackText.setColor("#0f0");
      } else {
        gameFeedbackText.setText(`Wrong! Correct: "${correctAnswer}"`);
        gameFeedbackText.setColor("#f00");
      }
    }

    updatePlayerScores(updatedPlayers);
  });

  socket.on("gameOver", (data) => {
    if (currentPhaserTimerInterval) clearInterval(currentPhaserTimerInterval);
    currentQuestionText.setText("Game Over!");
    gameTimerText.setText("");
    gameFeedbackText.setText("Final Scores:");
    clearAnswerButtons();
    updatePlayerScores(data.finalScores); // Use updatedPlayerScores for consistency

    // Show start button for next game IF current player is the host
    updateStartButtonVisibility();
  });

  socket.on("playerJoined", (data) => {
    currentPlayersInRoom = data.roomState?.players; // Assuming server sends full roomState on join/leave
    updatePlayerScores(currentPlayersInRoom);
    gameFeedbackText
      .setText(`${data.newPlayerName} has joined the room.`)
      .setColor("#eee");
    updateStartButtonVisibility(); // Update button visibility for all players in room
  });

  socket.on("playerLeft", (data) => {
    // Find the player in currentPlayersInRoom and remove them, then update scores.
    currentPlayersInRoom = currentPlayersInRoom.filter(
      (p) => p.id !== data.playerId
    );
    updatePlayerScores(currentPlayersInRoom);
    gameFeedbackText
      .setText(`${data.playerName} has left the room.`)
      .setColor("#eee");
    // Check if the host left and update host status/button visibility
    if (data.newHostId) {
      // newHostId is sent from server if host changed
      currentHostId = data.newHostId;
    }
    updateStartButtonVisibility();
  });

  socket.on("hostChanged", (newHostId) => {
    currentHostId = newHostId;
    updateStartButtonVisibility(); // Update button visibility immediately
    const newHostName =
      currentPlayersInRoom.find((p) => p.id === currentHostId)?.name ||
      "Someone";
    gameFeedbackText
      .setText(`${newHostName} is now the host!`)
      .setColor("#0f0");
  });

  socket.on("chatMessage", (data) => {
    console.log(`[CHAT] ${data.sender}: ${data.message}`);
    // This is where you'd append to a chat display in a full UI
  });

  socket.on("gameError", (message) => {
    console.error("Game Error:", message);
    gameFeedbackText.setText(`ERROR: ${message}`).setColor("#f00");
  });

  // Helper to clear answer buttons from the scene
  function clearAnswerButtons() {
    answerButtons.forEach((btn) => btn.destroy());
    answerButtons = [];
  }

  // Helper to update score display
  function updatePlayerScores(players) {
    currentPlayersInRoom = players; // Keep internal client list updated
    let scoreString = "Players:\n";
    if (players) {
      players
        .sort((a, b) => b.score - a.score)
        .forEach((p) => {
          // Sort for leaderboard display
          scoreString += `${p.name}: ${p.score} ${
            p.id === socket.id ? "(You)" : ""
          } ${p.id === currentHostId ? "(Host)" : ""}\n`;
        });
      playerScoresText.setText(scoreString);
    }
  }

  // New helper function to control Start Game button visibility
  function updateStartButtonVisibility() {
    if (socket.id === currentHostId) {
      startGameButton.setVisible(true).setInteractive();
    } else {
      startGameButton.setVisible(false).disableInteractive();
    }
  }

  // --- TEMPORARY AUTO-JOIN LOGIC ---
  socket.emit("autoJoinTestRoom", currentPlayerName);
}

function update() {
  // This is called every frame. Not much needed for trivia game here.
}
