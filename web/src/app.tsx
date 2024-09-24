import { useState, useRef, useEffect } from "react";
import * as vad from "@ricky0123/vad-web";
import EventEmitter from "events";

const SERVER_WS_URL =
  process.env.REACT_APP_SERVER_WS_URL ?? "ws://localhost:8000";

const START_LISTENING_TOKEN = "RDY"; // Sent by server to indicate start VAD
const END_OF_SPEECH_TOKEN = "EOS"; // End of speech on client side
const INTERRUPT_TOKEN = "INT"; // Interrupt reported from client side
const CLEAR_BUFFER_TOKEN = "CLR"; // Clear playback buffer request from server

// These are shared between streamer and playback but
// we are using float32arrays of pcm 24k 16bit mono
const AudioContextSettings = {
  sampleRate: 24000,
  bitDepth: 16,
  numChannels: 1,
  echoCancellation: true,
  autoGainControl: true,
  noiseSuppression: true,
  channelCount: 1,
};

export default function App() {
  const [logMessage, Logs] = useLogs();
  const ws = useRef<WebSocket | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const streamer = useRef<Streamer | null>(null);
  const playback = useRef<Playback | null>(null);
  const lastEOS = useRef<Date | null>(null);
  const [assistant, setAssistant] = useState<
    "fastest" | "best-quality" | "openai"
  >("fastest");

  const stopRecording = (graceful: boolean = false) => {
    setIsRecording(false);
    streamer.current?.stop(graceful);
    playback.current?.stop(graceful);
    ws.current?.close();
    ws.current = null;
    lastEOS.current = null;
  };

  const startRecording = async () => {
    setIsRecording(true);
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      ws.current = new WebSocket(
        SERVER_WS_URL + "?assistant=" + (assistant || "default")
      );
      ws.current.binaryType = "arraybuffer";
      ws.current.onopen = () => {
        ws.current &&
          (ws.current.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              playback.current?.addSamples(new Float32Array(event.data));
            } else if (event.data === CLEAR_BUFFER_TOKEN) {
              playback.current?.clear().then((didInterrupt: boolean) => {
                if (didInterrupt) {
                  logMessage("--- interrupt recorded", didInterrupt);
                  ws.current && ws.current.send(INTERRUPT_TOKEN);
                }
              });
            } else if (event.data === START_LISTENING_TOKEN) {
              playback.current?.once("playbackEnd", () => {
                logMessage("--- starting vad");
                streamer.current?.startVoiceDetection();
              });
            } else {
              logMessage(event.data);
            }
          });

        logMessage("start recording", new Date());
        playback.current = new Playback(new AudioContext(AudioContextSettings));
        playback.current.on("playbackStart", () => {
          if (!lastEOS.current) {
            return;
          }
          const responseTime = new Date().getTime() - lastEOS.current.getTime();
          logMessage("--- time.TOTAL_RESPONSE ", responseTime, " ms");
        });
        playback.current.start();
        streamer.current = new Streamer(ws.current!, logMessage);
        streamer.current.on("speechStart", () => {
          playback.current?.clear().then((didInterrupt: boolean) => {
            if (didInterrupt) {
              logMessage("--- interrupt recorded", didInterrupt);
              ws.current && ws.current.send(INTERRUPT_TOKEN);
            }
          });
        });
        streamer.current.on("speechEnd", () => {
          lastEOS.current = new Date();
        });
        streamer.current.start();

        ws.current &&
          (ws.current.onclose = () => {
            logMessage("websocket closed");
            stopRecording(true);
          });
      };

      ws.current.onerror = (event) => {
        logMessage("websocket error", event);
      };
    }
  };

  return (
    <main className="flex flex-col h-screen w-full max-w-lg mx-auto text-yellow-300 px-4 py-8">
      <div className="flex justify-center flex-col">
        <a
          href="https://github.com/botany-labs/voice-ai-js-starter"
          target="_blank"
          className="flex items-center space-x-2 mb-2 group cursor-pointer w-fit"
        >
          <img
            className="w-6 h-6 rounded-full bg-yellow-300 group-hover:bg-yellow-100"
            src="/GitHub-Logo.svg"
          />
          <h1 className="text-xl font-bold group-hover:text-yellow-100">
            {" "}
            botany-labs/voice-ai-js-starter demo
          </h1>
        </a>
        <p className="text-sm">For best results, use headphones.</p>
      </div>
      <div className="my-8 flex flex-col">
        {isRecording ? (
          <button
            onClick={() => stopRecording(false)}
            className="mx-auto w-1/2 bg-red-500 font-bold text-white px-4 py-2 rounded-md"
          >
            Hang Up
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="mx-auto w-1/2 bg-yellow-300 text-black font-bold px-4 py-2 rounded-md"
          >
            Begin Call
          </button>
        )}
        <div className="flex flex-col w-full justify-center items-start mt-8">
          <div className="text-yellow-300 mr-2"> Configuration: </div>
          <select
            className="text-yellow-100 bg-black border px-2 my-1 rounded-md"
            value={assistant}
            onChange={(e) => setAssistant(e.target.value as any)}
            disabled={isRecording}
          >
            <option value="fastest"> Fastest </option>
            <option value="best-quality">Best Quality </option>
            <option value="openai">
              OpenAI Only (decently fast, also multilinugal!)
            </option>
          </select>
        </div>
        <div className="text-yellow-100 text-sm w-full flex justify-center items-center">
          {assistant === "fastest" && (
            <>
              {" "}
              TTS: Deepgram Nova-2 Streaming / STT: Deepgram Aura / LLM: ChatGPT
              3.5 Turbo{" "}
            </>
          )}
          {assistant === "best-quality" && (
            <>
              {" "}
              TTS: OpenAI Whisper / STT: Elevenlabs Turbo V2 / LLM: ChatGPT 3.5
              Turbo{" "}
            </>
          )}
          {assistant === "openai" && (
            <>
              {" "}
              TTS: OpenAI Whisper / STT: OpenAI TTS-1 / LLM: ChatGPT 3.5 Turbo{" "}
            </>
          )}
        </div>
      </div>
      <Logs />
    </main>
  );
}

