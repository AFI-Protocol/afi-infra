
/**
 * 🔭 Observer Daemon
 * Periodically watches agent lifecycle events and logs anomalies for further scoring.
 */
import { EventEmitter } from 'events';

export class ObserverDaemon {
  constructor(private bus: EventEmitter) {}

  start() {
    this.bus.on('signal.received', (data) => {
      console.log('[Observer] Signal received:', data);
    });

    this.bus.on('agent.error', (error) => {
      console.warn('[Observer] Agent error:', error);
    });

    console.log('[ObserverDaemon] Started and listening.');
  }
}
