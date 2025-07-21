// ./src/index.js

import { io } from 'socket.io-client';
import Phaser from 'phaser';

// --- Global Client-Side State ---
let socket;
let currentRoomId = null;
let hostId = null;
let currentQuestion = null;
let currentGameConfig = null;
let clientQuestionStartTime = 0;
let playerName = `Player${Math.floor(Math.random() * 1000)}`;
let isHost = false;

// --- Phaser Game Configuration ---
const config = {
    type: Phaser.AUTO,
    width: 960,
    height: 600,
    parent: "phaser-game-container",
    scene: {
        preload: preload,
        create: create,
        update: update,
    },
    dom: {
        createContainer: true
    },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    backgroundColor: '#1a1a2e' // A dark background color
};

let game = new Phaser.Game(config);

// --- Phaser Scene Functions ---

function preload() {
    // Load any assets here
    this.load.image('button_background', 'assets/button_background.png');
    this.load.image('game_background', 'assets/game_background.png'); // New: for a background image
}

function create() {
    const gameWidth = this.game.config.width;
    const gameHeight = this.game.config.height;

    // --- Background ---
    this.add.tileSprite(0, 0, gameWidth, gameHeight, 'game_background')
        .setOrigin(0, 0)
        .setDisplaySize(gameWidth, gameHeight);

    // --- Static UI Elements (Header) ---
    this.questionNumberText = this.add.text(50, 20, '', { fontSize: '24px', fill: '#8FE3F5' });
    this.timerText = this.add.text(gameWidth - 50, 20, 'Time: --', { fontSize: '24px', fill: '#8FE3F5' }).setOrigin(1, 0);

    // --- Dynamic Content Containers/Groups ---
    this.questionText = this.add.text(gameWidth / 2, 100, '', {
        fontSize: '32px',
        fill: '#E0BBE4', // Purple tone for questions
        wordWrap: { width: gameWidth - 100 },
        align: 'center'
    }).setOrigin(0.5);

    this.messageText = this.add.text(gameWidth / 2, gameHeight - 50, '', {
        fontSize: '20px',
        fill: '#FFC72C', // Gold for messages
        align: 'center',
        wordWrap: { width: gameWidth - 100 }
    }).setOrigin(0.5);

    this.answerContainer = this.add.group(); // For answer buttons/inputs
    this.hostControlsContainer = this.add.group(); // For host buttons
    this.scoreboardContainer = this.add.group(); // For scoreboard
    this.lobbyPlayersContainer = this.add.group(); // For lobby player list

    // --- Initial UI State ---
    this.questionNumberText.setText('');
    this.timerText.setText('');
    this.questionText.setText('Welcome to Roya Trivia!');
    this.messageText.setText('Connecting to server...');

    // Connect to Socket.IO
    this.connectToServer();
}

function update() {
    // Game loop logic, if any
}

