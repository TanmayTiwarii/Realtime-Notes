import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
    vus: 20, // Simulate 20 concurrent virtual users
    duration: '15s',
};

export default function () {
    // Socket.IO v4 endpoint requiring Engine.IO version 4 framing over WebSocket transport
    const url = 'ws://localhost:5000/socket.io/?EIO=4&transport=websocket';
    
    const res = ws.connect(url, {}, function (socket) {
        socket.on('open', () => {
            // Connection opened successfully
        });

        socket.on('message', (msg) => {
            // Engine.IO Handshake packet (starts with '0')
            if (msg.startsWith('0')) {
                // Send Socket.IO namespace connection request (packet type '40')
                socket.send('40');
            }
            // Socket.IO connection acknowledged (starts with '40')
            else if (msg.startsWith('40')) {
                // Join the shared testing room
                const joinPacket = '42' + JSON.stringify([
                    'join-note', 
                    'benchmark-load-room', 
                    { email: `load-tester-${__VU}@notesync.io` }
                ]);
                socket.send(joinPacket);

                // Simulate continuous vector drawing point broadcasts
                socket.setInterval(() => {
                    const strokePacket = '42' + JSON.stringify([
                        'draw-progress',
                        'benchmark-load-room',
                        {
                            id: `live-stroke-${__VU}`,
                            color: '#3b82f6',
                            strokeWidth: 4,
                            points: [{ x: Math.floor(Math.random() * 600), y: Math.floor(Math.random() * 600) }]
                        }
                    ]);
                    socket.send(strokePacket);
                }, 100); // Broadcast every 100ms per user
            }
            // Engine.IO Heartbeat Ping packet (packet type '2')
            else if (msg === '2') {
                // Respond with Heartbeat Pong (packet type '3') to keep session alive
                socket.send('3');
            }
        });

        socket.on('error', (e) => {
            if (e.error() != 'websocket: close sent') {
                console.log('An unexpected error occurred: ', e.error());
            }
        });

        socket.setTimeout(function () {
            socket.close();
        }, 14000);
    });

    check(res, { 'Connected to Socket.IO successfully': (r) => r && r.status === 101 });
}
