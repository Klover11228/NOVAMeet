const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();

// ================================
// FIND REAL NETWORK IP
// ================================

function getNetworkIP() {
    const interfaces = os.networkInterfaces();

    const preferred = [
        "Wi-Fi",
        "Ethernet"
    ];

    // Try Wi-Fi / Ethernet first
    for (const name of preferred) {

        const addresses = interfaces[name];

        if (!addresses) {
            continue;
        }

        for (const address of addresses) {

            if (
                address.family === "IPv4" &&
                !address.internal
            ) {
                return address.address;
            }
        }
    }

    // Fallback: search all interfaces
    for (const name of Object.keys(interfaces)) {

        for (const address of interfaces[name] || []) {

            if (
                address.family === "IPv4" &&
                !address.internal
            ) {
                return address.address;
            }
        }
    }

    return "YOUR-IP";
}

const NETWORK_IP = getNetworkIP();

// ================================
// HTTPS
// ================================

const sslOptions = {
    key: fs.readFileSync(
        path.join(__dirname, "key.pem")
    ),

    cert: fs.readFileSync(
        path.join(__dirname, "cert.pem")
    )
};

// ================================
// HTTPS SERVER
// ================================

const server = https.createServer(
    sslOptions,
    (req, res) => {

        const url = new URL(
            req.url,
            `https://${req.headers.host}`
        );

        const pathname = url.pathname;

        let filePath;

        // ================================
        // PAGES
        // ================================

        // Main address -> LOGIN
        if (pathname === "/") {

            filePath = path.join(
                __dirname,
                "login.html"
            );

        // Index
        } else if (
            pathname === "/index.html"
        ) {

            filePath = path.join(
                __dirname,
                "index.html"
            );

        // Meeting
        } else if (
            pathname === "/meeting.html"
        ) {

            filePath = path.join(
                __dirname,
                "meeting.html"
            );

        // Login
        } else if (
            pathname === "/login.html"
        ) {

            filePath = path.join(
                __dirname,
                "login.html"
            );

        // 404
        } else {

            res.writeHead(
                404,
                {
                    "Content-Type":
                        "text/plain; charset=utf-8"
                }
            );

            res.end(
                "404 - Not Found"
            );

            return;
        }

        // ================================
        // READ FILE
        // ================================

        fs.readFile(
            filePath,
            (error, data) => {

                if (error) {

                    console.error(
                        "File error:",
                        error
                    );

                    res.writeHead(
                        500,
                        {
                            "Content-Type":
                                "text/plain; charset=utf-8"
                        }
                    );

                    res.end(
                        "500 - Server Error"
                    );

                    return;
                }

                res.writeHead(
                    200,
                    {
                        "Content-Type":
                            "text/html; charset=utf-8",

                        "Cache-Control":
                            "no-cache"
                    }
                );

                res.end(data);
            }
        );
    }
);

// ================================
// WEBSOCKET SERVER
// ================================

const wss = new WebSocket.Server({
    server,
    path: "/ws"
});

// ================================
// SEND
// ================================

function send(socket, data) {

    if (
        socket.readyState ===
        WebSocket.OPEN
    ) {

        socket.send(
            JSON.stringify(data)
        );
    }
}

// ================================
// BROADCAST
// ================================

function broadcast(
    room,
    data,
    exceptId = null
) {

    for (
        const [id, client]
        of room.entries()
    ) {

        if (id !== exceptId) {

            send(
                client.socket,
                data
            );
        }
    }
}

// ================================
// CLEAN ROOM CODE
// ================================

function cleanRoomCode(value) {

    return String(value || "")
        .trim()
        .toUpperCase()
        .slice(0, 32);
}

// ================================
// CLEAN NAME
// ================================

function cleanName(value) {

    const name =
        String(value || "Guest")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 30);

    return name || "Guest";
}

// ================================
// CLEAN CHAT
// ================================

function cleanChat(value) {

    return String(value || "")
        .trim()
        .slice(0, 1000);
}

// ================================
// REMOVE CLIENT
// ================================

function removeClient(client) {

    if (
        !client.roomCode ||
        !client.id
    ) {
        return;
    }

    const room =
        rooms.get(
            client.roomCode
        );

    if (!room) {
        return;
    }

    room.delete(
        client.id
    );

    // Tell everyone
    // this participant left

    broadcast(
        room,
        {
            type: "peer-left",
            id: client.id
        }
    );

    // Update participant count

    broadcast(
        room,
        {
            type: "count",
            count: room.size
        }
    );

    // Delete empty room

    if (
        room.size === 0
    ) {

        rooms.delete(
            client.roomCode
        );
    }
}

// ================================
// WEBSOCKET CONNECTION
// ================================

