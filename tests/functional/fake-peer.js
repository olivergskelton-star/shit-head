(() => {
  const CHANNEL = 'shithead-playwright-peer-v1';
  let sequence = 0;

  class Emitter {
    constructor() { this.handlers = new Map(); }
    on(name, callback) {
      if (!this.handlers.has(name)) this.handlers.set(name, []);
      this.handlers.get(name).push(callback);
      return this;
    }
    emit(name, ...args) {
      for (const callback of [...(this.handlers.get(name) || [])]) callback(...args);
    }
  }

  class FakeDataConnection extends Emitter {
    constructor(peer, remotePeer, connectionId) {
      super();
      this.peerOwner = peer;
      this.peer = remotePeer;
      this.connectionId = connectionId;
      this.open = false;
      this.closed = false;
    }

    send(payload) {
      if (!this.open || this.closed) return;
      this.peerOwner.channel.postMessage({
        type: 'data',
        from: this.peerOwner.id,
        to: this.peer,
        connectionId: this.connectionId,
        payload,
      });
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.open = false;
      this.peerOwner.channel.postMessage({
        type: 'close-connection',
        from: this.peerOwner.id,
        to: this.peer,
        connectionId: this.connectionId,
      });
      this.emit('close');
    }
  }

  class Peer extends Emitter {
    constructor(id) {
      super();
      this.id = id || `fake-peer-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2, 8)}`;
      this.destroyed = false;
      this.connections = new Map();
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.addEventListener('message', (event) => this.receive(event.data));
      setTimeout(() => {
        if (!this.destroyed) this.emit('open', this.id);
      }, 0);
    }

    connect(remotePeer) {
      const connectionId = `${this.id}->${remotePeer}-${Date.now()}-${++sequence}`;
      const connection = new FakeDataConnection(this, remotePeer, connectionId);
      this.connections.set(connectionId, connection);
      setTimeout(() => {
        if (!this.destroyed) {
          this.channel.postMessage({
            type: 'connect',
            from: this.id,
            to: remotePeer,
            connectionId,
          });
        }
      }, 0);
      return connection;
    }

    receive(message) {
      if (this.destroyed || !message || message.to !== this.id) return;

      if (message.type === 'connect') {
        const connection = new FakeDataConnection(this, message.from, message.connectionId);
        connection.open = true;
        this.connections.set(message.connectionId, connection);
        this.emit('connection', connection);
        setTimeout(() => {
          if (!this.destroyed) {
            this.channel.postMessage({
              type: 'accepted',
              from: this.id,
              to: message.from,
              connectionId: message.connectionId,
            });
          }
        }, 0);
        return;
      }

      const connection = this.connections.get(message.connectionId);
      if (!connection) return;

      if (message.type === 'accepted') {
        connection.open = true;
        connection.emit('open');
        return;
      }

      if (message.type === 'data') {
        connection.emit('data', message.payload);
        return;
      }

      if (message.type === 'close-connection') {
        connection.open = false;
        connection.closed = true;
        connection.emit('close');
        this.connections.delete(message.connectionId);
      }
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const connection of [...this.connections.values()]) {
        if (!connection.closed) connection.close();
      }
      this.connections.clear();
      this.channel.close();
      this.emit('close');
    }
  }

  window.Peer = Peer;
})();