const Logs = ({
  logLines,
  clearLogs,
}: {
  logLines: JSX.Element[];
  clearLogs: () => void;
}) => {
  return (
    <>
      <div className="flex w-full justify-between">
        <h1 className="text-xl font-bold mx-2 my-2"> Logs </h1>
        <button
          onClick={clearLogs}
          className=" border-yellow-300 border px-4 my-1 rounded-md"
        >
          {" "}
          Clear{" "}
        </button>
      </div>
      <div className="border-yellow-300 overflow-y-auto hover:justify-normal flex flex-col justify-end py-2 px-1 font-mono text-green-300 rounded-md border-2 min-h-[200px] max-h-1/2">
        {logLines.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
    </>
  );
};

const useLogs = () => {
  const [logs, setLogs] = useState<{ time: Date; message: string }[]>([]);
  const logsRef = useRef<{ time: Date; message: string }[]>([]);

  const clearLogs = () => {
    logsRef.current = [];
    setLogs([]);
  };

  const logMessage = (...args: any[]) => {
    const time = new Date();
    const message = args.join(" ");
    logsRef.current.push({ time, message });
    console.log(`[${time.toLocaleTimeString()}] ${message}`);
    setLogs([...logsRef.current]);
  };

  const logDisplay = () => {
    const logLines = logs.map((log) => (
      <p key={log.time.toISOString()}>
        <b>[{log.time.toLocaleTimeString()}]</b> {log.message}
      </p>
    ));
    return <Logs logLines={logLines} clearLogs={clearLogs} />;
  };
  return [logMessage, logDisplay] as const;
};

class Streamer extends EventEmitter {
  ws: WebSocket;
  stream: MediaStream | null = null;
  processor: ScriptProcessorNode | null = null;
  vadMic: Promise<vad.MicVAD> | null = null;
  audioContext: AudioContext | null = null;
  userIsSpeaking: boolean = false;

  constructor(ws: WebSocket, private logMessage: (...args: any[]) => void) {
    super();
    this.ws = ws;

    this.vadMic = vad.MicVAD.new({
      onSpeechStart: () => {
        this.emit("speechStart");
        logMessage("--- vad: speech start");
        this.userIsSpeaking = true;
      },
      onSpeechEnd: (audio) => {
        this.emit("speechEnd");
        logMessage("--- vad: speech end");
        ws.send(END_OF_SPEECH_TOKEN);
        this.userIsSpeaking = false;
      },
    });
    this.audioContext = new AudioContext(AudioContextSettings);
  }

  async startVoiceDetection() {
    (await this.vadMic!).start();
  }

  async start(startVoiceDetection: boolean = false) {
    const constraints = {
      audio: true,
    };
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      this.stream = stream;
      const audioContext = new AudioContext({
        sampleRate: 24000,
      });
      this.logMessage("audio context sample rate", audioContext.sampleRate);
      const source = audioContext.createMediaStreamSource(stream);
      this.logMessage("media stream source created");
      this.processor = audioContext.createScriptProcessor(1024, 1, 1);
      this.processor.onaudioprocess = (event) => {
        if (this.ws.readyState === WebSocket.OPEN && this.userIsSpeaking) {
          this.ws.send(event.inputBuffer.getChannelData(0));
        }
      };
      source.connect(this.processor);
      this.processor.connect(audioContext.destination);
    });
    if (startVoiceDetection) {
      await this.startVoiceDetection();
    }
  }

  async stop(graceful: boolean = false) {
    this.audioContext?.suspend();

    this.stream?.getTracks().forEach((track) => {
      track.stop();
      this.stream?.removeTrack(track);
    });
    this.processor && (this.processor.onaudioprocess = null);
    const vadMic = await this.vadMic;
    vadMic && vadMic.destroy();
    this.vadMic = null;
  }
}

class Playback extends EventEmitter {
  samples: Float32Array[] = [];
  lastFramePlayed: "silence" | "non-silence" = "silence";

  constructor(public audioContext: AudioContext) {
    super();
    this.audioContext.suspend();
    const scriptNode = this.audioContext.createScriptProcessor(1024, 1, 1);
    scriptNode.onaudioprocess = (event) => {
      if (this.samples.length > 0) {
        if (this.lastFramePlayed === "silence") {
          this.emit("playbackStart");
        }
        this.lastFramePlayed = "non-silence";
        event.outputBuffer.getChannelData(0).set(this.samples[0]);
        this.samples.shift();
      } else {
        if (this.lastFramePlayed === "non-silence") {
          this.emit("playbackEnd");
        }
        this.lastFramePlayed = "silence";
        const silence = new Float32Array(1024);
        event.outputBuffer.getChannelData(0).set(silence);
      }
    };

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = 0.5;
    scriptNode.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
  }

  async clear() {
    await this.audioContext.suspend();
    const dirty = this.samples.length > 0;
    this.samples = [];
    await this.audioContext.resume();
    this.emit("clear", { dirty });
    this.lastFramePlayed = "silence";
    return dirty;
  }

  start() {
    this.audioContext.resume();
  }

  stop(graceful: boolean = false) {
    if (graceful) {
      if (this.samples.length > 0) {
        return setTimeout(() => {
          this.stop(true);
        }, 1000);
      }
    } else {
      this.audioContext.suspend();
    }
  }

  addSamples(samples: Float32Array) {
    this.samples.push(samples);
  }
}