// --- Socket.IO Connection and Event Listeners (Scene Methods) ---
Phaser.Scene.prototype.connectToServer = function() {
    socket = io('http://localhost:3000');

    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
        this.displayMessage('Connected! Auto-joining test room...', 'info');
        socket.emit('autoJoinTestRoom', playerName);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        this.resetGameUI();
        this.displayMessage('Disconnected from server.', 'error');
    });

    socket.on('roomJoinedSuccess', (data) => {
        const { roomId, roomState } = data;
        currentRoomId = roomId;
        hostId = roomState.hostId;
        isHost = (socket.id === hostId);
        console.log(`Successfully joined room: ${roomId}`);
        console.log('Room State:', roomState);
        this.updateLobbyUI(roomState);
        this.displayMessage(`Joined room "${roomState.gameTitle}"! Waiting for players...`, 'info');

        if (isHost) {
            this.showHostControls(roomState.gameConfig);
        } else {
            this.hideHostControls();
        }
    });

    socket.on('playerJoined', (data) => {
        const { newPlayerName, roomState } = data;
        console.log(`${newPlayerName} joined the room.`);
        this.updateLobbyUI(roomState);
        this.displayMessage(`${newPlayerName} joined the game!`, 'info');
    });

    socket.on('playerLeft', (data) => {
        const { playerName, roomState, kickedByHost } = data;
        console.log(`${playerName} left the room.`);
        this.updateLobbyUI(roomState);
        let message = `${playerName} left the game.`;
        if (kickedByHost) {
            message = `${playerName} was kicked by the host.`;
        }
        this.displayMessage(message, 'warning');
    });

    socket.on('hostChanged', (newHostId) => {
        hostId = newHostId;
        isHost = (socket.id === hostId);
        this.displayMessage(`Host changed to ${hostId}.`, 'info');
        if (isHost) {
            this.showHostControls(currentGameConfig);
        } else {
            this.hideHostControls();
        }
    });

    socket.on('gameError', (message) => {
        console.error('Game Error:', message);
        this.displayMessage(`Error: ${message}`, 'error');
    });

    socket.on('gameStateUpdate', (data) => {
        console.log('Game state updated:', data.state);
        if (data.state === 'starting_game') {
            this.displayMessage('Game is starting soon!', 'info');
        } else if (data.state === 'waiting_for_host_advance') {
            this.displayMessage('Waiting for host to advance...', 'info');
            if (isHost) {
                this.showHostControls(currentGameConfig);
            }
        }
    });

    socket.on('countdown', (count) => {
        this.displayMessage(`Game starting in ${count}...`, 'info');
    });

    socket.on('newQuestion', (data) => {
        const { question, questionNumber, totalQuestions, gameConfig } = data;
        console.log('New Question Received:', question);

        currentQuestion = question;
        currentGameConfig = gameConfig;
        clientQuestionStartTime = Date.now();

        this.clearQuestionUI();
        this.hideHostControls(); // Hide host controls during question phase

        this.questionNumberText.setText(`Question: ${questionNumber} / ${totalQuestions}`);
        this.questionText.setText(question.question);

        let yOffsetForAnswers = this.questionText.y + this.questionText.displayHeight / 2 + 50; // Start answers below question

        switch (question.type) {
            case 'multiple_choice':
            case 'image_question':
                if (question.image_url) {
                    this.displayImage(question.image_url, this.game.config.width / 2, yOffsetForAnswers + 50); // Image below question
                    yOffsetForAnswers += 150; // Push buttons down
                }
            case 'audio_question':
                if (question.audio_url) {
                    this.playAudio(question.audio_url);
                    this.displayMessage('Playing audio...', 'info');
                    yOffsetForAnswers += 50; // Push buttons down if audio controls are shown
                }
            case 'pick_odd_one_out':
                if (question.answers && question.answers.length > 0) {
                    const buttonSpacingY = 70; // Vertical space between buttons
                    const numColumns = 2; // Arrange buttons in 2 columns
                    const buttonWidth = 350;
                    const startXLeft = this.game.config.width / 2 - buttonWidth / 2 - 20; // Left column X
                    const startXRight = this.game.config.width / 2 + buttonWidth / 2 + 20; // Right column X

                    question.answers.forEach((answerOption, index) => {
                        const col = index % numColumns;
                        const row = Math.floor(index / numColumns);
                        const x = (col === 0) ? startXLeft : startXRight;
                        const y = yOffsetForAnswers + (row * buttonSpacingY);

                        this.createButton(x, y, answerOption, () => {
                            this.submitPlayerAnswer(answerOption);
                        });
                    });
                } else {
                    this.displayMessage('Error: No answer options provided.', 'error');
                }
                break;

            case 'fill_in_the_blank':
                this.createTextInput(this.game.config.width / 2, yOffsetForAnswers, (submittedText) => {
                    this.submitPlayerAnswer(submittedText);
                });
                this.displayMessage('Type your answer in the box below.', 'info');
                break;

            case 'numeric_answer':
                this.createTextInput(this.game.config.width / 2, yOffsetForAnswers, (submittedNumber) => {
                    this.submitPlayerAnswer(parseFloat(submittedNumber));
                }, true); // Pass true for numeric input hint
                this.displayMessage('Enter a number in the box below.', 'info');
                break;

            case 'ordered_list':
                if (question.items && question.items.length > 0) {
                    this.createDraggableList(question.items, this.game.config.width / 2, yOffsetForAnswers, (orderedArray) => {
                        this.submitPlayerAnswer(orderedArray);
                    });
                    this.displayMessage('Order the items correctly (conceptual drag-and-drop).', 'info');
                } else {
                    this.displayMessage('Error: No items to order for this question.', 'error');
                }
                break;

            case 'no_specific_answer':
                this.displayMessage("No specific answer is required. Click 'Acknowledge'.", 'info');
                this.createButton(this.game.config.width / 2, yOffsetForAnswers, "Acknowledge / Next", () => {
                    this.submitPlayerAnswer("Acknowledged");
                });
                break;

            default:
                this.displayMessage(`Unknown question type: ${question.type}. Cannot display answer options.`, 'error');
                console.warn(`Client received unknown question type: ${question.type}`, question);
                break;
        }

        if (currentGameConfig.progressionMode === 'auto') {
            this.startClientTimer(currentGameConfig.roundDuration);
        }

        if (isHost && (currentGameConfig.progressionMode === 'manual' || currentGameConfig.progressionMode === 'semi_auto')) {
            this.showHostControls(currentGameConfig);
        }
    });

    socket.on('playerAnswered', (data) => {
        console.log(`Player ${data.playerId} submitted an answer.`);
        // Optional: Update scoreboard or player list to indicate they've answered
    });

    socket.on('roundResults', (data) => {
        const { question, correctAnswer, results, updatedPlayers } = data;
        console.log('Round Results:', data);

        this.clearQuestionUI();
        this.stopClientTimer();

        this.displayRoundResults(question, correctAnswer, results, updatedPlayers);
        this.displayMessage('Round results are in!', 'info');

        this.updateScoreboard(updatedPlayers);

        if (isHost && (currentGameConfig.progressionMode === 'manual' || currentGameConfig.progressionMode === 'semi_auto')) {
             this.showHostControls(currentGameConfig);
        }
    });

    socket.on('gameOver', (data) => {
        const { finalScores, gameConfig } = data;
        console.log('Game Over!', finalScores);
        this.clearQuestionUI();
        this.stopClientTimer();

        this.displayFinalResults(finalScores);
        this.displayMessage('Game Over! See final scores.', 'info');
    });

    socket.on('kickedFromRoom', (data) => {
        console.warn(`Kicked from room ${data.roomId}: ${data.message}`);
        socket.disconnect();
        this.resetGameUI();
        this.displayMessage(`You were kicked from the room: ${data.message}`, 'error');
    });

    socket.on('chatMessage', (msg) => {
        this.addChatMessage(msg);
    });
};

