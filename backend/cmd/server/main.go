package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"skepsi/backend/internal/logger"
	"skepsi/backend/internal/metrics"
	"skepsi/backend/internal/room"
	"skepsi/backend/internal/validate"
	"skepsi/backend/internal/ws"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	roomManager := room.NewManager(nil)
	hub := ws.NewHub(roomManager)
	roomManager.SetDropCallback(hub.DropClient)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go hub.Run(ctx)

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		rooms, peers := roomManager.Stats()
		metrics.SetActiveRooms(rooms)
		metrics.SetActivePeers(peers)
		metrics.Handler(w, r)
	})

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		doc := r.URL.Query().Get("doc")
		if doc != "" {
			if err := validate.DocID(doc); err != nil {
				http.Error(w, "invalid doc query parameter: "+err.Error(), http.StatusBadRequest)
				return
			}
			logger.Log.Info("ws_connect", "doc", doc)
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			logger.Log.Warn("upgrade_failed", "error", err)
			return
		}
		c := hub.Register(conn)
		go c.ReadPump(ctx, func(raw []byte) {
			hub.Incoming(c.ID, raw)
		}, func() {
			hub.Unregister(c)
		})
		go c.WritePump(ctx)
	})

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	server := &http.Server{Addr: addr, Handler: nil}

	go func() {
		logger.Log.Info("server_listening", "addr", addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Log.Error("server_error", "error", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	cancel()
	_ = server.Shutdown(context.Background())
	<-hub.Done()
	logger.Log.Info("server_stopped")
}
