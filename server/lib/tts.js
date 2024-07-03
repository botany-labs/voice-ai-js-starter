const fetch = require("node-fetch");
const OpenAI = require("openai");
const util = require("util");
const PlayHT = require("playht");
const { createClient: Deepgram } = require("@deepgram/sdk");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TTS_MODELS = [
  "elevenlabs/eleven_monolingual_v1",
  "elevenlabs/eleven_turbo_v2",
  "elevenlabs/eleven_multilingual_v2",
  "openai/tts-1",
  "openai/tts-1-hd",
  "playht/PlayHT2.0-turbo",
  "playht/PlayHT2.0",
  "playht/PlayHT1.0",
  "deepgram/aura",
];

const TTS_AUDIO_FORMATS = {
  PCM_24K: "pcm_24000",
  MULAW_8K: "mulaw_8000",
};

class TextToSpeech {
  constructor(modelID, voice, format = TTS_AUDIO_FORMATS.PCM_24K) {
    if (!TTS_MODELS.includes(modelID)) {
      throw new Error(`Unsupported TTS model: ${modelID}`);
    }
    const { provider, model } = this._parseModel(modelID);
    this.tts = (() => {
      switch (provider) {
        case "elevenlabs":
          return tts_elevenlabs;
        case "openai":
          return tts_openai;
        case "playht":
          return tts_playhts;
        case "deepgram":
          return tts_deepgram;
      }
    })();
    this.model = model;
    this.voice = voice;
    this.format = format;

    // Do check for creds
    if (provider === "elevenlabs") {
      if (!process.env.ELEVEN_LABS_API_KEY) {
        throw new Error(
          "ELEVEN_LABS_API_KEY is required to use elevenlabs for TextToSpeech"
        );
      }
    }

    if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error(
          "OPENAI_API_KEY is required to use openai for TextToSpeech"
        );
      }
    }

    if (provider === "deepgram") {
      if (!process.env.DEEPGRAM_API_KEY) {
        throw new Error(
          "DEEPGRAM_API_KEY is required to use deepgram for TextToSpeech"
        );
      }
    }

    if (provider === "playht") {
      if (!process.env.PLAYHT_USER_ID || !process.env.PLAYHT_API_KEY) {
        throw new Error(
          "PLAYHT_USER_ID and PLAYHT_API_KEY are required to use playht for TextToSpeech"
        );
      }
    }
  }

  /**
   * Synthesize a message into audio playable over the wire by our client.
   * @param {string} message - The message to synthesize
   * @returns {Buffer | ArrayBuffer} - The audio data - PCM. 24k sample rate, 16 bit depth, 1 channel
   */
  async synthesize(message) {
    return this.tts(message, this.model, this.voice, this.format);
  }

  _parseModel(model) {
    const parts = model.split("/");
    return {
      provider: parts[0],
      model: parts[1],
    };
  }
}

async function tts_elevenlabs(message, model, voice, format) {
  const body = {
    text: message,
    model,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0,
    },
  };

  const query = {
    output_format: "pcm_24000",
  };

  if (format === TTS_AUDIO_FORMATS.MULAW_8K) {
    query.output_format = "ulaw_8000";
  }

  const options = {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVEN_LABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}?${new URLSearchParams(
      query
    )}`,
    options
  );

  if (response.status !== 200) {
    console.error(
      "Failed to generate audio",
      response.status,
      response.statusText,
      util.inspect(await response.json(), { depth: null, colors: true })
    );
    return;
  }
  const arrayBuffer = await response.arrayBuffer();
  const audio = new Int16Array(arrayBuffer);
  return audio;
}

async function tts_openai(message, model, voice, format) {
  const response = await openai.audio.speech.create({
    model,
    voice,
    input: message,
    response_format: "pcm",
  });

  if (format !== TTS_AUDIO_FORMATS.PCM_24K) {
    throw new Error(`TODO: OpenAI unsupported audio format: ${format}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return arrayBuffer;
}

async function tts_playhts(message, model, voice, format) {
  PlayHT.init({
    userId: process.env.PLAYHT_USER_ID,
    apiKey: process.env.PLAYHT_API_KEY,
  });

  const streamingOptions = {
    voiceEngine: model,
    voiceId: voice,
    speed: 1,
    ...(format === TTS_AUDIO_FORMATS.MULAW_8K
      ? {
          outputFormat: "mulaw",
          sampleRate: 8000,
        }
      : {
          // This is a hack because im not sure why "raw" sounds so weird.
          // With wav, we take off the first 44 bytes that make up the wav header
          // and it's effectively pcm.
          outputFormat: "wav",
          sampleRate: 24000,
        }),
  };
  try {
    const stream = await PlayHT.stream(message, streamingOptions);
    return await new Promise((resolve, reject) => {
      const chunks = [];
      let totalSize = 0;

      stream.on("data", (chunk) => {
        chunks.push(chunk);
        totalSize += chunk.length;
      });

      stream.on("end", () => {
        const final = Buffer.alloc(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          final.set(chunk, offset);
          offset += chunk.length;
        }
        if (format === TTS_AUDIO_FORMATS.PCM_24K) {
         // slice off first 44 bytes for wav header
          const audio = final.slice(44);
          resolve(new Int16Array(audio.buffer));
        } else {
          resolve(final);
        }

      });

      stream.on("error", (err) => {
        reject(err);
      });
    });
  } catch (err) {
    console.error(err);
    return;
  }
}

// NOTE: Deepgram usese the format {model}-{voice}-{language} (i.e. aura-luna-en).
// User should provide luna-en as the voice to use.
const tts_deepgram = async (message, model, voice, format) => {
  const deepgram = Deepgram(process.env.DEEPGRAM_API_KEY);

  const deepgramModel = model + "-" + voice;
  // NOTE: voice not applicable
  const response = await deepgram.speak.request(
    { text: message },
    {
      model: deepgramModel,
      encoding: format === TTS_AUDIO_FORMATS.PCM_24K ? "linear16" : "mulaw",
      sample_rate: format === TTS_AUDIO_FORMATS.PCM_24K ? 24000 : 8000,
      container: "none",
    }
  );
  const stream = await response.getStream();
  return new Promise(async (resolve, reject) => {
    try {
      const chunks = [];
      for await (const chunk of stream.values()) {
        chunks.push(chunk);
      }
      resolve(new Int16Array(Buffer.concat(chunks).buffer));
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = {
  TextToSpeech,
  tts_elevenlabs,
  tts_openai,
  tts_playhts,
  tts_deepgram,
  TTS_MODELS,
};
