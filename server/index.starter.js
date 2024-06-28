// This is a bare-bones example that you can use to get started with implementing your own assistant.
// Simply delete the index.js and rename this file to index.js and you're good to go!
// You can connect to this using the existing demo web UI (the pre-configured settings on the UI won't do anything though).

const WebSocket = require("ws");
const dotenv = require("dotenv");
const { Assistant } = require("./lib/assistant");

dotenv.config();

const PORT = 8000;

const server = new WebSocket.Server({ port: PORT });

// ----------------------------
const MyAssistant = new Assistant(
  `TODO: <Here write the prompt for your AI agent>`,
  {
    speakFirstOpeningMessage: "TODO: <Here write the first message your AI agent will speak>",
  }
);
// ----------------------------

server.on("connection", (ws, req) => {
    const cid = req.headers["sec-websocket-key"];
    ws.binaryType = "arraybuffer";


    // To have an AI agent talk to the user we just need to create a conversation and begin it.
    // The conversation will handle the audio streaming and the AI agent will handle the text streaming.

    const conversation = MyAssistant.createConversation(ws, {
        onEnd: (callLogs) => {
            console.log("----- CALL LOG -----");
            console.log(callLogs);
        },
    });
    conversation.begin(2000);

    ws.on("close", () => {
        clearTimeout(demoTimeout);
        console.log("Client disconnected", cid);
    });

    ws.on("error", (error) => {
        console.error(`WebSocket error: ${error}`);
    });
});

console.log(`WebSocket server is running on ws://localhost:${PORT}`);
