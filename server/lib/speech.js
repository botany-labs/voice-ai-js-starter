const fetch = require("node-fetch");
const OpenAI = require("openai");
const util = require("util");
const { float32ToPCM16, pcm16ToFloat32, float32_pcm16_to_wav_blob } = require("./audio");
const PlayHT = require("playht");
const { createClient : Deepgram, LiveTranscriptionEvents }  = require("@deepgram/sdk");
const { clearInterval } = require("timers");

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

const STT_MODELS = [
  "openai/whisper-1", 
  "deepgram/nova-2",
  "deepgram/whisper",
  // Streaming WS
  "deepgram:live/nova-2",
];

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
        case "deepgram":
          return tts_deepgram;
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
   * @returns {Promise<Float32Array>} - The audio data - PCM. 24k sample rate, 16 bit depth, 1 channel
   */
  async synthesize(message) {
    const pcm = new Int16Array(await this.tts(message, this.model, this.voice));
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
  PlayHT.init({
    userId: process.env.PLAYHT_USER_ID,
    apiKey: process.env.PLAYHT_API_KEY,
  });

  const streamingOptions = {
    voiceEngine: model,
    voiceId: voice,
    sampleRate: 24000,
    // This is a hack because im not sure why "raw" sounds so weird. 
    // With wav, we take off the first 44 bytes that make up the wav header
    // and it's effectively pcm.
    outputFormat: "wav",
    speed: 1,
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

// NOTE: Deepgram usese the format {model}-{voice}-{language} (i.e. aura-luna-en).
// User should provide luna-en as the voice to use.
const tts_deepgram = async (message, model, voice) => {
  const deepgram = Deepgram(process.env.DEEPGRAM_API_KEY);

  const deepgramModel = model + '-' + voice;
  // NOTE: voice not applicable
  const response = await deepgram.speak.request({text: message}, {
    model: deepgramModel,
    encoding: "linear16",
    sample_rate: 24000,
    container: "none",
  });
  
  const stream = await response.getStream();
  return new Promise(async (resolve, reject) => {
    try {
      const chunks = [];
      for await (const chunk of stream.values()) {
        chunks.push(chunk);
      }
      resolve(new Int16Array(Buffer.concat(chunks).buffer));
    }
    catch (err) {
      reject(err);
    }
  });
};

class SpeechToText {
  constructor(modelID) {
    const { provider, model } = this._parseModel(modelID ?? 'openai/whisper-1');
    this.model = model;
    this.provider = provider;
    this.sttObject = null;
    this.stt = (() => {
      switch (this.provider) {
        case "deepgram":
          if (!process.env.DEEPGRAM_API_KEY) {
            throw new Error(
              "DEEPGRAM_API_KEY is required to use deepgram for SpeechToText"
            );
          }
          return transcribeDeepgram;

        case "deepgram:live":
          if (!process.env.DEEPGRAM_API_KEY) {
            throw new Error(
              "DEEPGRAM_API_KEY is required to use deepgram for SpeechToText"
            );
          }
          const transcriber = new DeepgramRealtimeTranscriber(model, {keepAlive: true, connectOnInit: true});
          this.sttObject = transcriber;
          return transcriber.transcribe.bind(transcriber);
        case "openai":
            if (!process.env.OPENAI_API_KEY) {
              throw new Error(
                "OPENAI_API_KEY is required to use openai for SpeechToText"
              );
            }
            return transcribeWhisper;
      }
    })();

    if (!STT_MODELS.includes(modelID ?? 'openai/whisper-1')) {
      throw new Error(`Unsupported STT model: ${modelID}`);
    }
  }

  /**
   * Transcribe audio. 
   * @param {Float32Array} float32_pcm16 - The audio sample
   * Samples should be in 24k sample rate, 16 bit depth, 1 channel format.
   * @returns {Promise<string>} - The transcribed text
   */
  async transcribe(float32_pcm16) {
    return this.stt(this.model, float32_pcm16);
  }

  async destroy() {
    this.sttObject?.destroy();
  }

  _parseModel(model) {
    const parts = model.split("/");
    return {
      provider: parts[0],
      model: parts[1],
    };
  }
}

async function transcribeDeepgram(model, float32_pcm16) {
  const deepgram = Deepgram(process.env.DEEPGRAM_API_KEY);
  const wavBlob = float32_pcm16_to_wav_blob(float32_pcm16);

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    wavBlob,
    {
      model: model,
      smart_format: false,
      mode: false,
    }
  );

  if (error) {
    console.error(error);
    return;
  }
  const transcript = result.results.channels[0].alternatives.reduce((acc, alt) => {
    return acc + alt.transcript;
  }, "");
  return transcript;
}

async function transcribeWhisper(model, float32_pcm16) {
  const wavBlob = float32_pcm16_to_wav_blob(float32_pcm16);
  const transcription = await openai.audio.transcriptions.create({
    model,
    file: wavBlob,
  });
  return transcription.text;
}

// TODO: Refactor to stream up audio in realtime instead of giving it all in the .transcribe.
class DeepgramRealtimeTranscriber {
  /**
   * @param {string} model - Deepgram model to use
   * @param {object} options - Options for the transcriber
   * @param {boolean} options.keepAlive - Whether to keep the connection alive
   * @param {number} options.waitTimeAfterFirstChunk - Time to wait for transcription to finish. Default 200ms
   * @param {boolean} options.connectOnInit - Connect in constructor? Defaults to false.
   */
  constructor(model, options={}) {
    this.model = model;
    this.deepgram = Deepgram(process.env.DEEPGRAM_API_KEY);
    this.waitTimeAfterSend = options.waitTimeAfterFirstChunk ?? 1000;
    this._connection = null;
    this.connectionOpen = false;
    this.keepAlive = options.keepAlive ?? true;
    this.keepAliveInterval = setInterval(this.keepAliveLoop.bind(this), 5000);
    if (options.connectOnInit ?? false) {
      this.getConnection();
    }
  }

  async transcribe(model, float32_pcm16) {
    const connection = await this.getConnection();

    if (!this.connectionOpen) {
      throw new Error("Deepgram connection not open");
    }

    const aspcmInt16 = float32ToPCM16(float32_pcm16);
    connection.send(aspcmInt16);

    const collected = [];
    let lastWasPending = false;

    const createResult = () => {
      return collected.join(" ");
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        resolve(createResult());
      }, this.waitTimeAfterSend);

      const handleTranscript = (data) => {

        if (data.is_final && lastWasPending) {
          collected[collected.length - 1] = data.channel.alternatives[0].transcript;
        } else {
          collected.push(data.channel.alternatives[0].transcript);
        }
        
        lastWasPending = data.is_final;

        if (data.speech_final) {
          clearTimeout(timeoutId);
          resolve(createResult());
          connection.removeListener(LiveTranscriptionEvents.Transcript, handleTranscript);
        }
      };

      connection.on(LiveTranscriptionEvents.Transcript, handleTranscript);
    });
  }

  async getConnection() {
    if (this._connection) {
      return this._connection;
    }

    let promiseResolve, promiseReject;
    this._connection = new Promise((resolve, reject) => {
      promiseResolve = resolve;
      promiseReject = reject;
    });

    const connection = this.deepgram.listen.live({
      model: this.model,
      encoding: "linear16",
      sample_rate: 24000,
      smart_format: false,
      interim_results: true,
      numerals: true,
      endpointing: 200,
      vad_events: true,
      interim_results: true,
      utterance_end_ms: "1000",
    });

    try {
      const setupTimeout = setTimeout(() => promiseReject("Failed to setup deepgram connection"), 5000);
      connection.on(LiveTranscriptionEvents.Open, () => {
        this.connectionOpen = true;
        console.log("Deepgram Live Connection opened.");
        clearTimeout(setupTimeout);
        promiseResolve(connection);

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
        
        });
  
        connection.on(LiveTranscriptionEvents.Close, () => {
          this.connectionOpen = false;
          clearInterval(this.keepAliveInterval);
          console.log("Deepgram Live Connection closed.");
        })

        connection.on(LiveTranscriptionEvents.Error, (err) => {
          console.error(err);
        })
      });
    } catch (err) {
      promiseReject(err);
    }

    return this._connection;
  }

  async keepAliveLoop() {
    const connection = await this._connection;
    if (connection && this.connectionOpen && connection.keepAlive) {
      connection.keepAlive();
    }
    else {
      clearInterval(this.keepAliveInterval);
    }
  }

  async destroy () {
    if (this.connectionOpen) {
      (await this._connection).finish();
    }
  }
  
}

module.exports = {
  TextToSpeech,
  SpeechToText,
  tts_elevenlabs,
  tts_openai,
  transcribeWhisper,
  transcribeDeepgram,
  TTS_MODELS,
};
