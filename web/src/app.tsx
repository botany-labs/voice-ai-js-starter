import { useState, useRef } from "react";

const SERVER_WS_URL = process.env.SERVER_WS_URL || "ws://localhost:8000";

export default function App() {
    const [logMessage, Logs] = useLogs();
    const ws = useRef<WebSocket|null>(null);

    const stopRecording = () => {
        ws.current?.close();
        ws.current = null;
    };

    const startRecording = async () => {
        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
            ws.current = new WebSocket(SERVER_WS_URL);
            ws.current.binaryType = "arraybuffer";

            ws.current.onmessage = (event) => {

                const buffer = new Int32Array(event.data);
                // Play it out
                const audioContext = new AudioContext();
                const source = audioContext.createBufferSource();
                source.buffer = audioContext.createBuffer(2, buffer.length, 48000);
                source.buffer.getChannelData(0).set(buffer);
                // introduce latency node
                const latencyNode = audioContext.createDelay(1)
                source.connect(latencyNode);
                latencyNode.connect(audioContext.destination);
                source.start();
            };

            logMessage("start recording", new Date());

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
                ws.current?.send(event.inputBuffer.getChannelData(0))
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


