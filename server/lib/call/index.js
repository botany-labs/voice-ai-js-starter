const { EventEmitter } = require("events");

const CallEvents = {
  USER_MESSAGE: "userMessage",
  CALL_ENDED: "callEnded",
  INTERRUPT: "interrupt",
};

class Call extends EventEmitter {
  constructor() {
    super();
  }

  async indicateReady() {
    throw new Error("Not implemented");
  }

  async pushAudio(audioBuffer) {
    throw new Error("Not implemented");
  }

  async pushMeta(metadata) {
    throw new Error("Not implemented");
  }

  async end() {
    throw new Error("Not implemented");
  }
}

module.exports = { Call, CallEvents };