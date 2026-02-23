# Skepsi

A real time collaborative text editor. Multiple people can edit the same document at once and it stays in sync. Uses a CRDT so theres no central lock and everyone converges to the same state eventually.

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

Metrics are exposed at `GET /metrics` (Prometheus text format; append `?format=json` for JSON). Counters: `ops_processed_total`, `connections_total`, `backpressure_drops_total`. Gauges: `active_connections`, `active_rooms`, `active_peers`.

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

**Buffer sizes**: Hub incoming 1024; connection send 256; room commands 64. Backpressure drops occur when send channels are full; drops are logged and counted in `backpressure_drops_total`.

## Tech stack

- Go 1.21 (backend, CRDT engine, server)
- TypeScript (frontend CRDT, client, network layer)
- WebSockets (gorilla/websocket on the server)
- No database yet, everything is in memory

## Design notes

Ops are insert or delete. Each op has a position (list of ints), a value (rune), and deleted or not. Positions are ordered lexicographically. When two people type at the same spot we use a site bias so they get different positions and both characters show up. Deletes are tombstones we keep forever so late joiners can replay history and get the same state.

When you undo we find your last op and send the inverse (insert becomes delete, delete becomes insert at same position). The server doesnt care its just another op. Everyone applies it and the character disappears for everyone.

Sync for late join: when a new client joins they say what they know, the server (or a peer) streams them the op log, they apply it all, then they're in sync and get new ops like everyone else. The sim tests include a late join scenario with 200 ops and a new client replaying them.
