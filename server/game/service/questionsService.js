// server/game/service/questionsService.js
const { shuffleArray } = require("../utils"); // Import from new utils file

// Load questions from JSON file
const ALL_TRIVIA_QUESTIONS = require("../sample/sample-questions.json");

/**
 * Fetches a batch of random questions, optionally filtered by category.
 * @param {number} count - The number of questions to retrieve.
 * @param {string[]} [categories=[]] - An optional array of categories to filter by.
 * @returns {Array} An array of shuffled questions.
 */
function getGameQuestions(count, categories = []) {
    let filteredQuestions = ALL_TRIVIA_QUESTIONS;
    if (categories && categories.length > 0) {
        filteredQuestions = ALL_TRIVIA_QUESTIONS.filter(q => categories.includes(q.category));
    }
    const shuffled = shuffleArray([...filteredQuestions]); // Use imported shuffleArray
    return shuffled.slice(0, count);
}

module.exports = {
    getGameQuestions,
};