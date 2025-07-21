// server/game/index.js

module.exports = (server) => {
    const { Server } = require("socket.io");
    const { initialGameConfig, createNewGameRoom } = require("./service/messageService");
    const { getGameQuestions } = require("./service/questionsService");
    const gameLogic = require("./service/gameLogicService"); // New service for game logic
    const { generateRoomId } = require("./utils"); // Import from new utils file

    const io = new Server(server, {
        cors: {
            origin: ["http://localhost:8080"], // Assuming your Webpack dev server runs on 8080
            methods: ["GET", "POST"]
        },
    });

    console.log("Initialized Socket.IO");

    // A simple structure to hold all active game rooms and their states
    const gameRooms = {}; // Key: roomId, Value: { players: [], currentQuestion: null, ... }

    // Initialize the game logic service with access to io and gameRooms
    gameLogic.init(io, gameRooms);

    io.on("connection", (socket) => {
        console.log(`User connected: ${socket.id}`);

        // --- Host / Game Creation Events ---
        socket.on("createGame", (gameTitle, playerName, gameConfig, callback) => { 
            const roomId = generateRoomId();

            const finalGameConfig = initialGameConfig(gameConfig);

            // Load questions based on chosen count and categories
            const gameQuestions = getGameQuestions(
                finalGameConfig.questionCount,
                finalGameConfig.questionCategories
            );
            if (gameQuestions.length === 0) {
                callback({
                    success: false,
                    message: "No questions found for selected criteria. Please adjust settings.",
                });
                return;
            }

            gameRooms[roomId] = createNewGameRoom({
                roomId,
                gameTitle, // Pass gameTitle
                questions: gameQuestions,
                player: { id: socket.id, name: playerName, score: 0 },
                gameConfig: finalGameConfig, // Pass final game config
            });

            socket.join(roomId); // Add the player to the Socket.IO room

            console.log(`Game "${gameTitle}" (Room ${roomId}) created by ${playerName} (${socket.id}) with config:`, finalGameConfig);

            callback({ success: true, roomId: roomId, roomState: gameRooms[roomId] });

            // No public roomListUpdate broadcast, games are invitational-only
        });

        socket.on("joinGame", (roomId, playerName, callback) => {
            const room = gameRooms[roomId];
            if (room && room.state === "waiting_for_players") {
                // Check if player already in room (e.g., reconnect)
                if (room.players.some(p => p.id === socket.id)) {
                    console.log(`${playerName} (${socket.id}) reconnected to room ${roomId}`);
                    socket.join(roomId);
                    callback({ success: true, roomId: roomId, roomState: room });
                    return;
                }

                socket.join(roomId);
                room.players.push({ id: socket.id, name: playerName, score: 0 });
                console.log(`${playerName} (${socket.id}) joined room ${roomId}`);

                callback({ success: true, roomId: roomId, roomState: room });

                io.to(roomId).emit("playerJoined", {
                    id: socket.id,
                    name: playerName,
                    score: 0,
                    newPlayerName: playerName,
                    roomState: room // Send updated room state for all players
                });
            } else {
                callback({
                    success: false,
                    message: "Room not found or game already started.",
                });
            }
        });

        // TEMPORARY: For auto-joining a test room if no UI is present
        socket.on("autoJoinTestRoom", (playerName) => {
            const testRoomId = "TESTROOM123"; // Fixed ID for testing
            let room = gameRooms[testRoomId];

            if (!room) {
                // Create the room if it doesn't exist with default config
                const defaultTestGameTitle = "Default Test Game";
                const defaultTestConfig = initialGameConfig({
                    progressionMode: 'auto',
                    pointsScoring: 'countdown', // Test countdown scoring
                    streakBonus: true, // Example: enable streak bonus in test room
                }); // Use initialGameConfig for full defaults + overrides

                const gameQuestions = getGameQuestions(defaultTestConfig.questionCount, defaultTestConfig.questionCategories);
                if (gameQuestions.length === 0) {
                    console.error("No questions loaded for default test room!");
                    socket.emit('gameError', 'Could not create test room: No questions available.');
                    return;
                }

                room = createNewGameRoom({
                    roomId: testRoomId,
                    gameTitle: defaultTestGameTitle,
                    questions: gameQuestions,
                    player: { id: socket.id, name: playerName, score: 0 },
                    gameConfig: defaultTestConfig,
                });
                gameRooms[testRoomId] = room;
                console.log(`Test Room ${testRoomId} created for ${playerName} (${socket.id})`);
            }

            // Add player to room if not already in it
            if (!room.players.some((p) => p.id === socket.id)) {
                socket.join(testRoomId);
                room.players.push({ id: socket.id, name: playerName, score: 0 });
                console.log(`${playerName} (${socket.id}) joined test room ${testRoomId}`);
                io.to(testRoomId).emit("playerJoined", {
                    id: socket.id,
                    name: playerName,
                    score: 0,
                    newPlayerName: playerName,
                    roomState: room, // Send updated room state for all players
                });
            }

            // Send initial room state to the joining player
            socket.emit("roomJoinedSuccess", { roomId: testRoomId, roomState: room });
        });

        // --- Disconnection Handling ---
        socket.on("disconnect", () => {
            console.log(`User disconnected: ${socket.id}`);
            for (const roomId in gameRooms) {
                const room = gameRooms[roomId];
                const playerIndex = room.players.findIndex((p) => p.id === socket.id);
                if (playerIndex !== -1) {
                    const disconnectedPlayerName = room.players[playerIndex].name;
                    room.players.splice(playerIndex, 1);
                    io.to(roomId).emit("playerLeft", {
                        playerId: socket.id,
                        playerName: disconnectedPlayerName,
                        roomState: room // Send updated room state
                    });
                    if (room.players.length === 0) {
                        console.log(`Room ${roomId} is empty. Deleting.`);
                        if (room.timer) clearTimeout(room.timer); // Clear any active game timer
                        delete gameRooms[roomId];
                        // No public roomListUpdate
                    } else if (room.hostId === socket.id && room.players.length > 0) {
                        room.hostId = room.players[0].id; // Assign new host
                        io.to(roomId).emit("hostChanged", room.hostId);
                    }
                    break;
                }
            }
        });

        // --- Explicit Leave Room Handler ---
        socket.on("leaveRoom", (roomId) => {
            const room = gameRooms[roomId];
            if (room) {
                socket.leave(roomId); // Remove socket from Socket.IO room
                const playerIndex = room.players.findIndex((p) => p.id === socket.id);
                if (playerIndex !== -1) {
                    const leavingPlayerName = room.players[playerIndex].name;
                    room.players.splice(playerIndex, 1);
                    io.to(roomId).emit("playerLeft", {
                        playerId: socket.id,
                        playerName: leavingPlayerName,
                        roomState: room
                    });
                    if (room.players.length === 0) {
                        console.log(`Room ${roomId} is empty after explicit leave. Deleting.`);
                        if (room.timer) clearTimeout(room.timer);
                        delete gameRooms[roomId];
                        // No public roomListUpdate
                    } else if (room.hostId === socket.id && room.players.length > 0) {
                        room.hostId = room.players[0].id;
                        io.to(roomId).emit("hostChanged", room.hostId);
                    }
                }
            }
        });

        // --- Request Current Room State (for late joiners or sync) ---
        socket.on("requestRoomState", (roomId, callback) => {
            const room = gameRooms[roomId];
            if (room) {
                callback(room);
            } else {
                callback(null);
            }
        });

        // --- Chat Message Handling ---
        socket.on("chatMessage", (data) => {
            const { roomId, message } = data;
            const room = gameRooms[roomId];
            if (room) {
                const sender = room.players.find((p) => p.id === socket.id)?.name || "Unknown";
                const chatMsg = { sender, message: message, timestamp: Date.now(), type: 'group' };
                room.chatMessages.push(chatMsg);
                if (room.chatMessages.length > 50) room.chatMessages.shift(); // Limit history
                io.to(roomId).emit("chatMessage", chatMsg);
            }
        });

        socket.on('privateChatMessage', (data) => {
            const { roomId, targetPlayerId, message } = data;
            const room = gameRooms[roomId];
            if (room) {
                const sender = room.players.find(p => p.id === socket.id)?.name || 'Unknown';
                const targetPlayer = room.players.find(p => p.id === targetPlayerId);

                if (targetPlayer) {
                    const chatMsg = { sender, message: message, timestamp: Date.now(), type: 'private', targetPlayerId: targetPlayerId };
                    // Send to sender and recipient
                    io.to(socket.id).emit('chatMessage', { ...chatMsg, isOutgoing: true, recipientName: targetPlayer.name });
                    io.to(targetPlayerId).emit('chatMessage', { ...chatMsg, isIncoming: true });
                    console.log(`Private chat in room ${roomId} from ${sender} to ${targetPlayer.name}: ${message}`);
                } else {
                    socket.emit('gameError', 'Private message target not found.');
                }
            }
        });

        // --- Host Control Events ---
        socket.on("startGame", (roomId) => {
            const room = gameRooms[roomId];
            if (room && socket.id === room.hostId) {
                gameLogic.startGameRound(roomId, socket.id); // Delegate to gameLogicService
            } else {
                socket.emit("gameError", "You are not the host or room not found.");
            }
        });

        socket.on('forceNextQuestion', (roomId) => { // Renamed from nextQuestionManual
            const room = gameRooms[roomId];
            if (room && socket.id === room.hostId) {
                if (room.state === 'question_active' || room.state === 'revealing_answer' || room.state === 'waiting_for_host_advance') {
                    console.log(`Host ${socket.id} forced next question in room ${roomId}`);
                    gameLogic.endQuestionRound(roomId); // Force end current round
                } else {
                    socket.emit('gameError', 'Cannot force next question now (not in active question phase).');
                }
            } else {
                socket.emit('gameError', 'You are not the host or room not found.');
            }
        });


        socket.on('kickPlayer', (roomId, playerIdToKick) => {
            const room = gameRooms[roomId];
            if (room && socket.id === room.hostId) {
                const playerIndex = room.players.findIndex(p => p.id === playerIdToKick);
                if (playerIndex !== -1) {
                    const kickedPlayer = room.players[playerIndex];
                    // Disconnect the kicked player's socket from the room
                    io.sockets.sockets.get(playerIdToKick)?.leave(roomId); // Specific socket

                    room.players.splice(playerIndex, 1);
                    io.to(roomId).emit('playerLeft', {
                        playerId: kickedPlayer.id,
                        playerName: kickedPlayer.name,
                        kickedByHost: true,
                        roomState: room // Send updated room state
                    });
                    io.to(kickedPlayer.id).emit('kickedFromRoom', { roomId: roomId, message: 'You have been kicked by the host.' });
                    console.log(`Player ${kickedPlayer.name} (${kickedPlayer.id}) kicked from room ${roomId} by host.`);

                    // If the kicked player was the last, or if host needs to change
                    if (room.players.length === 0) {
                        delete gameRooms[roomId];
                    } else if (room.hostId === playerIdToKick) { // If host was kicked (shouldn't happen with hostOnly check)
                         room.hostId = room.players[0].id;
                         io.to(roomId).emit('hostChanged', room.hostId);
                    }
                } else {
                    socket.emit('gameError', 'Player not found in room to kick.');
                }
            } else {
                socket.emit('gameError', 'You are not the host or room not found.');
            }
        });

        // --- Player Answer Event ---
        socket.on("submitAnswer", (data) => {
            const { roomId, answer, wager } = data;
            gameLogic.submitAnswer(roomId, socket.id, answer, data.timeTaken, wager); // Delegate to gameLogicService
        });

    });
};