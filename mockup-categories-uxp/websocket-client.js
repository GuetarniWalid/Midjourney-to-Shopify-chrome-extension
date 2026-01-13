/****************************************************************/
/*                    WEBSOCKET CLIENT                          */
/****************************************************************/

/**
 * WebSocket Client for UXP Plugin
 * Connects to Node.js server and handles job messages
 */

class WebSocketClient {
  constructor(options) {
    this.options = options;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.isManualDisconnect = false;
  }

  connect() {
    console.log('[WebSocketClient] connect() called');
    console.log('[WebSocketClient] Current state:', this.ws ? this.ws.readyState : 'no socket');

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.log('warning', 'Already connected to WebSocket server');
      return;
    }

    this.isManualDisconnect = false;
    this.log('info', `Connecting to ${this.options.url}...`);
    console.log('[WebSocketClient] Attempting to connect to:', this.options.url);

    try {
      console.log('[WebSocketClient] Creating new WebSocket...');
      this.ws = new WebSocket(this.options.url);
      console.log('[WebSocketClient] WebSocket created:', this.ws);
      console.log('[WebSocketClient] WebSocket readyState:', this.ws.readyState);

      this.ws.onopen = () => {
        console.log('[WebSocketClient] onopen fired!');
        this.reconnectAttempts = 0;
        this.log('success', 'Connected to WebSocket server');
        if (this.options.onConnect) {
          this.options.onConnect();
        }
      };

      this.ws.onmessage = (event) => {
        console.log('[WebSocketClient] onmessage fired:', event);
        try {
          const message = JSON.parse(event.data);
          this.log('info', `Received: ${message.type}`);
          if (this.options.onMessage) {
            this.options.onMessage(message);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.log('error', `Failed to parse message: ${errorMessage}`);
        }
      };

      this.ws.onerror = (event) => {
        console.error('[WebSocketClient] onerror fired:', event);
        const error = new Error('WebSocket error occurred');
        this.log('error', error.message);
        if (this.options.onError) {
          this.options.onError(error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[WebSocketClient] onclose fired:', event);
        this.log('warning', 'Disconnected from WebSocket server');
        if (this.options.onDisconnect) {
          this.options.onDisconnect();
        }

        // Auto-reconnect if not manually disconnected
        if (!this.isManualDisconnect) {
          this.attemptReconnect();
        }
      };

      console.log('[WebSocketClient] Event handlers attached');
    } catch (error) {
      console.error('[WebSocketClient] Exception in connect():', error);
      const err = error instanceof Error ? error : new Error(String(error));
      this.log('error', `Failed to connect: ${err.message}`);
      if (this.options.onError) {
        this.options.onError(err);
      }
    }
  }

  disconnect() {
    this.isManualDisconnect = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.log('info', 'Manually disconnected');
    }
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('error', 'Cannot send message: Not connected');
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
      this.log('info', `Sent: ${message.type}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `Failed to send message: ${errorMessage}`);
    }
  }

  isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('error', 'Max reconnection attempts reached. Please reconnect manually.');
      return;
    }

    this.reconnectAttempts++;
    this.log(
      'warning',
      `Reconnecting in ${this.reconnectDelay / 1000}s... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  log(level, message) {
    if (this.options.onLog) {
      this.options.onLog(level, message);
    }
  }
}