// --- UI Management Functions (Integrated with Phaser 'this' context) ---

Phaser.Scene.prototype.resetGameUI = function() {
    this.clearQuestionUI();
    this.questionText.setText('Welcome to Roya Trivia!');
    this.messageText.setText('Connect to server to play.');
    this.questionNumberText.setText('');
    this.timerText.setText('');
    this.hideHostControls();
    this.lobbyPlayersContainer.clear(true, true);
    this.scoreboardContainer.clear(true, true);
};

Phaser.Scene.prototype.updateLobbyUI = function(roomState) {
    this.lobbyPlayersContainer.clear(true, true);
    const lobbyX = 50;
    let lobbyY = 150;

    this.add.text(lobbyX, lobbyY - 50, `Room ID: ${roomState.roomId}`, { fontSize: '20px', fill: '#FFF' }).setOrigin(0);
    this.add.text(lobbyX, lobbyY - 20, `Game Title: "${roomState.gameTitle}"`, { fontSize: '20px', fill: '#FFF' }).setOrigin(0);
    this.add.text(lobbyX, lobbyY + 20, 'Players in Lobby:', { fontSize: '22px', fill: '#FFF' }).setOrigin(0);

    roomState.players.forEach((player, index) => {
        const playerText = this.add.text(lobbyX + 20, lobbyY + 50 + (index * 25),
            `${player.name} (Score: ${player.score})`,
            { fontSize: '18px', fill: '#FFF' }
        ).setOrigin(0);
        if (player.id === roomState.hostId) {
            playerText.setText(playerText.text + ' (Host)');
            playerText.setFill('#0F0'); // Green for host
        }
        this.lobbyPlayersContainer.add(playerText);
    });
};

Phaser.Scene.prototype.clearQuestionUI = function() {
    this.questionText.setText('');
    this.answerContainer.clear(true, true);
    this.messageText.setText('');
    if (this.currentImage) {
        this.currentImage.destroy();
        this.currentImage = null;
    }
    if (this.currentAudio) {
        this.currentAudio.stop(); // Stop audio playback
        this.currentAudio.destroy(); // Destroy audio object
        this.currentAudio = null;
    }
    // Also clear any emulated input text
    if (this.currentInputText) {
        this.currentInputText.destroy();
        this.currentInputText = null;
        if (this.inputKeyListener) {
            this.inputKeyListener.destroy();
            this.inputKeyListener = null;
        }
        if (this.inputSubmitButton) {
            this.inputSubmitButton.destroy();
            this.inputSubmitButton = null;
        }
    }
};

