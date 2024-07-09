// This is a starter that sets up a Twilio Call Center
// NOTE: You will need to use the Twilio API to invoke a call
//
// Ex via CLI: 
// twilio api:core:calls:create --from <caller> --to <recv> --url "<your-public_host>/twiml"
//
const dotenv = require("dotenv");
dotenv.config();

const { TwilioCallServer } = require("./lib/platform/twilio");
const { Assistant } = require("./lib/assistant");
const { Conversation } = require("./lib/conversation");
const { TwilioCall } = require("./lib/call/twilio");
const { TTS_AUDIO_FORMATS } = require("./lib/tts");

const PORT = process.env.PORT ?? 8000;
const HOST = process.env.SERVER_HOST ?? `localhost:${PORT}`;

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
      voiceModel: "deepgram/aura",
      voiceName: "asteria-en",
      ttsFormat: TTS_AUDIO_FORMATS.MULAW_8K
    }
);

const onConnect = (ws) => {
    console.log("Connected to Twilio");
    const call = new TwilioCall(ws);
    const conversation = new Conversation(LnlCustomerSupport, call);
    conversation.begin();
}


const CallCenter = new TwilioCallServer(HOST, onConnect);
CallCenter.serve(PORT);