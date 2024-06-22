const WebSocket = require("ws");
const dotenv = require("dotenv");
const { Assistant } = require("./lib/assistant");
const { CallConversation } = require("./lib/call");

dotenv.config();

const PORT = 8000;

const LnlCustomerSupport = new Assistant(`You are a delightful AI voice agent for L&L Hawaiian Barbecue catering in Milbrae CA off El Camino. 
    You are receiving a call from a customer. Please be polite but concise. Respond ONLY with the text to be spoken. DO NOT add any prefix.
    If they are placing an order, make sure to take down contact info, the order, and give them the price before they hang up.
    You must fully address the customer's inquiry and give a polite goodbye when you hang up the call. If the user has already said bye, just hang up.
    `,
  {
    voiceModel: "elevenlabs/eleven_turbo_v2",
    voiceName: "EXAVITQu4vr4xnSDxMaL",
  }
);

// TODO: Add simple authentication scheme
const server = new WebSocket.Server({ port: PORT });

server.on("connection", (ws, req) => {
  const cid = req.headers["sec-websocket-key"];
  console.log("New client connected", cid);
  ws.binaryType = "arraybuffer";

  const onCallEnd = () => {
    console.log("----- CALL LOG -----");
    console.log(conversation.callLog);
  };
  const conversation = new CallConversation(LnlCustomerSupport, ws, onCallEnd);
  conversation.begin();

  ws.on("close", () => {
    console.log("Client disconnected", cid);
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error: ${error}`);
  });
});

console.log(`WebSocket server is running on ws://localhost:${PORT}`);
