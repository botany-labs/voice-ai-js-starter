const OpenAI = require("openai");
const { float32ToPCM16, float32_pcm16ToWavBlob } = require("./audio");
const { createClient : Deepgram, LiveTranscriptionEvents }  = require("@deepgram/sdk");
const { clearInterval } = require("timers");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const STT_MODELS = [
  "openai/whisper-1", 
  "deepgram/nova-2",
  "deepgram/whisper",
  "deepgram:live/nova-2", // Streaming WS
];

const STT_AUDIO_FORMATS = {
  PCM_24K: "pcm_24000",
  MULAW_8K: "mulaw_8000",
}

class SpeechToText {

  constructor(modelID, format=STT_AUDIO_FORMATS.PCM_24K) {
    const { provider, model } = this._parseModel(modelID ?? 'openai/whisper-1');
    this.model = model;
    this.provider = provider;
    this.format = format;
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
          const transcriber = new DeepgramRealtimeTranscriber(model, format, {keepAlive: true, connectOnInit: true});
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
   * @param {ArrayBuffer} audio_sample - The audio sample
   * @returns {Promise<string>} - The transcribed text
   */
  async transcribe(audio_sample) {
    return this.stt(this.model, audio_sample, this.format);
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

async function transcribeDeepgram(model, audio_sample, format) {
  const deepgram = Deepgram(process.env.DEEPGRAM_API_KEY);
  if (format === STT_AUDIO_FORMATS.PCM_24K) {
    audio_sample = float32_pcm16ToWavBlob(audio_sample);
  }
  else {
    // TODO: Need to convert to PCM_24K
    throw new Error(`Deepgram unsupported audio format: ${format}`);
  }
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

async function transcribeWhisper(model, audio_sample, format) {
  if (format === STT_AUDIO_FORMATS.PCM_24K) {
    audio_sample = float32_pcm16ToWavBlob(audio_sample);
  }
  else {
    // TODO: Need to convert to PCM_24K
    throw new Error(`OpenAI unsupported audio format: ${format}`);
  }
  const transcription = await openai.audio.transcriptions.create({
    model,
    file: audio_sample,
  });
  return transcription.text;
}

// TODO: Refactor to stream up audio in realtime instead of giving it all in the .transcribe.
class DeepgramRealtimeTranscriber {
  /**
   * @param {string} model - Deepgram model to use
   * @param {string} format - Audio format to use
   * @param {object} options - Options for the transcriber
   * @param {boolean} options.keepAlive - Whether to keep the connection alive
   * @param {number} options.waitTimeAfterFirstChunk - Time to wait for transcription to finish. Default 200ms
   * @param {boolean} options.connectOnInit - Connect in constructor? Defaults to false.
   */
  constructor(model, format=STT_AUDIO_FORMATS.PCM_24K, options={}) {
    this.model = model;
    this.format = format;
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

  async transcribe(model, audio_sample, format) {
    const connection = await this.getConnection();

    if (!this.connectionOpen) {
      throw new Error("Deepgram connection not open");
    }

    if (format === STT_AUDIO_FORMATS.PCM_24K) {
      audio_sample = float32ToPCM16(audio_sample);
    }
    connection.send(audio_sample);

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
      smart_format: false,
      interim_results: true,
      numerals: true,
      endpointing: 200,
      vad_events: true,
      interim_results: true,
      utterance_end_ms: "1000",
      encoding: this.format === STT_AUDIO_FORMATS.PCM_24K ? "linear16" : "mulaw",
      sample_rate: this.format === STT_AUDIO_FORMATS.PCM_24K ? 24000 : 8000,
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
  SpeechToText,
  transcribeWhisper,
  transcribeDeepgram,
};