wss.on(
    "connection",
    (socket) => {

        const client = {

            id: crypto.randomUUID(),

            name: "Guest",

            roomCode: null,

            socket
        };

        // ================================
        // MESSAGE
        // ================================

        socket.on(
            "message",
            (rawMessage) => {

                let message;

                // ================================
                // PARSE JSON
                // ================================

                try {

                    message =
                        JSON.parse(
                            rawMessage.toString()
                        );

                } catch {

                    send(
                        socket,
                        {
                            type: "error",
                            message:
                                "Invalid message."
                        }
                    );

                    return;
                }

                if (
                    !message ||
                    typeof message.type !==
                        "string"
                ) {
                    return;
                }

                // ================================
                // JOIN ROOM
                // ================================

                if (
                    message.type === "join"
                ) {

                    if (
                        client.roomCode
                    ) {
                        return;
                    }

                    const roomCode =
                        cleanRoomCode(
                            message.roomCode
                        );

                    const name =
                        cleanName(
                            message.name
                        );

                    if (!roomCode) {

                        send(
                            socket,
                            {
                                type: "error",
                                message:
                                    "Room code is required."
                            }
                        );

                        return;
                    }

                    client.roomCode =
                        roomCode;

                    client.name =
                        name;

                    // Create room

                    if (
                        !rooms.has(roomCode)
                    ) {

                        rooms.set(
                            roomCode,
                            new Map()
                        );
                    }

                    const room =
                        rooms.get(
                            roomCode
                        );

                    // Existing participants

                    const existingPeers =
                        [];

                    for (
                        const [id, peer]
                        of room.entries()
                    ) {

                        existingPeers.push(
                            {
                                id,

                                name:
                                    peer.name
                            }
                        );
                    }

                    // Add participant

                    room.set(
                        client.id,
                        client
                    );

                    // Tell new participant

                    send(
                        socket,
                        {
                            type: "joined",

                            selfId:
                                client.id,

                            roomCode,

                            peers:
                                existingPeers
                        }
                    );

                    // Tell existing participants

                    broadcast(
                        room,
                        {
                            type:
                                "peer-joined",

                            peer: {

                                id:
                                    client.id,

                                name:
                                    client.name
                            }
                        },

                        client.id
                    );

                    // Update count

                    broadcast(
                        room,
                        {
                            type:
                                "count",

                            count:
                                room.size
                        }
                    );

                    return;
                }

                // ================================
                // MUST JOIN ROOM
                // ================================

                if (
                    !client.roomCode
                ) {

                    send(
                        socket,
                        {
                            type: "error",

                            message:
                                "Join a room first."
                        }
                    );

                    return;
                }

                const room =
                    rooms.get(
                        client.roomCode
                    );

                if (!room) {
                    return;
                }

                // ================================
                // OFFER
                // ================================

                if (
                    message.type ===
                    "offer"
                ) {

                    const target =
                        room.get(
                            message.target
                        );

                    if (!target) {
                        return;
                    }

                    send(
                        target.socket,
                        {
                            type: "offer",

                            from:
                                client.id,

                            name:
                                client.name,

                            offer:
                                message.offer
                        }
                    );

                    return;
                }

                // ================================
                // ANSWER
                // ================================

                if (
                    message.type ===
                    "answer"
                ) {

                    const target =
                        room.get(
                            message.target
                        );

                    if (!target) {
                        return;
                    }

                    send(
                        target.socket,
                        {
                            type: "answer",

                            from:
                                client.id,

                            answer:
                                message.answer
                        }
                    );

                    return;
                }

                // ================================
                // ICE
                // ================================

                if (
                    message.type ===
                    "ice"
                ) {

                    const target =
                        room.get(
                            message.target
                        );

                    if (!target) {
                        return;
                    }

                    send(
                        target.socket,
                        {
                            type: "ice",

                            from:
                                client.id,

                            candidate:
                                message.candidate
                        }
                    );

                    return;
                }

                // ================================
                // CHAT
                // ================================

                if (
                    message.type ===
                    "chat"
                ) {

                    const text =
                        cleanChat(
                            message.text
                        );

                    if (!text) {
                        return;
                    }

                    broadcast(
                        room,
                        {
                            type: "chat",

                            id:
                                crypto.randomUUID(),

                            senderId:
                                client.id,

                            name:
                                client.name,

                            text,

                            time:
                                Date.now()
                        }
                    );

                    return;
                }

                // ================================
                // LEAVE
                // ================================

                if (
                    message.type ===
                    "leave"
                ) {

                    removeClient(
                        client
                    );

                    client.roomCode =
                        null;
                }
            }
        );

        // ================================
        // CLOSE
        // ================================

        socket.on(
            "close",
            () => {

                removeClient(
                    client
                );
            }
        );

        // ================================
        // ERROR
        // ================================

        socket.on(
            "error",
            (error) => {

                console.error(
                    "WebSocket error:",
                    error.message
                );

                removeClient(
                    client
                );
            }
        );
    }
);

// ================================
// START SERVER
// ================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "================================="
        );
        console.log(
            "          NOVAMeet HTTPS"
        );
        console.log(
            "================================="
        );
        console.log("");

        console.log(
            `Local:   https://localhost:${PORT}`
        );

        console.log(
            `Network: https://${NETWORK_IP}:${PORT}`
        );

        console.log("");

        console.log(
            "Pages:"
        );

        console.log(
            `Login:   https://localhost:${PORT}/login.html`
        );

        console.log(
            `Index:   https://localhost:${PORT}/index.html`
        );

        console.log(
            `Meeting: https://localhost:${PORT}/meeting.html`
        );

        console.log("");

        console.log(
            `Network Login:   https://${NETWORK_IP}:${PORT}/login.html`
        );

        console.log(
            `Network Meeting: https://${NETWORK_IP}:${PORT}/meeting.html`
        );

        console.log("");

        console.log(
            "WebSocket: wss://.../ws"
        );

        console.log("");

        console.log(
            "Server is running..."
        );

        console.log("");
    }
);