Phaser.Scene.prototype.displayImage = function(url, x, y) {
    // For dynamic URLs, you'd need to load it first if not preloaded.
    // E.g., this.load.image('dynamic_img', url); this.load.once('complete', () => { ... }); this.load.start();
    // For now, using a placeholder image and setting its URL conceptually.
    if (this.currentImage) this.currentImage.destroy(); // Remove old image if any
    this.currentImage = this.add.image(x, y, 'button_background'); // Using button_background as placeholder
    this.currentImage.setOrigin(0.5);
    this.currentImage.displayWidth = 250;
    this.currentImage.displayHeight = 180;
    this.displayMessage(`Displaying image from: ${url} (placeholder used)`, 'info');
    this.answerContainer.add(this.currentImage); // Add to group for clearing
};

Phaser.Scene.prototype.playAudio = function(url) {
    // Similar to images, you'd preload audio.
    // For conceptual playback, create a button that "plays" it.
    if (this.currentAudio) this.currentAudio.stop(); // Stop previous audio

    // Example: If you had preloaded 'my_audio_key'
    // this.currentAudio = this.sound.add('my_audio_key');
    // this.currentAudio.play();
    this.displayMessage(`Playing audio from: ${url} (conceptual audio)`, 'info');

    // Create a conceptual play button for audio
    const audioBtn = this.createButton(this.game.config.width / 2, this.questionText.y + this.questionText.displayHeight + 30, "Play Audio", () => {
        // Here you would put your actual audio playback logic
        // if (this.currentAudio) this.currentAudio.play();
        this.displayMessage('Audio playing...', 'info');
    });
    this.answerContainer.add(audioBtn.bg);
    this.answerContainer.add(audioBtn.text);
};


Phaser.Scene.prototype.createButton = function(x, y, text, onClick) {
    const buttonBg = this.add.image(x, y, 'button_background')
        .setInteractive()
        .on('pointerdown', onClick)
        .setOrigin(0.5)
        .setScale(1.2); // Make it a bit bigger for visibility

    const buttonText = this.add.text(x, y, text, {
        fontSize: '24px',
        fill: '#FFFFFF',
        wordWrap: { width: buttonBg.displayWidth - 20 },
        align: 'center'
    }).setOrigin(0.5);

    this.answerContainer.add(buttonBg);
    this.answerContainer.add(buttonText);
    return { bg: buttonBg, text: buttonText };
};

// Emulated Text Input for Phaser
Phaser.Scene.prototype.createTextInput = function(x, y, onSubmit, isNumeric = false) {
    let inputTextValue = '';
    const inputBg = this.add.rectangle(x, y, 400, 50, 0x555555).setOrigin(0.5);
    this.currentInputText = this.add.text(x, y, isNumeric ? 'Enter number...' : 'Type your answer...', {
        fontSize: '24px',
        fill: '#FFF',
        fixedWidth: 380,
        wordWrap: { width: 380 }
    }).setOrigin(0.5);

    const submitBtn = this.createButton(x + 250, y, 'Submit', () => { // Position submit button to the right of input
        onSubmit(inputTextValue);
        this.inputKeyListener.destroy();
        this.inputKeyListener = null;
        inputBg.setFillStyle(0x333333);
        if (this.currentInputText) this.currentInputText.setFill('#888');
        if (this.inputSubmitButton) this.inputSubmitButton.disableInteractive();
    });
    // Remove the conceptual button text from the submitBtn object and add just its background
    this.inputSubmitButton = submitBtn.bg;

    this.inputKeyListener = this.input.keyboard.on('keydown', (event) => {
        if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.BACKSPACE) {
            inputTextValue = inputTextValue.substr(0, inputTextValue.length - 1);
        } else if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.ENTER) {
            onSubmit(inputTextValue);
            this.inputKeyListener.destroy();
            this.inputKeyListener = null;
            inputBg.setFillStyle(0x333333);
            if (this.currentInputText) this.currentInputText.setFill('#888');
            if (this.inputSubmitButton) this.inputSubmitButton.disableInteractive();
        } else if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.SPACE) {
            inputTextValue += ' ';
        } else if (event.key.length === 1 && (isNumeric ? /[0-9.]/.test(event.key) : true)) {
            inputTextValue += event.key;
        }
        this.currentInputText.setText(inputTextValue || (isNumeric ? 'Enter number...' : 'Type your answer...')); // Placeholder if empty
    });

    this.answerContainer.add(inputBg);
    this.answerContainer.add(this.currentInputText);
    this.answerContainer.add(submitBtn.bg);
    this.answerContainer.add(submitBtn.text);
};


