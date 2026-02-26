package load

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"skepsi/backend/internal/metrics"
	"skepsi/backend/internal/room"
	"skepsi/backend/internal/ws"

	"github.com/gorilla/websocket"
)

func runTestServer(tb testing.TB) (*httptest.Server, *room.Manager) {
	tb.Helper()
	roomManager := room.NewManager(nil)
	hub := ws.NewHub(roomManager)
	roomManager.SetDropCallback(hub.DropClient)
	go hub.Run(context.Background())

	var upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(*http.Request) bool { return true },
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		c := hub.Register(conn)
		go c.ReadPump(context.Background(), func(raw []byte) {
			hub.Incoming(c.ID, raw)
		}, func() {
			hub.Unregister(c)
		})
		go c.WritePump(context.Background())
	})

	return httptest.NewServer(mux), roomManager
}

type insertPayload struct {
	Position []int  `json:"position"`
	Value    string `json:"value"`
}

func sendInsert(conn *websocket.Conn, docId, siteId string, counter int, position []int, value string) error {
	op := map[string]interface{}{
		"type":    "insert",
		"docId":   docId,
		"siteId":  siteId,
		"opId":    map[string]interface{}{"site": siteId, "counter": counter},
		"payload": insertPayload{Position: position, Value: value},
		"timestamp": 0,
	}
	data, _ := json.Marshal(op)
	return conn.WriteMessage(websocket.TextMessage, data)
}

func sendJoin(conn *websocket.Conn, docId, siteId string) error {
	join := map[string]interface{}{
		"type":       "join",
		"docId":      docId,
		"siteId":     siteId,
		"knownClock": 0,
	}
	data, _ := json.Marshal(join)
	return conn.WriteMessage(websocket.TextMessage, data)
}

func BenchmarkLoad(b *testing.B) {
	var wsURL string
	if target := os.Getenv("LOAD_TARGET"); target != "" {
		wsURL = target
	} else {
		server, _ := runTestServer(b)
		defer server.Close()
		wsURL = "ws" + server.URL[4:] + "/ws"
	}

	docId := "load-doc"
	opsPerClient := 200

	for _, n := range []int{1} {
		n := n
		b.Run(strconv.Itoa(n)+"_client", func(b *testing.B) {
			var totalSent atomic.Uint64
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				for c := 0; c < n; c++ {
					conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
					if err != nil {
						b.Fatal(err)
					}
					siteId := "load-" + strconv.Itoa(i) + "-" + strconv.Itoa(c)
					if err := sendJoin(conn, docId, siteId); err != nil {
						conn.Close()
						b.Fatal(err)
					}
					posBase := 32768 + (i*n+c)%30000
					for j := 0; j < opsPerClient; j++ {
						pos := []int{posBase, j}
						if err := sendInsert(conn, docId, siteId, j, pos, "x"); err != nil {
							conn.Close()
							b.Fatal(err)
						}
						totalSent.Add(1)
					}
					conn.Close()
				}
			}
			b.ReportMetric(float64(totalSent.Load())/b.Elapsed().Seconds(), "ops/sec")
		})
	}
}

func Test400ConcurrentConnections(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 400-connection test in short mode")
	}

	server, roomManager := runTestServer(t)
	defer server.Close()
	wsURL := "ws" + server.URL[4:] + "/ws"

	const numClients = 400
	const activeSenders = 20
	const opsPerSender = 10

	docId := "scale-doc"
	var conns []*websocket.Conn
	var connsMu sync.Mutex
	var wg sync.WaitGroup
	var connectErr error
	var connectErrMu sync.Mutex

	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
			if err != nil {
				connectErrMu.Lock()
				if connectErr == nil {
					connectErr = err
				}
				connectErrMu.Unlock()
				return
			}
			siteId := "scale-" + strconv.Itoa(idx)
			if err := sendJoin(conn, docId, siteId); err != nil {
				conn.Close()
				connectErrMu.Lock()
				if connectErr == nil {
					connectErr = err
				}
				connectErrMu.Unlock()
				return
			}
			connsMu.Lock()
			conns = append(conns, conn)
			connsMu.Unlock()
		}(i)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("timeout waiting for 400 connections")
	}

	if connectErr != nil {
		t.Fatalf("connection error: %v", connectErr)
	}

	if len(conns) != numClients {
		t.Fatalf("expected %d connections, got %d", numClients, len(conns))
	}

	// Wait for room to process all joins (async)
	var peers uint64
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		_, peers = roomManager.Stats()
		if peers == numClients {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if peers != numClients {
		t.Errorf("room stats: expected %d peers, got %d (after waiting)", numClients, peers)
	}

	for i := 0; i < activeSenders; i++ {
		conn := conns[i]
		siteId := "scale-" + strconv.Itoa(i)
		posBase := 32768 + i*100
		for j := 0; j < opsPerSender; j++ {
			pos := []int{posBase, j}
			if err := sendInsert(conn, docId, siteId, j, pos, "x"); err != nil {
				t.Errorf("send insert: %v", err)
				break
			}
		}
	}

	time.Sleep(500 * time.Millisecond)

	_, peersAfter := roomManager.Stats()
	if peersAfter < numClients {
		t.Errorf("peers dropped: had %d, now %d (send_skips=%d)", numClients, peersAfter, metrics.SendSkipsTotal.Load())
	}

	for _, conn := range conns {
		conn.Close()
	}
}

