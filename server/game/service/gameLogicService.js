// server/game/service/gameLogicService.js

const { shuffleArray } = require("../utils"); // Assuming utils.js is alongside services
const { getGameQuestions } = require("./questionsService"); // To load questions if needed

// This service will hold the game progression and scoring logic
let ioInstance = null; // To hold the Socket.IO instance
let gameRooms = null; // To hold the reference to the main gameRooms object

function init(io, rooms) {
    ioInstance = io;
    gameRooms = rooms;
}

// --- Game Logic Functions ---

/**
 * Starts a new game round or the game itself.
 * @param {string} roomId
 * @param {string} hostSocketId - The ID of the host's socket, for emitting errors directly.
 */
function startGameRound(roomId, hostSocketId) {
    const room = gameRooms[roomId];
    if (!room) {
        ioInstance.to(hostSocketId).emit("gameError", "Room not found.");
        return;
    }
    if (room.players.length < 1) {
        ioInstance.to(hostSocketId).emit("gameError", "Need at least 1 player to start the game.");
        return;
    }
    if (room.state === "in_progress" || room.state === "starting_game") {
        ioInstance.to(hostSocketId).emit("gameError", "Game already in progress or starting.");
        return;
    }

    // Ensure questions are loaded and assigned (should be done on room creation, but a safeguard)
    if (!room.questions || room.questions.length === 0) {
        room.questions = getGameQuestions(room.config.questionCount, room.config.questionCategories);
        if (room.questions.length === 0) {
            ioInstance.to(hostSocketId).emit("gameError", "No questions found for selected criteria. Cannot start game.");
            return;
        }
    }

    room.currentQuestionIndex = -1; // Reset for new game
    room.state = "starting_game";
    ioInstance.to(roomId).emit("gameStateUpdate", { state: room.state });
    console.log(`Room ${roomId}: Starting game...`);

    let countdown = 3;
    const startCountdownInterval = setInterval(() => {
        ioInstance.to(roomId).emit("countdown", countdown);
        countdown--;
        if (countdown < 0) {
            clearInterval(startCountdownInterval);
            sendNextQuestion(roomId);
        }
    }, 1000);
}

/**
 * Sends the next question to all players in a room.
 * @param {string} roomId
 */
function sendNextQuestion(roomId) {
    const room = gameRooms[roomId];
    if (!room) return;

    room.currentQuestionIndex++;
    if (room.currentQuestionIndex < room.config.questionCount && room.currentQuestionIndex < room.questions.length) {
        room.currentQuestion = room.questions[room.currentQuestionIndex];
        room.state = "question_active";
        room.roundAnswers = {}; // Reset answers for the new round

        // Server's authoritative start time for the question
        room.questionStartTime = Date.now();

        // Prepare question data for clients (hide correct answer)
        const questionForClients = { ...room.currentQuestion };
        delete questionForClients.correct_answer; // Always hide correct answer initially

        // Handle specific delivery modes for answer presentation on client
        // 'answers' array is only for multiple choice / pick_odd_one_out
        if (questionForClients.type === 'multiple_choice' ||
            questionForClients.type === 'image_question' ||
            questionForClients.type === 'audio_question' ||
            questionForClients.type === 'pick_odd_one_out') {

            // Ensure answers are shuffled before sending
            const answersToShuffle = [...(room.currentQuestion.incorrect_answers || [])];
            if (room.currentQuestion.correct_answer !== undefined) {
                answersToShuffle.push(room.currentQuestion.correct_answer);
            }
            questionForClients.answers = shuffleArray(answersToShuffle);

        } else if (questionForClients.type === 'numeric_answer' ||
                   questionForClients.type === 'fill_in_the_blank' ||
                   questionForClients.type === 'ordered_list' ||
                   questionForClients.type === 'no_specific_answer') {
            // These types don't have pre-defined "answers" to shuffle for UI buttons
            questionForClients.answers = [];
        }
        // For 'match_items', questionForClients would need specific structured data

        ioInstance.to(roomId).emit("newQuestion", {
            question: questionForClients,
            questionNumber: room.currentQuestionIndex + 1,
            totalQuestions: room.config.questionCount,
            gameConfig: room.config, // Send full game config to client for rendering decisions
        });
        console.log(`Room ${roomId}: Question ${room.currentQuestionIndex + 1} sent. Type: ${room.currentQuestion.type}`);

        // Handle progression mode
        if (room.config.progressionMode === "auto") {
            if (room.timer) clearTimeout(room.timer);
            room.timer = setTimeout(() => {
                endQuestionRound(roomId);
            }, room.config.roundDuration);
        } else if (room.config.progressionMode === "semi_auto") {
            // No specific timer here, relies on all players answering or host forcing
            console.log(`Room ${roomId}: Semi-auto mode. Waiting for all players or host override.`);
        }
        // Manual mode has no timer, relies on host 'forceNextQuestion'
    } else {
        endGame(roomId);
    }
}

/**
 * Ends the current question round, calculates scores, and sends results to players.
 * @param {string} roomId
 */
