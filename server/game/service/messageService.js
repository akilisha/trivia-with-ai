// server/game/service/messageService.js

// Moved generateRoomId to utils.js
// const generateRoomId = () => Math.random().toString(36).substring(2, 9).toUpperCase();

function initialGameConfig(gameConfig) {
    // Default game configuration, overridden by host's gameConfig
    const defaultGameConfig = {
        progressionMode: "auto", // 'manual', 'auto', 'semi_auto'
        answerFeedback: "show_after_question", // 'no_feedback', 'show_after_question'
        pointsAvailable: "organizer_set", // 'none', 'organizer_set', 'bet_wager'
        pointsScoring: "all_or_nothing", // 'all_or_nothing', 'countdown', 'close_but_not_over', 'bad_choices_consequences'
        multipleChoices: "no_clues", // 'progressive_clues', 'wiped_clues', 'no_clues', 'no_multiple_choices', 'no_specific_answer'
        deliveryMode: "one_question_one_answer", // 'one_question_one_answer', 'top_ordered_items', 'match_items', 'pick_odd_one_out'

        // Cross-cutting features (can be multiple)
        modifiers: {
            bonusRound: false,
            streakBonus: false,
            doublePointsRound: false,
        },

        // Basic game parameters
        roundDuration: 20000, // 20 seconds
        questionCount: 10,
        questionCategories: [], // Empty means all categories
        durationBetweenQuestions: 5000, // 5 seconds to show results/transition
        durationBetweenRounds: 10000, // Between full rounds of questions
    };

    return {
        ...defaultGameConfig,
        ...gameConfig,
        modifiers: {
            ...defaultGameConfig.modifiers,
            ...(gameConfig.modifiers || {}),
        }, // Deep merge modifiers
    };
}

/**
 * Creates a new game room object.
 * @param {object} params
 * @param {string} params.roomId - The unique ID for the room.
 * @param {string} params.gameTitle - The title of the game.
 * @param {Array} params.questions - The array of questions for this game.
 * @param {object} params.player - The initial player (host) joining the room. { id, name, score }
 * @param {object} params.gameConfig - The final merged game configuration for this room.
 * @returns {object} The new game room object.
 */
const createNewGameRoom = ({ roomId, gameTitle, questions, player, gameConfig }) => {
    return {
        id: roomId,
        gameTitle: gameTitle,
        players: [player],
        hostId: player.id, // The player who created the room is the host
        currentQuestion: null,
        currentQuestionIndex: -1,
        questions: questions,
        state: "waiting_for_players", // 'waiting_for_players', 'in_progress', 'game_over', 'starting_game', 'revealing_answer', 'waiting_for_host_advance'
        timer: null, // For timed rounds (server-side)
        roundAnswers: {}, // To store answers for the current round: { playerId: { answer: ..., timeTaken: ..., wager: ... } }
        chatMessages: [],
        config: gameConfig,
        playerTimers: {}, // For tracking individual player timers if needed
    };
};

module.exports = {
    initialGameConfig,
    createNewGameRoom,
};