// Test400ConcurrentConnectionsAllTyping stress-tests 400 clients in the same doc
// with all 400 sending ops concurrently (everyone typing at once).
func Test400ConcurrentConnectionsAllTyping(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping 400-connection stress test in short mode")
	}

	server, roomManager := runTestServer(t)
	defer server.Close()
	wsURL := "ws" + server.URL[4:] + "/ws"

	const numClients = 400
	const opsPerClient = 10

	docId := "stress-doc"
	var conns []*websocket.Conn
	var connsMu sync.Mutex
	var wg sync.WaitGroup
	var connectErr error
	var connectErrMu sync.Mutex

	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
			if err != nil {
				connectErrMu.Lock()
				if connectErr == nil {
					connectErr = err
				}
				connectErrMu.Unlock()
				return
			}
			siteId := "stress-" + strconv.Itoa(idx)
			if err := sendJoin(conn, docId, siteId); err != nil {
				conn.Close()
				connectErrMu.Lock()
				if connectErr == nil {
					connectErr = err
				}
				connectErrMu.Unlock()
				return
			}
			connsMu.Lock()
			conns = append(conns, conn)
			connsMu.Unlock()
		}(i)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("timeout waiting for 400 connections")
	}

	if connectErr != nil {
		t.Fatalf("connection error: %v", connectErr)
	}

	if len(conns) != numClients {
		t.Fatalf("expected %d connections, got %d", numClients, len(conns))
	}

	// Wait for room to process all joins
	var peers uint64
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		_, peers = roomManager.Stats()
		if peers == numClients {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if peers != numClients {
		t.Fatalf("room stats: expected %d peers, got %d (after waiting)", numClients, peers)
	}

	// All 400 clients send ops concurrently (everyone typing)
	var sendWg sync.WaitGroup
	var sendErrCount atomic.Int32
	for i := 0; i < numClients; i++ {
		sendWg.Add(1)
		go func(idx int) {
			defer sendWg.Done()
			connsMu.Lock()
			conn := conns[idx]
			connsMu.Unlock()
			siteId := "stress-" + strconv.Itoa(idx)
			posBase := 32768 + idx*100
			for j := 0; j < opsPerClient; j++ {
				pos := []int{posBase, j}
				if err := sendInsert(conn, docId, siteId, j, pos, "x"); err != nil {
					sendErrCount.Add(1)
					break
				}
			}
		}(i)
	}

	sendWg.Wait()

	if n := sendErrCount.Load(); n > 0 {
		t.Errorf("send errors: %d clients had at least one send failure", n)
	}

	// Allow time for server to process and broadcast (400 * 10 = 4000 ops, each to 399 peers)
	time.Sleep(3 * time.Second)

	_, peersAfter := roomManager.Stats()
	if peersAfter < numClients {
		t.Errorf("peers dropped under stress: had %d, now %d (send_skips=%d backpressure_drops=%d)",
			numClients, peersAfter, metrics.SendSkipsTotal.Load(), metrics.BackpressureDropsTotal.Load())
	}

	t.Logf("stress result: %d peers remaining, send_skips=%d, backpressure_drops=%d",
		peersAfter, metrics.SendSkipsTotal.Load(), metrics.BackpressureDropsTotal.Load())

	for _, conn := range conns {
		conn.Close()
	}
}
