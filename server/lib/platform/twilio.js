const http = require("http");
const HttpDispatcher = require("httpdispatcher");
const WebSocketServer = require("websocket").server;

class TwilioCallServer {
    constructor(host, onConnect) {
        this.host = host;
        this.onConnect = onConnect;
    }

    getTwiMLDocument(wssUrl) {
        return `<?xml version="1.0" encoding="UTF-8" ?>
    <Response>
    <Connect>
        <Stream url="${wssUrl}">
        </Stream>
    </Connect>
    </Response>`;
    }

    serve(httpPort = 8080, twimlRoute = "/twiml", streamsRoute = "/stream") {
        const host = this.host;
        const dispatcher = new HttpDispatcher();

        const handleRequest = (request, response) => {
            try {
                dispatcher.dispatch(request, response);
            } catch (err) {
                console.error(err);
            }
        }
        const wsserver = http.createServer(handleRequest);
        const mediaws = new WebSocketServer({
            httpServer: wsserver,
            autoAcceptConnections: false,
        });

        mediaws.on('request', (request) => {
            if (request.resourceURL.pathname === streamsRoute) {
                request.accept();
            } else {
                request.reject();
                console.log(`Connection rejected from ${request.origin}`);
            }
        });

        mediaws.on("connect", (connection) => {
            console.log("Connected.");
            this.onConnect(connection);
        });

        dispatcher.onPost(twimlRoute, (request, response) => {
            console.log("POST to TwiML");
            response.writeHead(200, { "Content-Type": "text/xml" });
            response.end(this.getTwiMLDocument(`wss://${this.host}${streamsRoute}`));
        });

        wsserver.listen(httpPort, () => {
            console.log(`Server listening on port ${httpPort} @ ${host}`);
        });
    }
}

module.exports = {
    TwilioCallServer
};
