const WebSocket = require("ws");
const util = require("util");

const PORT = 8000;

// TODO: Add simple authentication scheme
const server = new WebSocket.Server({ port: PORT });

server.on("connection", (ws, req) => {
  const cid = req.headers["sec-websocket-key"];

  console.log("New client connected", cid);

  ws.binaryType = "arraybuffer";


  let playBackBuffer = [];

  ws.on("message", (message) => {
    ws.send(message);
    // console.log(`Received message: ${message}`);
    // Echo the message back to the client
    // ws.send(`Server received: ${message}`);
    // const messageArray = new Int32Array(message);
    // console.log("Server received", messageArray.length);
    // // buffer.push(messageArray);
    // ws.send(messageArray);

  });

  ws.on("close", () => {
    console.log("Client disconnected", cid);
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error: ${error}`);
  });
});



console.log(`WebSocket server is running on ws://localhost:${PORT}`);

