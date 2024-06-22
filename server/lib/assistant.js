const { TextToSpeech } = require("./speech");
const { CallConversation } = require("./call");
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Defines an AI call assistant.
 * 
 * TODO: Support custom tools
 */
class Assistant {
  /**
   * @param {string} instructions - Instructions to give your assistant.
   * @param {object} [options] - Options to give your assistant.
   * @param {string} [options.llmModel] - LLM model to use. Defaults to "gpt-3.5-turbo".
   * @param {string} [options.voiceModel] - Voice model to use. Defaults to "openai/tts-1". See TTS_MODELS (./speech.js) for supported models.
   * @param {string} [options.voiceName] - Voice name to use. Defaults to "shimmer".
   * @param {string} [options.systemPrompt] - System prompt to give your assistant.
   * @param {string} [options.speakFirstOpeningMessage] - Opening message to give your assistant to say once the call starts. If not provided, the assistant will just be prompted to speak.
   * @param {string} [options.speakFirst] - Speak first? Defaults to true.
   * @param {string} [options.canHangUp] - Can hang up? Defaults to true.
   * @param {string[]} [options.utterances] - Affirmations to give your assistant. Defaults to `DEFAULT_UTTERANCES`
   * @param {number} [options.utteranceProbability] - Probability of utterance. Defaults to `DEFAULT_UTTERANCE_PROBABILITY`
   */
  constructor(instructions, options = {}) {
    this.instructions = instructions;
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.tools = options.canHangUp === false ? TOOLS_NONE : TOOL_HANG_UP; // NOTE: only tool supported right now is hang-up
    this.speakFirst = options.speakFirst || true;
    this.speakFirstOpeningMessage = options.speakFirstOpeningMessage;
    this.utterances = options.utterances || DEFAULT_UTTERANCES;
    this.utteranceProbability =
      options.utteranceProbability || DEFAULT_UTTERANCE_PROBABILITY;
    this.llmModel = options.llmModel || "gpt-3.5-turbo";
    this.voiceModel = options.voiceModel || "openai/tts-1";
    this.voiceName = options.voiceName || "shimmer";
    this.tts = new TextToSpeech(this.voiceModel, this.voiceName);
  }

  /**
   * Assembles the prompt for chat LLMs.
   * @param {string} systemPrompt - System prompt to give your assistant.
   * @param {string} providedInstructions - Instructions to give your assistant.
   * @param {string} tools - Tools to give your assistant.
   */
  _assemblePrompt(systemPrompt, providedInstructions, tools) {
    let instructionPrompt = INSTRUCTION_PROMPT_BASE;
    instructionPrompt = instructionPrompt.replace(
      "{instructions}",
      providedInstructions
    );
    instructionPrompt = instructionPrompt.replace("{tools}", tools);

    const prompt = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: instructionPrompt,
      },
    ];

    return prompt;
  }

  get prompt() {
    return this._assemblePrompt(
      this.systemPrompt,
      this.instructions,
      this.tools
    );
  }

  /**
   * @param {object[]} conversation - Chat conversation to create a response for.
   */
  async createResponse(conversation) {
    let selectedTool = undefined;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: conversation,
    });

    let content = response.choices[0].message.content;

    if (content.includes("[endCall]")) {
      content = content.replace("[endCall]", "");
      return {
        content,
        selectedTool: "endCall",
      };
    }

    return {
      content,
      selectedTool,
    };
  }

  async createUtterance() {
    if (this.utterances.length === 0) {
      return;
    }
    const random = Math.random();
    if (random < this.utteranceProbability) {
      return this.utterances[
        Math.floor(Math.random() * this.utterances.length)
      ];
    }
  }

  async textToSpeech(content) {
    const result = await this.tts.synthesize(content);
    return result;
  }

  // Create a conversation with this assistant
  createConversation(ws) {
    return new CallConversation(this, ws);
  }
}

// ----- Constants -----

const DEFAULT_UTTERANCES = ["Got it.", "Yeah.", "I see.", "Okay.", "Right."];
const DEFAULT_UTTERANCE_PROBABILITY = 0.8;

// ----- Prompting ------

const DEFAULT_SYSTEM_PROMPT =
  "You are a delightful AI voice agent. You are receiving a call from a customer. Please be polite but concise. Respond ONLY with the text to be spoken. DO NOT add any prefix. ";

const INSTRUCTION_PROMPT_BASE = `
INSTRUCTIONS
{instructions}

TOOLS
{tools}
`;

const TOOL_HANG_UP =
  "[endCall] : You can use the token [endCall] tool to hang up the call. Write it exactly as that.";
const TOOLS_NONE = "N/A";

exports.Assistant = Assistant;
