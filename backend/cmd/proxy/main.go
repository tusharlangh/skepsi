package main

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"skepsi/backend/internal/router"
	"skepsi/backend/internal/validate"

	"github.com/gorilla/websocket"
)

const (
	healthCheckInterval = 8 * time.Second
	healthCheckTimeout  = 2 * time.Second
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func main() {
	backendsEnv := os.Getenv("WS_BACKENDS")
	if backendsEnv == "" {
		slog.Error("WS_BACKENDS is required (comma-separated backend URLs, e.g. http://localhost:8081,http://localhost:8082)")
		os.Exit(1)
	}
	allBackends := strings.Split(backendsEnv, ",")
	for i := range allBackends {
		allBackends[i] = strings.TrimSpace(allBackends[i])
	}
	if len(allBackends) == 0 {
		slog.Error("WS_BACKENDS must contain at least one backend URL")
		os.Exit(1)
	}

	sel := router.NewSelector(allBackends)
	var healthyMu sync.RWMutex
	healthyBackends := make([]string, len(allBackends))
	copy(healthyBackends, allBackends)

	// Health check loop: periodically GET each backend /health, update healthy set and selector.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runHealthChecks(ctx, allBackends, sel, &healthyMu, &healthyBackends)

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		doc := r.URL.Query().Get("doc")
		if err := validate.DocID(doc); err != nil {
			http.Error(w, "invalid or missing doc query parameter: "+err.Error(), http.StatusBadRequest)
			return
		}
		base := sel.Backend(doc)
		if base == "" {
			http.Error(w, "no backends", http.StatusServiceUnavailable)
			return
		}
		backendWSURL := baseToWS(base) + r.URL.Path
		if r.URL.RawQuery != "" {
			backendWSURL += "?" + r.URL.RawQuery
		}

		clientConn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Warn("proxy upgrade failed", "error", err)
			return
		}
		defer clientConn.Close()

		backendConn, _, err := websocket.DefaultDialer.Dial(backendWSURL, nil)
		if err != nil {
			// Retry once with another healthy backend for this doc (failover when primary is dead).
			healthyMu.RLock()
			others := make([]string, 0, len(healthyBackends))
			for _, b := range healthyBackends {
				if b != base {
					others = append(others, b)
				}
			}
			healthyMu.RUnlock()
			for _, other := range others {
				retryURL := baseToWS(other) + r.URL.Path
				if r.URL.RawQuery != "" {
					retryURL += "?" + r.URL.RawQuery
				}
				var retryErr error
				backendConn, _, retryErr = websocket.DefaultDialer.Dial(retryURL, nil)
				if retryErr == nil {
					err = nil
					slog.Info("proxy dial retry succeeded", "doc", doc, "backend", other)
					break
				}
			}
		}
		if err != nil {
			slog.Warn("proxy dial backend failed", "url", backendWSURL, "error", err)
			_ = clientConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "backend unavailable"))
			return
		}
		defer backendConn.Close()

		// Copy client -> backend
		go func() {
			for {
				mt, msg, err := clientConn.ReadMessage()
				if err != nil {
					return
				}
				if err := backendConn.WriteMessage(mt, msg); err != nil {
					return
				}
			}
		}()
		// Copy backend -> client
		for {
			mt, msg, err := backendConn.ReadMessage()
			if err != nil {
				return
			}
			if err := clientConn.WriteMessage(mt, msg); err != nil {
				return
			}
		}
	})

	server := &http.Server{Addr: addr, Handler: nil}
	go func() {
		slog.Info("proxy listening", "addr", addr, "backends", allBackends)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("proxy error", "error", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	slog.Info("proxy shutting down")
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("proxy shutdown error", "error", err)
	}
	slog.Info("proxy stopped")
}

// runHealthChecks GETs each backend's /health every healthCheckInterval, updates
// healthyBackends and the selector so only live backends are used for routing.
func runHealthChecks(ctx context.Context, allBackends []string, sel *router.Selector, healthyMu *sync.RWMutex, healthyBackends *[]string) {
	client := &http.Client{Timeout: healthCheckTimeout}
	ticker := time.NewTicker(healthCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var healthy []string
			for _, base := range allBackends {
				u := base + "/health"
				resp, err := client.Get(u)
				if err != nil {
					slog.Debug("health check failed", "backend", base, "error", err)
					continue
				}
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					healthy = append(healthy, base)
				}
			}
			if len(healthy) == 0 {
				healthy = nil
			}
			sel.SetBackends(healthy)
			healthyMu.Lock()
			*healthyBackends = healthy
			healthyMu.Unlock()
		}
	}
}

// baseToWS converts http://host or https://host to ws://host or wss://host.
func baseToWS(base string) string {
	u, err := url.Parse(base)
	if err != nil {
		return strings.Replace(base, "https://", "wss://", 1)
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	default:
		u.Scheme = "ws"
	}
	u.Path = ""
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}
