# Skepsi

Optimized for unreliable campus networks. Edit offline, sync when you're back.

A real time collaborative text editor. Multiple people can edit the same document at once and it stays in sync. Uses a CRDT so theres no central lock and everyone converges to the same state eventually.

**For students:** Campus WiFi in lecture halls, dorms, and libraries is often slow or drops. Skepsi lets you edit fully offline. Your changes are queued locally and sync automatically when you're back online. No lost edits. CRDTs merge conflict free so everyone converges to the same doc. No signup; share a link and collaborate.

Backend is Go, frontend is TypeScript. They talk over WebSockets. The document is a position based list CRDT (variable length integer paths, lexicographic order). Undo is done by sending an inverse op so when you undo your insert it becomes a delete that gets broadcast to everyone.

## What's in the repo

- **backend**  
  Go server that runs the WebSocket hub and room manager. Clients connect to `/ws`, join a doc, and the server just forwards ops. It doesnt store the document, clients do. The CRDT engine lives here too so we could run it server side if we wanted.

- **frontend**  
  TypeScript CRDT engine (mirrors the Go one), editor state, and the client that talks to the server. Handles insert, delete, undo, and sync when someone joins late.

- **client**  
  Package that exports the network and types so another app can use it. The actual UI would import from here or from frontend.

- **app**  
  Minimal React UI. One document, Undo/Redo, connection status. Connects to the backend WebSocket. Built with Vite.

- **backend/crdt/sim**  
  Simulation tests. No browser, no network. We fake N clients and a chaotic network (reorder, duplicate, delay) and check that every replica ends up with the same document string. Proves convergence and that undo and late join work.

## How to run the server

From the backend directory:

```bash
cd backend
go run ./cmd/server
```

It listens on port 8080 by default. Set `PORT` if you need something else (e.g. `PORT=3000 go run ./cmd/server`). The server only exposes the WebSocket endpoint, it doesnt serve any HTML or static files. Run the app (see below) and it will connect to `ws://localhost:8080/ws`.

## How to run the app

Start the backend first, then from the app directory:

```bash
cd app
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173). Open a second tab or window to the same URL to see two clients editing the same doc. Set `VITE_WS_URL` if your server is not on localhost:8080.

## Scaling: multiple WebSocket servers

You can run multiple backend instances behind a load balancer. Clients include the document id in the WebSocket URL (`ws://host/ws?doc=<docId>`), so the load balancer can route by document and send all peers for the same document to the same backend.

- **Routing**: Configure the load balancer to hash on the `doc` query parameter so that all connections for the same document hit the same backend. Reconnects use the same `doc` in the URL (the app reuses the same doc id), so they land on the same server.
- **Nginx**: Use `hash $arg_doc consistent;` when proxying to an `upstream` of WebSocket backends.
- **HAProxy**: Use a stick-table or similar mechanism keyed by the `doc` query parameter so that the same doc always goes to the same server.

No Redis or shared store is required; each backend keeps its rooms in memory. If a backend goes down, only the documents (and connections) on that backend are affected.

## How to run the tests

Backend unit tests and CRDT convergence tests:

```bash
cd backend
go test ./...
```

Just the simulation (chaos network, concurrent inserts, same position insert, undo collision, late join, offline editing):

```bash
cd backend
go test ./crdt/sim/ -v
```

We use a fixed random seed so the chaos is deterministic and the tests are reproducible.

## Performance

Metrics are exposed at `GET /metrics` (Prometheus text format; append `?format=json` for JSON). Counters: `ops_processed_total`, `connections_total`, `backpressure_drops_total`, `send_skips_total`. Gauges: `active_connections`, `active_rooms`, `active_peers`.

Metrics only update when traffic hits the running server. The load test uses an in-process test server by default, so it does not affect `localhost:8080`. To populate metrics on a running server: start the server, then either run the app and edit, or run the load test against it:

```bash
# Terminal 1
cd backend && go run ./cmd/server

# Terminal 2 (hits localhost:8080, populates metrics)
LOAD_TARGET=ws://localhost:8080/ws go test ./load/ -bench=. -benchtime=5s

# Then curl metrics
curl http://localhost:8080/metrics
```

**Load test** (single client, 200 insert ops per connection):

```bash
cd backend
go test ./load/ -bench=. -benchtime=5s
```

Typical result: **~130–140k ops/sec** (connect → join → send 200 ops → disconnect, repeated).

**Simulation benchmarks** (chaos network: shuffle, 20% duplicate prob, delay):

```bash
cd backend
go test ./crdt/sim/ -bench=BenchmarkConvergence -benchtime=3s
```

- **10 clients, 1000 ops**: ~2.5s convergence, ~4k ops delivered/sec
- **20 clients, 500 ops**: ~500ms convergence, ~20k ops delivered/sec

**Chaos scenarios** (reorder, duplicate, late join, offline editing) are covered in `go test ./crdt/sim/ -v`.

**Buffer sizes**: Hub incoming 2048; connection send 2048; manager commands 512; room commands 256. Clients are dropped only after 5 consecutive send failures (buffer full), so brief network hiccups do not disconnect. Send skips (when buffer is full but we don't drop yet) are counted in `send_skips_total`. Backpressure drops (when command channels are full) are logged and counted in `backpressure_drops_total`.

**400-connection test** (validates scale for large lectures):

```bash
cd backend
go test ./load/ -run Test400ConcurrentConnections -v
```

Skipped in short mode (`go test -short`). May require higher `ulimit` for 400 sockets on some systems.

## Tech stack

- Go 1.21 (backend, CRDT engine, server)
- TypeScript (frontend CRDT, client, network layer)
- WebSockets (gorilla/websocket on the server)
- No database yet, everything is in memory

## Design notes

Ops are insert or delete. Each op has a position (list of ints), a value (rune), and deleted or not. Positions are ordered lexicographically. When two people type at the same spot we use a site bias so they get different positions and both characters show up. Deletes are tombstones we keep forever so late joiners can replay history and get the same state.

When you undo we find your last op and send the inverse (insert becomes delete, delete becomes insert at same position). The server doesnt care its just another op. Everyone applies it and the character disappears for everyone.

Sync for late join: when a new client joins they say what they know, the server (or a peer) streams them the op log, they apply it all, then they're in sync and get new ops like everyone else. The sim tests include a late join scenario with 200 ops and a new client replaying them.
