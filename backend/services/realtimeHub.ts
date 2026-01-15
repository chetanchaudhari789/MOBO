import { EventEmitter } from 'node:events';
import type { Role } from '../middleware/auth.js';

export type RealtimeEvent = {
  type: string;
  ts: string;
  payload?: any;
  audience: {
    broadcast?: boolean;
    userIds?: string[];
    roles?: Role[];
    // Deliver to a specific agency account by its agency code (stored on User.mediatorCode for role=agency).
    agencyCodes?: string[];
    // Deliver to a specific mediator account by its mediator code (stored on User.mediatorCode for role=mediator).
    mediatorCodes?: string[];
    // Deliver to a specific brand account by its brand code (stored on User.brandCode for role=brand).
    brandCodes?: string[];
    // Deliver to users that have this parentCode (e.g., shoppers with parentCode=mediatorCode).
    parentCodes?: string[];
  };
};

type Listener = (evt: RealtimeEvent) => void;

const emitter = new EventEmitter();
// Avoid MaxListeners warnings for many SSE clients.
emitter.setMaxListeners(0);

export function publishRealtime(evt: RealtimeEvent) {
  emitter.emit('event', evt);
}

export function publishBroadcast(type: string, payload?: any) {
  publishRealtime({ type, ts: new Date().toISOString(), payload, audience: { broadcast: true } });
}

export function subscribeRealtime(listener: Listener) {
  emitter.on('event', listener);
  return () => emitter.off('event', listener);
}
