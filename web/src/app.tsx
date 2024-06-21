import { useState, useRef } from "react";

const SERVER_WS_URL = process.env.SERVER_WS_URL || "ws://localhost:8000";

export default function App() {
    const [logMessage, Logs] = useLogs();
    const ws = useRef<WebSocket|null>(null);
    const playback = useRef<Playback|null>(new Playback(new AudioContext()));

    const stopRecording = () => {
        playback.current?.stop();
        ws.current?.close();
        ws.current = null;
    };

    const startRecording = async () => {
        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
            ws.current = new WebSocket(SERVER_WS_URL);
            ws.current.binaryType = "arraybuffer";

            ws.current.onmessage = (event) => {
                playback.current?.addSamples(new Float32Array(event.data));
            };

            logMessage("start recording", new Date());
            playback.current?.start();

            // Use navigator to get user media audio
            const constraints = {
                video: false,
                audio: true,
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const audioContext = new AudioContext();
            logMessage("audio context sample rate", audioContext.sampleRate);
            const source = audioContext.createMediaStreamSource(stream);
            logMessage("media stream source created");
            const processor = audioContext.createScriptProcessor(1024, 1, 1);
            processor.onaudioprocess = (event) => {
                if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                    ws.current.send(event.inputBuffer.getChannelData(0));
                }
            };
            source.connect(processor);
            processor.connect(audioContext.destination);
        }
    };

    return <>
    <h1>Demo</h1>
    <button onClick={startRecording}>Start Recording</button>
    <button onClick={stopRecording}>Stop Recording</button>
    <Logs />
    </>
}

const Logs = ({logLines}: {logLines: string[]}) => {
    return <>
    <h1> Logs </h1>
    <div>
            {logLines.map((line, index) => <p key={index}>{line}</p>)}
        </div>
    </>;
};

const useLogs = () => {
    const [logs, setLogs] = useState<string[]>([]);
    const logsRef = useRef<string[]>([]);

    const logMessage = (...args: any[]) => {
        logsRef.current.push(args.join(" "));
        setLogs([...logsRef.current]);
    };

    const logDisplay = () => {
        return <Logs logLines={logs} />;
    };
    return [logMessage, logDisplay] as const;
};



class Playback {

    samples: Float32Array[] = [];

    constructor(private audioContext: AudioContext) {
        audioContext.suspend();
        const scriptNode = audioContext.createScriptProcessor(1024, 1, 1);
        scriptNode.onaudioprocess = (event) => {

            if (this.samples.length > 0) {
                event.outputBuffer.getChannelData(0).set(this.samples[0]);
                this.samples.shift();
            } else {
                const silence = new Float32Array(1024);
                event.outputBuffer.getChannelData(0).set(silence);
            }
        };

        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0.5;
        scriptNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
    }


    start() {
        this.audioContext.resume();
    }

    stop() {
        this.audioContext.suspend();
    }

    addSamples(samples: Float32Array) {
        this.samples.push(samples);
    }
}

