const { Call, CallEvents } = require("../call");
var WebSocketServer = require("websocket").server;
exports.WebSocketServer = WebSocketServer;
const {
  createClient: Deepgram,
  LiveTranscriptionEvents,
} = require("@deepgram/sdk");

class TwilioCall extends Call {
  /**
   * @param {Object} ws - WebSocket connection to the call
   */
  constructor(ws) {
    super();
    this.ws = ws;
    this.pendingSamples = [];
    this.pendingTranscribedMessages = [];
    this.streamSid = null;
    this.connectionOpen = false;
    this.ws.on("message", this._onWebsocketMessage.bind(this));
    this.ws.on("close", () => {
      this.emit("callEnded");
      this.transcriber.finish();
    });

    this.transcriber = this.setUpTranscriber();
    this.assistantIsSpeaking = false;
    this.assistantSpeakingTimer = null;
    this.assistantInterruptionTimer = null;
  }

  async _onWebsocketMessage(message) {
    if (message.type === "utf8") {
      var data = JSON.parse(message.utf8Data);

      if (!this.streamSid) {
        this.streamSid = data.streamSid;
        console.log("StreamSid: ", this.streamSid);
      }

      if (data.event === "media") {
        this.pendingSamples.push(data.media.payload);
        this._onMediaMessage();
      }
      // -------------------------------------------------
      if (data.event === "connected") {
        console.log("From Twilio: Connected event received: ", data);
      }
      if (data.event === "start") {
        console.log("From Twilio: Start event received: ", data);
      }
      if (data.event === "mark") {
        console.log("From Twilio: Mark event received", data);
      }
      if (data.event === "close") {
        console.log("From Twilio: Close event received: ", data);
        this.end();
      }
    } else if (message.type === "binary") {
      console.log("From Twilio: binary message received (not supported)");
    }
  }

  async _onMediaMessage() {
    if (this.pendingSamples.length < 1 || !this.connectionOpen) {
      return;
    }
    const pendingByteBuffers = this.pendingSamples.map((sample) => {
      return Buffer.from(sample, "base64");
    });

    const combined = Buffer.concat(pendingByteBuffers);
    this.transcriber.send(combined);
    this.pendingSamples = [];
  }

  setUpTranscriber() {
    const deepgram = Deepgram(process.env.DEEPGRAM_API_KEY);
    const connection = deepgram.listen.live({
      model: "nova-2",
      encoding: "mulaw",
      sample_rate: 8000,
      smart_format: false,
      interim_results: true,
      numerals: true,
      endpointing: 200,
      vad_events: true,
      interim_results: true,
      utterance_end_ms: "1000",
    });

    connection.on(LiveTranscriptionEvents.Open, () => {
      console.log("Deepgram Live Connection opened.");
      this.connectionOpen = true;
    });

    connection.on(LiveTranscriptionEvents.Transcript, (data) => {
      if (!data.is_final) {
        return;
      }

      const transcript = data.channel.alternatives.reduce((acc, alt) => {
        return acc + alt.transcript;
      }, "");

      if (data.speech_final) {
        console.log("Speech final event received", transcript);
      }
      this.pendingTranscribedMessages.push(transcript);
    });

    connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      console.log("Speech started event received");
      this._checkForInterruptions();
    });

    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      const joined = this.pendingTranscribedMessages.join(" ");
      this.pendingTranscribedMessages = [];
      this.emit("userMessage", joined);
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      this.connectionOpen = false;
      console.log("Deepgram Live Connection closed.");
    });

    connection.on(LiveTranscriptionEvents.Error, (err) => {
      console.error(err);
    });

    return connection;
  }

  async pushAudio(audioBuffer) {
    await this._clearClientAudio();
    const markName = `audio-${Date.now()}`;
    this._updateSpeakingTracking(audioBuffer);
    const payload = Buffer.from(audioBuffer).toString("base64");
    const message = {
      event: "media",
      streamSid: this.streamSid,
      media: {
        payload: payload,
      },
    };

    const messageJSON = JSON.stringify(message);
    await this.ws.sendUTF(messageJSON);
    await this.ws.sendUTF(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name: markName } }));
  }

  async _clearClientAudio() {
    await this.ws.sendUTF(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
  }

  _updateSpeakingTracking(audioBuffer) {
    const expectedDuration = this._computeAudioDuration(audioBuffer);
    console.log("Expected Audio duration is", expectedDuration, "seconds");
    this.assistantIsSpeaking = true;
    clearTimeout(this.assistantSpeakingTimer);

    this.assistantSpeakingTimer = setTimeout(() => {
        console.log("Assistant is done speaking");
        this.assistantIsSpeaking = false;
    }, expectedDuration * 1000);
  }

  _computeAudioDuration(audioBuffer) {
    return audioBuffer.length / (8000);
  }

  _checkForInterruptions() {
    clearTimeout(this.assistantInterruptionTimer);
    if (this.assistantIsSpeaking) {
      this.assistantInterruptionTimer = setTimeout(() => {
        if (this.assistantIsSpeaking) {
          console.log("[Interruption detected!]");
          this.emit(CallEvents.INTERRUPT);
          this._clearClientAudio();
          this.assistantIsSpeaking = false;
        }
      }, 1000);
    }
  }

  async pushMeta(metadata) {
    // No-Op
  }

  async indicateReady() {
    // No-Op
  }

  async end() {
    this.emit(CallEvents.END);
    this.ws.close();
  }
}

module.exports = { TwilioCall };
