const WebSocket = require("ws");
const util = require("util");
const fs = require("fs");
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PORT = 8000;

const PROMPT = `

PROMPT
You are a delightful AI voice agent for L&L Hawaiian Barbecue catering in Milbrae CA off El Camino. 
You are receiving a call from a customer. Please be polite but concise. Respond ONLY with the text to be spoken. DO NOT add any prefix.

There will not always be a back and forth. Sometimes the customer will have a few consecutive messages. Other times it will be you.

You must fully address the customer's inquiry and give a polite goodbye when you hang up the call. If the user has already said bye, just hang up.

TOOLS
You can use the [endCall] tool to hang up the call. Write it exactly as that.
`;

// TODO: Add simple authentication scheme
const server = new WebSocket.Server({ port: PORT });

server.on("connection", (ws, req) => {
  const cid = req.headers["sec-websocket-key"];

  console.log("New client connected", cid);

  ws.binaryType = "arraybuffer";

  const conversationManager = new ConversationManager(ws);

  setTimeout(() => {
    conversationManager.speakResponse("Hello! This is Fiona with L&L Hawaiian Barbecue, Milbrae. How can I help you?");
  }, 100)



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
    this.conversation = [];
    this.pendingSamples = [];

    this.ws.on("message", this.onMessage.bind(this));
  }

  async onMessage(message) {
    if (message instanceof ArrayBuffer) {
      this._onMessage_Audio(message);
    } else {
      this._onMessage_Text(message);
    }
  }

  async _onMessage_Text(message) {
    let messageString = message.toString();
    if (messageString === "end") {
      // chunk into 1024 sizes and send out

      const transcription = await this.transcribeWhisper(this.pendingSamples);
      this.ws.send("user: " + transcription);
      this.conversation.push({ speaker: "user", text: transcription });
    //   await this.giveAffirmation(0.5);
      const response = await this.promptLLM();
      if (response) {
        await this.speakResponse(response);
      }
      this.pendingSamples = [];
      return;
    }
  }

  async endCall(lastMessage) {
    if (lastMessage) {
      await this.speakResponse(lastMessage);
    }
    this.ws.send("---- Assistant Hung Up ----");
    this.ws.close();
  }

  async _onMessage_Audio(message) {
    const audio = new Float32Array(message);
    this.pendingSamples.push(audio);
    return;
  }

  async promptLLM() {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {role: "system", content: "You are a helpful and delightful customer service rep."},
        {role: "user", content: PROMPT},
        ...(this.conversation.map((m) => ({role: m.speaker, content: m.text})))
      ],
    });

    console.log("RESPONSE", util.inspect(response, { depth: null }));


    let content = response.choices[0].message.content;

    if (content.includes("[endCall]")) {
      content = content.replace("[endCall]", "");
      this.endCall(content);
      return;
    }
    return content;
  }

  async speakResponse(message) {
    const audio = await this._textToSpeech(message);
    const audioBuf = await audio.arrayBuffer();
    const audioFloat32 = pcm16ToFloat32(new Int16Array(audioBuf));
    for (let i = 0; i < audioFloat32.length; i += 1024) {
      this.ws.send(audioFloat32.slice(i, i + 1024));
    }
    this.conversation.push({ speaker: "assistant", text: message });
    console.log("RESPONSE", message);
    this.ws.send("assistant: " + message);
  }

  async giveAffirmation(probability) {
    if (this.conversation.length < 2) {
      return;
    }
    if (Math.random() < probability) {
      return;
    }
    const affirmations = ["okay", "got it", "i see", "understood"];
    const randomIndex = Math.floor(Math.random() * affirmations.length);
    const affirmation = affirmations[randomIndex];
    await this.speakResponse(affirmation);
  }

  async _textToSpeech(message) {
    const response = await openai.audio.speech.create(
      {
        model: "tts-1",
        voice: "shimmer",
        input: message,
        response_format: "pcm",
      }    );
    return response;
  }

  async transcribeWhisper(inputs) {
    const samples = inputs.slice();
    // join pending samples
    const audio = new Float32Array(samples.length * 1024);
    for (let i = 0; i < samples.length; i++) {
      audio.set(samples[i], i * 1024);
    }
    console.log("AUDIO LENGHT", audio.length);
    let pcm16 = float32ToPCM16(audio);

    const sampleRate = 24000;
    const bitDepth = 16;
    const numChannels = 1;

    // Create WAV header
    const wavHeader = createWavHeader(
      sampleRate,
      numChannels,
      bitDepth / 8,
      pcm16.length * 2
    );

    // Concatenate header and PCM data
    const wavBuffer = Buffer.concat([wavHeader, Buffer.from(pcm16.buffer)]);

    // Create a Blob from the WAV buffer
    const wavBlob = new Blob([wavBuffer], { type: "audio/wav" });
    wavBlob.name = "audio.wav";
    wavBlob.lastModified = Date.now();

    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: wavBlob,
    });

    console.log(transcription.text);
    return transcription.text;
  }

}


function appendBuffer(buffer, data) {
    const tmp = new Float32Array(buffer.length + data.length);
    tmp.set(buffer, 0);
    tmp.set(data, buffer.length);
    return tmp;
  }

  function float32ToPCM16(buffer) {
    const pcm16 = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      let s = Math.max(-1, Math.min(1, buffer[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  function pcm16ToFloat32(buffer) {
    const float32 = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      float32[i] = buffer[i] / 0x7fff;
    }
    return float32;
  }

  // Function to create a WAV header
  function createWavHeader(sampleRate, numChannels, bytesPerSample, dataSize) {
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF identifier
    view.setUint32(0, 0x52494646, false); // 'RIFF'
    // file length minus RIFF identifier and file type header
    view.setUint32(4, 36 + dataSize, true);
    // RIFF type
    view.setUint32(8, 0x57415645, false); // 'WAVE'
    // format chunk identifier
    view.setUint32(12, 0x666d7420, false); // 'fmt '
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, byteRate, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, blockAlign, true);
    // bits per sample
    view.setUint16(34, bytesPerSample * 8, true);
    // data chunk identifier
    view.setUint32(36, 0x64617461, false); // 'data'
    // data chunk length
    view.setUint32(40, dataSize, true);

    return Buffer.from(buffer);
  }