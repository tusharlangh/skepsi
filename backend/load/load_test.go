package load

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync/atomic"
	"testing"

	"skepsi/backend/internal/room"
	"skepsi/backend/internal/ws"

	"github.com/gorilla/websocket"
)

func runTestServer(tb testing.TB) *httptest.Server {
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

	return httptest.NewServer(mux)
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
		server := runTestServer(b)
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