Phaser.Scene.prototype.createDraggableList = function(items, x, y, onSubmit) {
    // This remains highly conceptual. For proper drag-and-drop,
    // you'd need a plugin or significant custom code.
    let currentOrder = [...items];

    this.add.text(x, y - 30, 'Reorder these items (conceptual):', { fontSize: '20px', fill: '#FFF' }).setOrigin(0.5);

    let itemDisplayY = y;
    currentOrder.forEach((itemText, index) => {
        const textObj = this.add.text(x, itemDisplayY + (index * 40),
            `${index + 1}. ${itemText}`,
            { fontSize: '22px', fill: '#FFF' }
        ).setOrigin(0.5);
        this.answerContainer.add(textObj);
    });

    this.createButton(x, itemDisplayY + (items.length * 40) + 50, "Submit Order (Conceptual)", () => {
        // In a real implementation, you'd get the actual reordered list here
        onSubmit(currentOrder);
    });
};

Phaser.Scene.prototype.disableAnswerInput = function() {
    this.answerContainer.children.each(child => {
        if (child.isSprite || child.isRectangle || (child.texture && child.texture.key === 'button_background')) {
            child.disableInteractive();
            child.setAlpha(0.5); // Dim the background
        }
        if (child.isText) {
             child.setFill('#888'); // Dim text
        }
    });

    if (this.currentInputText && this.inputKeyListener) {
        this.inputKeyListener.destroy();
        this.inputKeyListener = null;
        this.currentInputText.setFill('#888');
        if (this.inputSubmitButton) {
            this.inputSubmitButton.disableInteractive();
            this.inputSubmitButton.setAlpha(0.5);
        }
    }
};

let clientTimerInterval = null;
Phaser.Scene.prototype.startClientTimer = function(duration) {
    this.stopClientTimer();
    let remainingTime = duration / 1000;
    this.timerText.setText(`Time: ${remainingTime}s`);

    clientTimerInterval = setInterval(() => {
        remainingTime--;
        this.timerText.setText(`Time: ${remainingTime}s`);
        if (remainingTime <= 0) {
            this.stopClientTimer();
            this.displayMessage('Time\'s up!', 'warning');
            this.disableAnswerInput();
        }
    }, 1000);
};

Phaser.Scene.prototype.stopClientTimer = function() {
    if (clientTimerInterval) {
        clearInterval(clientTimerInterval);
        clientTimerInterval = null;
    }
    this.timerText.setText('Time: --');
};

Phaser.Scene.prototype.displayMessage = function(message, type = 'info') {
    this.messageText.setText(message);
    let color = '#FFFFFF'; // Default white
    if (type === 'error') color = '#FF6B6B'; // Red
    if (type === 'warning') color = '#FFD166'; // Orange
    if (type === 'info') color = '#8FE3F5'; // Cyan
    this.messageText.setFill(color);
    console.log(`[${type.toUpperCase()}] ${message}`);
};

Phaser.Scene.prototype.submitPlayerAnswer = function(answer) {
    if (!currentRoomId || !currentQuestion) {
        console.error('Cannot submit answer: Room or question not set.');
        this.displayMessage('Cannot submit answer: Game state error.', 'error');
        return;
    }

    if (currentQuestion.answered) {
        this.displayMessage('You already submitted an answer for this round.', 'warning');
        return;
    }

    const timeTaken = Date.now() - clientQuestionStartTime;
    socket.emit('submitAnswer', {
        roomId: currentRoomId,
        answer: answer,
        timeTaken: timeTaken,
    });
    currentQuestion.answered = true;
    this.disableAnswerInput();
    this.displayMessage('Answer submitted! Waiting for results...', 'info');
};