function endQuestionRound(roomId) {
    const room = gameRooms[roomId];
    if (!room || room.state !== "question_active") return;

    room.state = "revealing_answer";
    if (room.timer) clearTimeout(room.timer); // Ensure timer is cleared

    const correctAnswer = room.currentQuestion.correct_answer;
    const roundResults = {};
    // let streakTracker = {}; // For streak bonus - requires per-player tracking across rounds

    room.players.forEach(player => {
        const playerAnswerData = room.roundAnswers[player.id];
        let pointsAwarded = 0;
        let correct = false;
        let timeTaken = 0;

        if (playerAnswerData) {
            const submittedAnswer = playerAnswerData.answer;
            timeTaken = playerAnswerData.timeTaken || (Date.now() - room.questionStartTime);

            // --- Scoring Logic based on room.config.pointsScoring & question.type ---
            if (room.config.pointsAvailable === 'none' || room.config.pointsScoring === 'none') {
                pointsAwarded = 0; // No points in survey mode or if points are specifically set to none
            } else {
                switch (room.currentQuestion.type) {
                    case 'multiple_choice':
                    case 'image_question':
                    case 'audio_question':
                    case 'fill_in_the_blank':
                    case 'pick_odd_one_out':
                        correct = (String(submittedAnswer).toLowerCase() === String(correctAnswer).toLowerCase());
                        break;
                    case 'numeric_answer':
                        const numAnswer = parseFloat(submittedAnswer);
                        const correctNum = parseFloat(correctAnswer);
                        if (!isNaN(numAnswer) && !isNaN(correctNum)) {
                            if (room.config.pointsScoring === 'close_but_not_over') {
                                const minRange = room.currentQuestion.acceptable_range_min || (correctNum * 0.9); // Default 10% below
                                const maxRange = room.currentQuestion.acceptable_range_max || (correctNum * 1.1); // Default 10% above

                                if (numAnswer >= minRange && numAnswer <= maxRange) {
                                    correct = true; // Considered "correct range"
                                    const distance = Math.abs(numAnswer - correctNum);
                                    // Use a smaller divisor for rangeWidth if points decay quickly within range
                                    const rangeForScoring = (maxRange - minRange) / 2; // Decay from middle to edges
                                    pointsAwarded = Math.round(room.currentQuestion.points * (1 - (distance / rangeForScoring)));
                                    pointsAwarded = Math.max(0, pointsAwarded); // Ensure non-negative points
                                }
                            } else { // All or Nothing for numeric, or other non-range scoring
                                correct = (numAnswer === correctNum);
                            }
                        }
                        break;
                    case 'ordered_list':
                        // For ordered list, submittedAnswer is an array. correctAnswer is also an array.
                        const submittedList = Array.isArray(submittedAnswer) ? submittedAnswer.map(s => String(s).toLowerCase()) : [];
                        const correctList = Array.isArray(correctAnswer) ? correctAnswer.map(s => String(s).toLowerCase()) : [];
                        const aliases = room.currentQuestion.aliases || {};

                        correct = true; // Assume correct, then disprove
                        if (submittedList.length !== correctList.length || submittedList.length === 0) {
                            correct = false;
                        } else {
                            for (let i = 0; i < correctList.length; i++) {
                                const submittedItem = submittedList[i];
                                const correctItem = correctList[i];
                                const allowedAliases = aliases[correctItem] ? aliases[correctItem].map(a => String(a).toLowerCase()) : [];

                                if (submittedItem !== correctItem && !allowedAliases.includes(submittedItem)) {
                                    correct = false;
                                    break;
                                }
                            }
                        }
                        // Basic all or nothing for ordered list for now. Can extend to partial scoring later.
                        break;
                    case 'no_specific_answer': // For surveys, no 'correct' answer, no points.
                        correct = true; // Always 'correct' as no wrong answer for scoring
                        pointsAwarded = 0;
                        break;
                    // Add cases for 'match_items' if implemented
                    default:
                        correct = false; // Default to incorrect for unknown types
                }

                // Base points based on correctness
                if (correct) {
                    if (room.config.pointsScoring === 'countdown') {
                        const maxScore = room.currentQuestion.points;
                        const timeBonusFactor = 0.5; // Adjust how much time affects score
                        const remainingTime = room.config.roundDuration - timeTaken;
                        const adjustedRemainingTime = Math.max(0, remainingTime);
                        pointsAwarded = Math.round(maxScore + (adjustedRemainingTime / room.config.roundDuration) * maxScore * timeBonusFactor);
                    } else if (room.config.pointsScoring === 'all_or_nothing' || room.config.pointsScoring === 'close_but_not_over') {
                        // For 'close_but_not_over', pointsAwarded is already calculated in the switch case.
                        // For 'all_or_nothing', it's the base points.
                        if (room.config.pointsScoring === 'all_or_nothing') {
                            pointsAwarded = room.currentQuestion.points;
                        }
                    }
                } else { // Incorrect answer
                    if (room.config.pointsScoring === 'bad_choices_consequences') {
                        pointsAwarded = -Math.round(room.currentQuestion.points * 0.5); // Lose half points, for example
                    } else {
                        pointsAwarded = 0;
                    }
                }
            } // End if pointsAvailable/pointsScoring is not 'none'


            // Apply Modifiers (G. Cross-Cutting)
            // G.2 Streak Bonus Points (Requires player.consecutiveCorrectAnswers state)
            if (room.config.modifiers.streakBonus) {
                // Placeholder: If player has a consecutiveCorrectAnswers property and it's > 1, apply bonus
                // Example: if (player.consecutiveCorrectAnswers && player.consecutiveCorrectAnswers >= 2) { pointsAwarded += 50; }
                // This would need to be tracked on the player object across rounds.
            }
            // G.3 Double Points Round
            if (room.config.modifiers.doublePointsRound) {
                // Check if current round is a 'double points round'
                // Example: if (room.currentRoundNumber is in doublePointsRounds array) { pointsAwarded *= 2; }
            }
            // G.1 Bonus Round Option
            if (room.config.modifiers.bonusRound) {
                // Logic here if points are handled differently in a bonus round
            }
        } else { // Player didn't answer
            correct = false;
            pointsAwarded = 0;
        }

        // Apply points to player score
        player.score += pointsAwarded;

        roundResults[player.id] = {
            answered: !!playerAnswerData,
            submittedAnswer: playerAnswerData ? playerAnswerData.answer : null, // Send back what they submitted
            correct: correct,
            pointsAwarded: pointsAwarded,
            timeTaken: timeTaken,
            totalScore: player.score
        };
    });

    // Clean up currentQuestion to ensure only what's needed is sent.
    const fullQuestionForDisplay = { ...room.currentQuestion }; // Keep the full object for display on client

    ioInstance.to(roomId).emit("roundResults", {
        question: fullQuestionForDisplay, // Send the full question (with correct answer) for display
        correctAnswer: correctAnswer, // Redundant but explicit for clarity
        results: roundResults,
        updatedPlayers: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
    });
    console.log(`Room ${roomId}: Round results sent.`);

    // Determine next action based on progression mode
    let nextActionDelay = room.config.durationBetweenQuestions; // Standard delay

    if (room.config.answerFeedback === 'no_feedback') {
        nextActionDelay = 0; // No delay if no feedback shown
    }

    if (room.config.progressionMode === 'auto') {
        setTimeout(() => {
            sendNextQuestion(roomId);
        }, nextActionDelay);
    } else {
        // For manual/semi-auto, game waits for host to force or all players in semi-auto to submit
        console.log(`Room ${roomId}: Waiting for host to advance or all players for SemiAuto.`);
        room.state = 'waiting_for_host_advance'; // New state for semi-auto/manual wait
        ioInstance.to(roomId).emit('gameStateUpdate', { state: room.state }); // Inform clients
    }
}

