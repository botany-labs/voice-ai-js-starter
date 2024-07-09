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
        console.log("Interim result:", data.channel.alternatives[0].transcript);
        return;
      }

      const transcript = data.channel.alternatives.reduce((acc, alt) => {
        return acc + alt.transcript;
      }, "");
      console.log("Final result:", transcript);

      if (data.speech_final) {
        console.log("Speech final event received");
      }
      this.pendingTranscribedMessages.push(transcript);
    });

    connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      console.log("Speech started event received");
    });

    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      console.log("Utterance end event received");
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
    const payload = Buffer.from(audioBuffer).toString("base64");
    const message = {
      event: "media",
      streamSid: this.streamSid,
      media: {
        payload: payload,
      },
    };

    const messageJSON = JSON.stringify(message);
    this.ws.sendUTF(messageJSON);
  }

  async pushMeta(metadata) {
    console.warn("[TwilioCall] pushMeta not implemented");
  }

  async indicateReady() {
    // No-Op
  }

  async end() {
    this.ws.close();
  }
}

module.exports = { TwilioCall };
