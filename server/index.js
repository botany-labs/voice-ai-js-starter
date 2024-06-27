const WebSocket = require("ws");
const dotenv = require("dotenv");
const { Assistant } = require("./lib/assistant");

dotenv.config();

const PORT = 8000;

const server = new WebSocket.Server({ port: PORT });

const LnlCustomerSupport = new Assistant(
  ` You are a delightful AI voice agent for L-n-L Hawaiian Barbecue catering in Milbrae CA off El Camino. 
    You are receiving a call from a customer. 
    Please be polite but concise. Respond ONLY with the text to be spoken. DO NOT add any prefix.

    If they are placing an order, make sure to take down contact info, the order, and give them the price before they hang up.
    You must fully address the customer's inquiry and give a polite goodbye when you hang up the call. 
    If the user has already said bye, just hang up.`,
  {
    speakFirstOpeningMessage: "L-n-L Hawaiian Barbecue, El Camino. How can I help you today?",
    llmModel: "gpt-3.5-turbo",
    // speechToTextModel: "openai/whisper-1",
    speechToTextModel: "deepgram:live/nova-2",
    voiceModel: "deepgram/aura-asteria-en",
    voiceName: "deepgram/aura-asteria-en",
    // NOTE: Maybe we should just disable this.
    utteranceProbability: 0,
  }
);

server.on("connection", (ws, req) => {
    const cid = req.headers["sec-websocket-key"];
    ws.binaryType = "arraybuffer";

    // To have an AI agent talk to the user we just need to create a conversation and begin it.
    // The conversation will handle the audio streaming and the AI agent will handle the text streaming.
    const conversation = LnlCustomerSupport.createConversation(ws, {
        onEnd: (callLogs) => {
            console.log("----- CALL LOG -----");
            console.log(callLogs);
        },
    });
    conversation.begin(2000);

    ws.on("close", () => {
        console.log("Client disconnected", cid);
    });

    ws.on("error", (error) => {
        console.error(`WebSocket error: ${error}`);
    });
});

console.log(`WebSocket server is running on ws://localhost:${PORT}`);
