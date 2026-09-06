import { io } from 'socket.io-client';
import { getToken } from './api.js';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io({ auth: { token: getToken() }, autoConnect: false });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  s.auth = { token: getToken() };
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
