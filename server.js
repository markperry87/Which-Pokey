const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Maintain a simple lobby.
let lobby = {}; // socket.id -> socket for clients in lobby
let inGame = {}; // socket.id -> role for clients in game

io.on('connection', (socket) => {
  console.log("New client connected:", socket.id);
  
  socket.on('joinLobby', () => {
    lobby[socket.id] = socket;
    updateLobby();
    if (Object.keys(lobby).length >= 2) {
      // Start game for the first two players.
      const ids = Object.keys(lobby);
      inGame[ids[0]] = "player1";
      inGame[ids[1]] = "player2";
      delete lobby[ids[0]];
      delete lobby[ids[1]];
      io.to(ids[0]).emit('startGame', { role: "player1" });
      io.to(ids[1]).emit('startGame', { role: "player2" });
      updateLobby();
    }
  });
  
  socket.on('returnToLobby', () => {
    delete inGame[socket.id];
    lobby[socket.id] = socket;
    socket.emit('returnedToLobby');
    updateLobby();
  });
  
  socket.on('playerState', (data) => {
    socket.broadcast.emit('playerState', data);
  });
  
  socket.on('roundOver', (data) => {
    io.emit('roundOver', data);
  });
  
  socket.on('disconnect', () => {
    console.log("Client disconnected:", socket.id);
    delete lobby[socket.id];
    delete inGame[socket.id];
    io.emit('playerDisconnected');
    updateLobby();
  });
  
  function updateLobby() {
    const count = Object.keys(lobby).length;
    io.emit('lobbyUpdate', { count });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server listening on port ${PORT}`); });
