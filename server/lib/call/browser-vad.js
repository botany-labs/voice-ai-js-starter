// Implementation of Call for a browser client that uses a browser-side VAD.

const { SpeechToText } = require("../stt");
const { generateBeep } = require("../audio");
const { Call, CallEvents } = require("../call");
const { pcm16ToFloat32 } = require("../audio");

const BrowserVADWebCallEvents = {
    SERVER_START_LISTENING: "RDY",
    CLIENT_END_OF_SPEECH: "EOS",
    CLIENT_INTERRUPT: "INT",
    SERVER_REQUEST_CLEAR_BUFFER: "CLR",
};

/**
 * BrowserVADWebCall is an implementation of Call for a browser client that uses 
 * a browser-side VAD implementation.
 * */
class BrowserVADWebCall extends Call {

  /**
   * @param {WebSocket} ws - Websocket to use for the call.
   * @param {SpeechToText} stt - Speech to text instance to use for the call.
   */
  constructor(ws, stt) {
    super();
    this.ws = ws;
    this.stt = stt;
    this.pendingSamples = [];
    this.ws.on("message", this._onWebsocketMessage.bind(this));
    this.ws.on("close", () => {
      this.emit(CallEvents.CALL_ENDED);
      this.stt.destroy();
    });
    this.pushAudio(generateBeep(440, 0.5, 24000));
  }

  async pushAudio(raw_audio_as_pcm) {
    const pcm = new Int16Array(raw_audio_as_pcm);
    const audio_float32_24k_16bit_1channel = pcm16ToFloat32(pcm);
    for (let i = 0; i < audio_float32_24k_16bit_1channel.length; i += 1024) {
      this.ws.send(audio_float32_24k_16bit_1channel.slice(i, i + 1024));
    }
  }

  async pushMeta(metadata) {
    this.ws.send(metadata);
  }

  async indicateReady() {
    this.pushMeta("--- Assistant Ready ---");
    this.pushMeta(BrowserVADWebCallEvents.SERVER_START_LISTENING);
  }

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
    if (messageString === BrowserVADWebCallEvents.CLIENT_END_OF_SPEECH) {
      if (this.pendingSamples.length) {
        const data = this.pendingSamples.slice();
        const combinedAudio = new Float32Array(data.length * 1024);
        for (let i = 0; i < data.length; i++) {
          combinedAudio.set(data[i], i * 1024);
        }
        const transcription = await this.stt.transcribe(combinedAudio);
        this.pushMeta(BrowserVADWebCallEvents.SERVER_REQUEST_CLEAR_BUFFER);
        this.emit(CallEvents.USER_MESSAGE, transcription);
        this.pendingSamples = [];
      } else {
        console.warn("GOT EOS but no audio");
      }
      return;
    }

    if (messageString === BrowserVADWebCallEvents.CLIENT_INTERRUPT) {
      this.emit(CallEvents.INTERRUPT);
      return;
    }

    console.error("Unknown message type:", message);
  }

  async _handleWebsocket_Audio(message) {
    const audio = new Float32Array(message);
    this.pendingSamples.push(audio);
    return;
  }
}

module.exports = { 
    BrowserVADWebCall, 
    BrowserVADWebCallEvents 
};