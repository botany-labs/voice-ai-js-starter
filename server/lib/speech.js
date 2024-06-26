const fetch = require("node-fetch");
const OpenAI = require("openai");
const util = require("util");
const { float32ToPCM16, pcm16ToFloat32, createWavHeader } = require("./audio");
const PlayHT = require("playht");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

PlayHT.init({
  userId: process.env.PLAYHT_USER_ID,
  apiKey: process.env.PLAYHT_API_KEY,
});

const TTS_MODELS = [
  "elevenlabs/eleven_monolingual_v1",
  "elevenlabs/eleven_turbo_v2",
  "openai/tts-1",
  "openai/tts-1-hd",
  "playht/PlayHT2.0-turbo",
  "playht/PlayHT2.0",
  "playht/PlayHT1.0",
];

const STT_MODELS = ["openai/whisper-1"];

class TextToSpeech {
  constructor(modelID, voice) {
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
      }
    })();
    this.model = model;
    this.voice = voice;

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
   * @returns {Promise<Float32Array>} - The audio data - PCM. 24k sample rate, 16 bit depth, 1 channel
   */
  async synthesize(message) {
    console.log("STARTING");
    const pcm = new Int16Array(await this.tts(message, this.model, this.voice));
    console.log("COMPLETED");
    return pcm16ToFloat32(pcm);
  }

  _parseModel(model) {
    const parts = model.split("/");
    return {
      provider: parts[0],
      model: parts[1],
    };
  }
}

async function tts_elevenlabs(message, model, voice) {
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

async function tts_openai(message, model, voice) {
  const response = await openai.audio.speech.create({
    model,
    voice,
    input: message,
    response_format: "pcm",
  });

  const arrayBuffer = await response.arrayBuffer();
  return arrayBuffer;
}

async function tts_playhts(message, model, voice) {
  const streamingOptions = {
    // must use turbo for the best latency
    voiceEngine: model,
    // this voice id can be one of our prebuilt voices or your own voice clone id, refer to the`listVoices()` method for a list of supported voices.
    voiceId: voice,
    // you can pass any value between 8000 and 48000, 24000 is default
    sampleRate: 24000,
    // the generated audio encoding, supports 'raw' | 'mp3' | 'wav' | 'ogg' | 'flac' | 'mulaw'
    outputFormat: "wav",
    // playback rate of generated speech
    speed: 1,
    // quality
    quality: "low",
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
        // slice off first 44 bytes for wav header
        const audio = final.slice(44);

        resolve(new Int16Array(audio.buffer));
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

class SpeechToText {
  constructor(model) {
    this.model = model;
    if (!STT_MODELS.includes(model)) {
      throw new Error(`Unsupported STT model: ${model}`);
    }
  }

  /**
   * Transcribe audio. (only whisper-1 is supported for now)
   * @param {Float32Array[]} samples - The audio samples as an array of Float32Arrays.
   * Samples should be in 24k sample rate, 16 bit depth, 1 channel format. Stored as Float32Arrays of length 1024.
   * @returns {Promise<string>} - The transcribed text
   */
  async transcribe(inputs) {
    return transcribeWhisper(inputs);
  }
}

async function transcribeWhisper(audioSamples) {
  const samples = audioSamples.slice();
  // join pending samples
  const audio = new Float32Array(samples.length * 1024);
  for (let i = 0; i < samples.length; i++) {
    audio.set(samples[i], i * 1024);
  }

  let pcm16 = float32ToPCM16(audio);
  // TODO: Pass these in from client
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

  return transcription.text;
}

module.exports = {
  TextToSpeech,
  SpeechToText,
  tts_elevenlabs,
  tts_openai,
  transcribeWhisper,
  TTS_MODELS,
};
