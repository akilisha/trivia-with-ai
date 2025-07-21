// server/game/utils.js

/**
 * Utility to generate unique room IDs
 * @returns {string} A unique room ID.
 */
const generateRoomId = () => Math.random().toString(36).substring(2, 9).toUpperCase();

/**
 * Helper to shuffle arrays (Fisher-Yates algorithm)
 * @param {Array} array The array to shuffle.
 * @returns {Array} The shuffled array.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

module.exports = {
    generateRoomId,
    shuffleArray,
};