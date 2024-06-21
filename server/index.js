const WebSocket = require("ws");
const util = require("util");

const PORT = 8000;

// TODO: Add simple authentication scheme
const server = new WebSocket.Server({ port: PORT });

server.on("connection", (ws, req) => {
  const cid = req.headers["sec-websocket-key"];

  console.log("New client connected", cid);

  ws.binaryType = "arraybuffer";

  new ConversationManager(ws);

  ws.on("close", () => {
    console.log("Client disconnected", cid);
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error: ${error}`);
  });
});


console.log(`WebSocket server is running on ws://localhost:${PORT}`);


class ConversationManager {
  constructor(ws) {
    this.ws = ws;
    this.conversation = []
    this.rawAudioBuffer = []

    this.ws.on("message", this.onMessage.bind(this));
  }

  onMessage(rawAudio) {

    const audio = new Float32Array(rawAudio);
    this.rawAudioBuffer.push(audio);

    // chunk into 1024 sizes and send out
    for (let i = 0; i < audio.length; i += 1024) {
      this.ws.send(audio.slice(i, i + 1024));
    }
    
  }


}

