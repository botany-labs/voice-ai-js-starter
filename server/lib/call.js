const { SpeechToText } = require("./speech");
const { EventEmitter } = require("events");
const { generateBeep, pcm16ToFloat32 } = require("./audio");
const { Writable, Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const OpenAI = require("openai");


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


const END_OF_SPEECH_TOKEN = "EOS"; // End of speech on client side
const INTERRUPT_TOKEN = "INT"; // Interrupt reported from client side
const CLEAR_BUFFER_TOKEN = "CLR"; // Clear playback buffer request from server

/**
 * CallConversation represents a conversation between a user and an assistant.
 * It listens for user messages, sends assistant messages, and handles tool selections.
 */
class CallConversation {
  
  /**
   * Constructor
   * @param {Assistant} assistant - Assistant to use for the conversation.
   * @param {WebSocket} ws - Websocket to use for the conversation.
   * @param {(callLogs: Array<{timestamp: string, event: string, meta: object}>) => void} onEnd - Function to call when the conversation ends.
   */
  constructor(assistant, ws, onEnd=()=>{}) {
    this.assistant = assistant;
    this.call = new WebCall(ws);
    this.history = assistant.prompt;
    this.callLog = [];
    this.onEnd = onEnd;
    this.call.on("callEnded", () => {
      this.addToCallLog("CALL_ENDED");
      this.onEnd && this.onEnd(this.callLog);
    });
    this.call.on(INTERRUPT_TOKEN, () => {
      this.noteWhatWasSaid("user", "[Interrupted your last message]")
    });
    this.addToCallLog("INIT", {
      assistant: JSON.stringify(this.assistant),
    });
  }

  /**
   * Begins the conversation.
   * @param {number} delay - Delay in milliseconds before starting to listen for user messages.
   */
  async begin(delay = 0, beep = true) {
    if (beep) {
      this.call.pushAudio(generateBeep(440, 0.5, 24000));
    }
    setTimeout(async () => {
      this.startListening();
      this.addToCallLog("READY");
      this.call.pushMeta("---- Assistant Ready ----");

      if (this.assistant.speakFirst) {
        let firstMessage = this.assistant.speakFirstOpeningMessage;
        if (!firstMessage) {
          const { content } = await this.assistant.createResponse(this.history);
          firstMessage = content;
        }
        this.noteWhatWasSaid("assistant", firstMessage);
        // const audio = await this.assistant.textToSpeech(firstMessage);
        // const readableStream = Readable.from(Buffer.from(audio.buffer));
        const response = await openai.audio.speech.create({
          model: 'tts-1',
          voice: 'nova',
          input: firstMessage,
          response_format: "pcm",
        });

        const readableStream = response.body;
        const writeableStream = new PushAudioStream(this.call.ws);
        // readableStream.pipe(writeableStream);
        try {
          await pipeline(
            readableStream, 
            new ChunkTransform(), 
            new PcmToFloat32Transform(), 
            writeableStream
          )
        } catch (error) {
          console.error("Pipeline error:", error);
        }

      }
    }, delay);
  }

  /**
   * Starts listening for user messages.
   */
  startListening() {

    this.call.on("userMessage", async (message) => {
      this.call.pushMeta(CLEAR_BUFFER_TOKEN);
      this.noteWhatWasSaid("user", message);

      const utterance = await this.assistant.createUtterance();
      if (utterance) {
        this.noteWhatWasSaid("assistant", utterance);
        const audio = await this.assistant.textToSpeech(utterance);
        this.call.pushAudio(audio);
      }

      const { content, selectedTool } = await this.call._profileIt("responseGeneration", async () => {
        return await this.assistant.createResponse(this.history);
      });

      if (content) {
        this.noteWhatWasSaid("assistant", content);
        // const audio = await this.call._profileIt("speechGeneration", async () => {
        //   return await this.assistant.textToSpeech(content);
        // });

        // const readableStream = Readable.from(Buffer.from(audio.buffer));
        const response = await openai.audio.speech.create({
          model: 'tts-1',
          voice: 'nova',
          input: content,
          response_format: "pcm",
        });

        const readableStream = response.body;
        const writeableStream = new PushAudioStream(this.call.ws);
        // readableStream.pipe(writeableStream);
        try {
          await pipeline(
            readableStream, 
          new ChunkTransform(), 
          new PcmToFloat32Transform(), 
            writeableStream)
        } catch (error) {
          console.error("Pipeline error:", error);
        }
      }

      if (selectedTool) {
        this.addToCallLog("TOOL_SELECTED", {
          tool: selectedTool
        });
      }

      if (selectedTool === "endCall") {
        this.call.pushMeta("---- Assistant Hung Up ----");
        this.call.end();
        this.call.off("userMessage", this.startListening);
        return;
      }
      else if (selectedTool) {
        // TODO: implement custom tools
        console.warn("[CUSTOM TOOLS NOT YET SUPPORTED] Unhandled tool:", selectedTool);
      }
    });
  }

  /**
   * Adds an event to the call log.
   * @param {string} event - Event to add to the call log.
   * @param {object} meta - Meta data to add to the call log.
   */
  addToCallLog(event, meta) {
    const timestamp = new Date().toISOString();
    this.callLog.push({ timestamp, event, meta });
  }

  /**
   * Adds a message to the call log and history.
   * @param {string} who - Who said the message.
   * @param {string} message - Message to add to the call log and history.
   */
  noteWhatWasSaid(speaker, message) {
    this.addToCallLog(`TRANSCRIPT`, { speaker, message });
    this.history.push({ role: speaker, content: message });
    this.call.pushMeta(`${speaker}: ${message}`);
  }
}
exports.CallConversation = CallConversation;


/**
 * WebCall represents a light wrapper around a websocket connection that listens for audio and meta data.
 * Subscribe to the 'userMessage' event to get the transcribed audio.
 * Subscribe to the 'callEnded' event to get notified when the call has ended.
 *
 * Events:
 * - 'userMessage' - Emitted whenever new message has been transcribed.
 *                   Handler: (string) => void
 * - 'callEnded' - Emitted whenever the call has ended.
 *                   Handler: () => void
 * 
 * */
class WebCall extends EventEmitter {
  /**
   * Constructor
   * @param {WebSocket} ws - Websocket to use for the call.
   */
  constructor(ws) {
    super();
    this.ws = ws;
    this.stt = new SpeechToText('openai/whisper-1');
    this.pendingSamples = [];
    this.ws.on("message", this._onWebsocketMessage.bind(this));
    this.ws.on("close", () => {
      this.emit("callEnded");
    });
  }

  /**
   * Pushes audio to the websocket.
   * @param {Float32Array} audio_float32_24k_16bit_1channel - Audio to push to the websocket. Audio must be in 24k sample rate, 16 bit depth, 1 channel format.
   */
  async pushAudio(audio_float32_24k_16bit_1channel) {
    for (let i = 0; i < audio_float32_24k_16bit_1channel.length; i += 1024) {
      this.ws.send(audio_float32_24k_16bit_1channel.slice(i, i + 1024));
    }
  }

  /**
   * Pushes call related meta to the websocket.
   * @param {string} metadata - Meta to push to the websocket.
   */
  async pushMeta(metadata) {
    this.ws.send(metadata);
  }

  /**
   * Ends the call.
   */
  async end() {
    this.pushAudio(generateBeep(180, 0.5, 24000));
    this.ws.close();
  }

  async _onWebsocketMessage(message) {
    if (message instanceof ArrayBuffer) {
      this._handleWebsocket_Audio(message);
    } else {
      this._handleWebsocket_Meta(message);
    }
  }

  async _handleWebsocket_Meta(message) {
    let messageString = message.toString();
    if (messageString === END_OF_SPEECH_TOKEN) {
      if (this.pendingSamples.length) {
        const transcription = await this._profileIt("transcription", async () => {
          return await this.stt.transcribe(this.pendingSamples);
        });
        this.emit("userMessage", transcription);
        this.pendingSamples = [];
      }
      else {
        console.warn("GOT EOS but no audio");
      }
      return;
    }
    this.emit(messageString);
    console.error("Unknown message type:", message);
  }

  async _handleWebsocket_Audio(message) {
    const audio = new Float32Array(message);
    this.pendingSamples.push(audio);
    return;
  }

  async _profileIt(name, fn) {
    const startTime = new Date();
    const result = await fn();
    const endTime = new Date();
    const duration = endTime - startTime;
    this.pushMeta(`--- time.${name} ${duration} ms`);
    return result;
  }
}
exports.WebCall = WebCall;


class PushAudioStream extends Writable {
  constructor(ws) {
    super();
    this.ws = ws;
  }

  _write(chunk, encoding, callback) {
    try {
      const audio = new Float32Array(chunk.buffer);
      for (let i = 0; i < audio.length; i += 1024) {
        this.ws.send(audio.slice(i, i + 1024));
      }
      callback();
    } catch (error) {
      console.error(error);
      return callback(error);
    }
  }
}

const { Transform } = require("stream");

class PcmToFloat32Transform extends Transform {
  constructor(options) {
    super(options);
  }

  _transform(chunk, encoding, callback) {
    const asInt16 = new Int16Array(chunk.buffer);
    const audio = pcm16ToFloat32(asInt16);
    this.push(Buffer.from(audio.buffer));
    callback();
  }
}

class ChunkTransform extends Transform {
  constructor(options) {
    super(options);
    this.buffer = Buffer.alloc(0);
    this.minSizeBytes = 24000 * 2 * 2; // 24k hz, int16 is 2 bytes - means buffer at least 1 second
  }

  _transform(chunk, encoding, callback) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= this.minSizeBytes) {
      let chunkToPush = this.buffer.slice(0, this.minSizeBytes);
      const pcm = new Uint8Array(chunkToPush.length);
      pcm.set(chunkToPush);
      this.push(pcm);
      this.buffer = this.buffer.slice(this.minSizeBytes);
    }
    callback();
  }

  _flush(callback) {
    if (this.buffer.length > 0) {
      let chunkToPush = this.buffer;
      if (chunkToPush.length % 2 !== 0) {
        const padding = Buffer.alloc(2 - (chunkToPush.length % 2));
        chunkToPush = Buffer.concat([chunkToPush, padding]);
      }
      this.push(chunkToPush);
    }
    callback();
  }
}

