const WebSocket = require("ws");
const dotenv = require("dotenv");
const { Assistant } = require("./lib/assistant");

dotenv.config();

const PORT = 8000;

const server = new WebSocket.Server({ port: PORT });

const LnlCustomerSupport_Fastest = new Assistant(
  ` You are a delightful AI voice agent for L-n-L Hawaiian Barbecue catering in Milbrae CA off El Camino. 
    You are receiving a call from a customer. 
    Please be polite but concise. Respond ONLY with the text to be spoken. DO NOT add any prefix.

    If they are placing an order, make sure to take down contact info, the order, and give them the price before they hang up.
    You must fully address the customer's inquiry and give a polite goodbye when you hang up the call. 
    If the user has already said bye, just hang up.`,
  {
    speakFirstOpeningMessage: "L-n-L Hawaiian Barbecue, El Camino. How can I help you today?",
    llmModel: "gpt-3.5-turbo",
    speechToTextModel: "deepgram:live/nova-2",
    voiceModel: "deepgram/aura",
    voiceName: "asteria-en",
  }
);

const LnlCustomerSupport_BestQuality = new Assistant(
  ` You are a delightful AI voice agent for L-n-L Hawaiian Barbecue catering in Milbrae CA off El Camino. 
    You are receiving a call from a customer. 
    Please be polite but concise. Respond ONLY with the text to be spoken. DO NOT add any prefix.
    You are configured with a multi-lingual TTS. Feel free to respond back in the language of the customer.

    If they are placing an order, make sure to take down contact info, the order, and give them the price before they hang up.
    You must fully address the customer's inquiry and give a polite goodbye when you hang up the call. 
    If the user has already said bye, just hang up.`,
  {
    speakFirstOpeningMessage: "L-n-L Hawaiian Barbecue, El Camino. How can I help you today?",
    llmModel: "gpt-3.5-turbo",
    speechToTextModel: "openai/whisper-1",
    voiceModel: "elevenlabs/eleven_turbo_v2",
    voiceName: "piTKgcLEGmPE4e6mEKli",
  }
)

const LnlCustomerSupport_OpenAI = new Assistant(
  ` You are a delightful AI voice agent for L-n-L Hawaiian Barbecue catering in Milbrae CA off El Camino. 
    You are receiving a call from a customer. 
    Please be polite but concise. Respond ONLY with the text to be spoken. DO NOT add any prefix.
    You are configured with a multi-lingual TTS. Feel free to respond back in the language of the customer.

    If they are placing an order, make sure to take down contact info, the order, and give them the price before they hang up.
    You must fully address the customer's inquiry and give a polite goodbye when you hang up the call. 
    If the user has already said bye, just hang up.`,
  {
    speakFirstOpeningMessage: "L-n-L Hawaiian Barbecue, El Camino. How can I help you today?",
    llmModel: "gpt-3.5-turbo",
  }
);

const LnlCustomerSupport_Default = LnlCustomerSupport_Fastest;

server.on("connection", (ws, req) => {
    const cid = req.headers["sec-websocket-key"];
    ws.binaryType = "arraybuffer";

    // resolve query
    const query = req.url.split("?")[1];
    const queryParams = new URLSearchParams(query);
    const assistant = queryParams.get("assistant");


    const LnlCustomerSupport = (
      assistant === "fastest" ? LnlCustomerSupport_Fastest : 
      assistant === "best-quality" ? LnlCustomerSupport_BestQuality : 
      assistant === "openai" ? LnlCustomerSupport_OpenAI : 
      LnlCustomerSupport_Default
    );

    ws.send(`--- Configured to use ${(assistant ?? 'DEFAULT').toUpperCase()} assistant ---`);

    let demoTimeout;
    if (process.env.IS_DEMO) {
      const timeoutMinutes = 2;
      const timeoutMs = timeoutMinutes * 60 * 1000;
      demoTimeout = setTimeout(() => {
        ws.send("---- FORCED CALL END ----");
        ws.send(`---- Timed out because demo time limit was reached (${timeoutMinutes} minutes) ----`);
        ws.close();
      }, timeoutMs);
    }

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
        clearTimeout(demoTimeout);
        console.log("Client disconnected", cid);
    });

    ws.on("error", (error) => {
        console.error(`WebSocket error: ${error}`);
    });
});

console.log(`WebSocket server is running on ws://localhost:${PORT}`);
