import { io } from 'socket.io-client';
import { SERVER_URL } from './config';

export const connect = (token) => io(SERVER_URL, { auth: { token }, transports: ['websocket'] });