/**
 * Ends the game for a room.
 * @param {string} roomId
 */
function endGame(roomId) {
    const room = gameRooms[roomId];
    if (!room) return;

    room.state = "game_over";

    const finalScores = [...room.players].sort((a, b) => b.score - a.score);

    ioInstance.to(roomId).emit("gameOver", { finalScores: finalScores, gameConfig: room.config });
    console.log(`Room ${roomId}: Game Over.`);
    room.chatMessages = []; // Clear chat
    // Room can be cleaned up after a delay or on host action in a real app
    // For now, it stays in gameRooms for inspection until host deletes or server restarts
}

/**
 * Handles a player's submitted answer.
 * @param {string} roomId
 * @param {string} playerId
 * @param {any} answer
 * @param {number} timeTaken - Client-reported time taken (server will re-validate)
 * @param {number} [wager=0] - Optional wager amount.
 */
function submitAnswer(roomId, playerId, answer, timeTaken, wager = 0) {
    const room = gameRooms[roomId];
    if (!room || room.state !== 'question_active') {
        ioInstance.to(playerId).emit('gameError', 'Cannot submit answer: question not active or room not found.');
        return;
    }

    if (!room.roundAnswers[playerId]) { // Prevent multiple answers for a round
        // Server-authoritative time calculation (overrides client-reported if needed)
        const serverTimeTaken = Date.now() - room.questionStartTime;
        room.roundAnswers[playerId] = { answer, timeTaken: serverTimeTaken, wager: wager };
        ioInstance.to(roomId).emit('playerAnswered', { playerId: playerId });

        // If semi-auto and all active players have answered, end round
        const answeredPlayersCount = Object.keys(room.roundAnswers).length;
        const activePlayersCount = room.players.length; // Only count players currently in the room

        if (room.config.progressionMode === 'semi_auto' && answeredPlayersCount === activePlayersCount) {
            if (room.timer) clearTimeout(room.timer);
            console.log(`Room ${roomId}: All players answered in Semi-Auto mode.`);
            endQuestionRound(roomId);
        }
    } else {
        ioInstance.to(playerId).emit('gameError', 'You have already submitted an answer for this round.');
    }
}


module.exports = {
    init,
    startGameRound,
    sendNextQuestion,
    endQuestionRound,
    endGame,
    submitAnswer
};