Phaser.Scene.prototype.displayRoundResults = function(question, correctAnswer, results, updatedPlayers) {
    this.clearQuestionUI();
    this.questionText.setText(`Question: ${question.question}\n\nCorrect Answer: ${correctAnswer}`);

    let resultText = 'Player Results:\n';
    updatedPlayers.forEach(player => {
        const res = results[player.id];
        if (res) {
            const answerStatus = res.correct ? 'Correct!' : 'Incorrect!';
            const points = res.pointsAwarded !== undefined ? ` (${res.pointsAwarded} pts)` : '';
            const submitted = res.submittedAnswer !== null ? `Answered: ${res.submittedAnswer}` : 'No Answer';
            resultText += `${player.name}: ${answerStatus} ${submitted}${points} (Time: ${(res.timeTaken / 1000).toFixed(2)}s)\n`;
        }
    });

    // Displaying detailed results above the message area
    const resultsDisplay = this.add.text(this.game.config.width / 2, this.game.config.height / 2 + 50, resultText, {
        fontSize: '20px',
        fill: '#FFF',
        wordWrap: { width: this.game.config.width - 100 },
        align: 'center'
    }).setOrigin(0.5);
    this.answerContainer.add(resultsDisplay); // Add to answerContainer for clearing
    this.displayMessage('Round results are in!', 'info');

    this.updateScoreboard(updatedPlayers);
};

Phaser.Scene.prototype.updateScoreboard = function(players) {
    this.scoreboardContainer.clear(true, true);
    const scoreboardX = this.game.config.width - 100; // Position near right edge
    let scoreboardY = 150;

    this.add.text(scoreboardX, scoreboardY - 20, 'Scoreboard:', { fontSize: '24px', fill: '#FFF' }).setOrigin(1, 0);

    players.sort((a, b) => b.score - a.score).forEach((player, index) => {
        const scoreText = this.add.text(scoreboardX, scoreboardY + (index * 25),
            `${player.name}: ${player.score} pts`,
            { fontSize: '18px', fill: '#FFF' }
        ).setOrigin(1, 0); // Align right
        this.scoreboardContainer.add(scoreText);
    });
};

Phaser.Scene.prototype.displayFinalResults = function(finalScores) {
    this.clearQuestionUI();
    this.questionText.setText('Game Over! Final Scores:');
    this.messageText.setText('');

    let yPos = this.game.config.height / 2 - 50;
    finalScores.sort((a, b) => b.score - a.score).forEach((player, index) => {
        const finalScoreText = this.add.text(this.game.config.width / 2, yPos + (index * 30),
            `${index + 1}. ${player.name}: ${player.score} points`,
            { fontSize: '28px', fill: '#FFF' }
        ).setOrigin(0.5);
        this.scoreboardContainer.add(finalScoreText);
    });
    this.displayMessage('Thanks for playing!', 'info');
};

Phaser.Scene.prototype.showHostControls = function(config) {
    this.hostControlsContainer.clear(true, true);
    let xOffset = this.game.config.width / 2;
    let yOffset = this.game.config.height - 100; // Position higher than messages

    const startGameBtn = this.createButton(xOffset, yOffset, 'Start Game / Force Next', () => {
        if (currentRoomId) {
            socket.emit('startGame', currentRoomId);
        } else {
            this.displayMessage('Error: Not in a room to start/force question.', 'error');
        }
    });
    this.hostControlsContainer.add(startGameBtn.bg);
    this.hostControlsContainer.add(startGameBtn.text);
};

Phaser.Scene.prototype.hideHostControls = function() {
    this.hostControlsContainer.clear(true, true);
};

Phaser.Scene.prototype.addChatMessage = function(msg) {
    // For a real chat, integrate an HTML overlay or a Phaser chat plugin.
    // For now, it will update the general message area.
    let chatMessageText = '';
    if (msg.type === 'private') {
        chatMessageText = msg.isOutgoing ? `(To ${msg.recipientName || msg.targetPlayerId}): ${msg.message}` : `(Private from ${msg.sender}): ${msg.message}`;
    } else {
        chatMessageText = `${msg.sender}: ${msg.message}`;
    }
    console.log(`[CHAT] ${chatMessageText}`);
    this.displayMessage(`New chat: ${chatMessageText}`, 'info');
};