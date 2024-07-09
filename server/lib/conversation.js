const { CallEvents } = require("./call");

/**
 * Conversation represents a conversation between a user and an assistant.
 * It listens for user messages, sends assistant messages, and handles tool selections.
 */
class Conversation {
    /**
     * Constructor
     * @param {Assistant} assistant - Assistant to use for the conversation.
     * @param {Call} call - Call to use for the conversation.
     * @param {object} options - Options for the conversation.
     * @param {(callLogs: Array<{timestamp: string, event: string, meta: object}>) => void} options.onEnd - Function to call when the conversation ends.
     */
    constructor(assistant, call, stt, options = {}) {
        this.assistant = assistant;
        this.call = call;
        this.onEnd = options.onEnd || (() => { });
        this.history = assistant.prompt;
        this.callLog = [];
        this.call.on(CallEvents.CALL_ENDED, () => {
            this.addToCallLog("CALL_ENDED");
            this.onEnd && this.onEnd(this.callLog);
        });
        this.call.on(CallEvents.INTERRUPT, () => {
            this.noteWhatWasSaid("user", "[Interrupted your last message]");
        });
        this.addToCallLog("INIT", {
            assistant: JSON.stringify(this.assistant),
        });
    }

    /**
     * Begins the conversation.
     * @param {number} delay - Delay in milliseconds before starting to listen for user messages.
     */
    async begin(delay = 0) {
        setTimeout(async () => {
            this.startListening();
            this.addToCallLog("READY");
            this.call.indicateReady();

            if (this.assistant.speakFirst) {
                let firstMessage = this.assistant.speakFirstOpeningMessage;
                if (!firstMessage) {
                    const { content } = await this.assistant.createResponse(this.history);
                    firstMessage = content;
                }
                this.noteWhatWasSaid("assistant", firstMessage);
                const audio = await this.assistant.textToSpeech(firstMessage);
                this.call.pushAudio(audio);
            }
        }, delay);
    }

    /**
     * Starts listening for user messages.
     */
    startListening() {
        this.call.on(CallEvents.USER_MESSAGE, async (message) => {
            this.noteWhatWasSaid("user", message);
            const { content, selectedTool } = await this.assistant.createResponse(
                this.history
            );
            if (content) {
                this.noteWhatWasSaid("assistant", content);
                const audio = await this.assistant.textToSpeech(content);
                if (selectedTool) {
                    await this.call.pushAudio(audio);
                } else {
                    this.call.pushAudio(audio);
                }
            }
            
            if (selectedTool) {
                this.addToCallLog("TOOL_SELECTED", {
                    tool: selectedTool,
                });
            }

            if (selectedTool === "endCall") {
                this.call.pushMeta("---- Assistant Hung Up ----");
                this.call.end();
                this.call.off("userMessage", this.startListening);
                return;
            } else if (selectedTool) {
                // TODO: implement custom tools
                console.warn(
                    "[CUSTOM TOOLS NOT YET SUPPORTED] Unhandled tool:",
                    selectedTool
                );
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

module.exports = { Conversation };
