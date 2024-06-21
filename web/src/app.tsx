import { useState, useRef } from "react";
import * as vad from "@ricky0123/vad-web";
import "./app.css";

const SERVER_WS_URL = process.env.SERVER_WS_URL || "ws://localhost:8000";


const AudioContextSettings = {
    sampleRate: 16000,
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
  const streamer = useRef<Streamer | null>(null);
  const playback = useRef<Playback | null>(null);

  const stopRecording = (graceful: boolean = false) => {
    streamer.current?.stop(graceful);
    playback.current?.stop(graceful);
    ws.current?.close();
    ws.current = null;
  };

  const startRecording = async () => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      ws.current = new WebSocket(SERVER_WS_URL);
      ws.current.binaryType = "arraybuffer";

      ws.current.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          playback.current?.addSamples(new Float32Array(event.data));
        } else {
          logMessage(event.data);
        }
      };

      logMessage("start recording", new Date());
      playback.current = new Playback(new AudioContext(AudioContextSettings));
      playback.current.start();
      streamer.current = new Streamer(ws.current, logMessage);
      streamer.current.start();

      ws.current.onclose = () => {
        logMessage("websocket closed");
        stopRecording(true);
      };
    }
  };

  return (
    <>
      <h1>Demo</h1>
      <button onClick={startRecording}>Start Recording</button>
      <button onClick={() => stopRecording(false)}>Stop Recording</button>
      <Logs />
    </>
  );
}

const Logs = ({ logLines }: { logLines: JSX.Element[] }) => {
  return (
    <>
      <h1> Logs </h1>
      <div className="scrollingDisplay">
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
    return <Logs logLines={logLines} />;
  };
  return [logMessage, logDisplay] as const;
};

class Streamer {
  ws: WebSocket;
  stream: MediaStream | null = null;
  vadMic: Promise<vad.MicVAD> | null = null;
  audioContext: AudioContext | null = null;
  userIsSpeaking: boolean = false;

  constructor(ws: WebSocket, private logMessage: (...args: any[]) => void) {
    this.ws = ws;

    this.vadMic = vad.MicVAD.new({
      onSpeechStart: () => {
        logMessage("--- speech start");
        this.userIsSpeaking = true;
      },
      onSpeechEnd: (audio) => {
        logMessage("--- speech end");
        ws.send("end");
        this.userIsSpeaking = false;
      },
    })
    this.audioContext = new AudioContext(AudioContextSettings);
  }

  async start() {
    const constraints = {
      video: false,
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
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (event) => {
        if (this.ws.readyState === WebSocket.OPEN && this.userIsSpeaking) {
          this.ws.send(event.inputBuffer.getChannelData(0));
        }
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
    });
    (await this.vadMic!).start();

  }

  async stop(graceful: boolean = false) {
    this.audioContext?.close();
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = null;
    (await this.vadMic!).pause();
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
      this.audioContext.close();
    }
  }

  addSamples(samples: Float32Array) {
    this.samples.push(samples);
  }
}
