
/**
 * 📡 Events Bus
 * Minimal pub-sub interface for system-wide observability.
 */
import { EventEmitter } from 'events';

export const eventsBus = new EventEmitter();
