import { useState, useRef, useEffect } from "react";
import * as vad from "@ricky0123/vad-web";

const SERVER_WS_URL = process.env.REACT_APP_SERVER_WS_URL ?? "ws://localhost:8000";

const END_OF_SPEECH_TOKEN = "EOS";
const INTERRUPT_TOKEN = "INT";
const CLEAR_BUFFER_TOKEN = "CLR";

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
}

export default function App() {
  const [logMessage, Logs] = useLogs();
  const ws = useRef<WebSocket | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const streamer = useRef<Streamer | null>(null);
  const playback = useRef<Playback | null>(null);

  const stopRecording = (graceful: boolean = false) => {
    setIsRecording(false);
    streamer.current?.stop(graceful);
    playback.current?.stop(graceful);
    ws.current?.close();
    ws.current = null;
  };

  const startRecording = async () => {
    setIsRecording(true);
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      ws.current = new WebSocket(SERVER_WS_URL);
      ws.current.binaryType = "arraybuffer";
      ws.current.onopen = () => {
        ws.current && (ws.current.onmessage = async(event) => {
            if (event.data instanceof ArrayBuffer) {
              playback.current?.addSamples(new Float32Array(event.data));
            } else if (event.data === CLEAR_BUFFER_TOKEN) {
              logMessage("clear buffer");
              const didInterrupt  = await playback.current?.clear();
              if (didInterrupt) {
                logMessage("sent did interrupt", didInterrupt);
                ws.current && ws.current.send(INTERRUPT_TOKEN);
              }
            } else {
              logMessage(event.data);
            }
          });
    
          logMessage("start recording", new Date());
          playback.current = new Playback(new AudioContext(AudioContextSettings));
          playback.current.start();
          streamer.current = new Streamer(ws.current!, logMessage);
          streamer.current.start();
    
          ws.current && (ws.current.onclose = () => {
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
            <h1 className="text-xl font-bold"> charlesyu108/voiceai-js-starter demo</h1>
            <p className="text-sm">For best results, use headphones.</p>
        </div>
      <div className="my-8 flex">
      {isRecording ? (
        <button onClick={() => stopRecording(false)} className="mx-auto w-1/2 bg-red-500 font-bold text-white px-4 py-2 rounded-md">Hang Up</button>
      ) : (
        <button onClick={startRecording} className="mx-auto w-1/2 bg-yellow-300 text-black font-bold px-4 py-2 rounded-md">Begin Call</button>
      )}
      </div>
      <Logs />
    </main>
  );
}

const Logs = ({ logLines, clearLogs }: { logLines: JSX.Element[], clearLogs: () => void }) => {
  
    return (
      <>
        <div className="flex w-full justify-between">
          <h1 className="text-xl font-bold mx-2 my-2"> Logs </h1>
          <button onClick={clearLogs} className=" border-yellow-300 border px-4 my-1 rounded-md"> Clear </button>
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

class Streamer {
  ws: WebSocket;
  stream: MediaStream | null = null;
  processor: ScriptProcessorNode | null = null;
  vadMic: Promise<vad.MicVAD> | null = null;
  audioContext: AudioContext | null = null;
  userIsSpeaking: boolean = false;

  constructor(ws: WebSocket, private logMessage: (...args: any[]) => void) {
    this.ws = ws;

    this.vadMic = vad.MicVAD.new({
      onSpeechStart: () => {
        logMessage("--- vad: speech start");
        this.userIsSpeaking = true;
      },
      onSpeechEnd: (audio) => {
        logMessage("--- vad: speech end");
        ws.send(END_OF_SPEECH_TOKEN);
        this.userIsSpeaking = false;
      },
    })
    this.audioContext = new AudioContext(AudioContextSettings);
  }

  async start() {
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
    (await this.vadMic!).start();

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

class Playback {
  samples: Float32Array[] = [];

  constructor(public audioContext: AudioContext) {
    this.audioContext.suspend();
    const scriptNode = this.audioContext.createScriptProcessor(1024, 1, 1);
    scriptNode.onaudioprocess = (event) => {
      if (this.samples.length > 0) {
        event.outputBuffer.getChannelData(0).set(this.samples[0]);
        this.samples.shift();
      } else {
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
