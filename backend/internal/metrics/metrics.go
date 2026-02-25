package metrics

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync/atomic"
)

var (
	OpsProcessedTotal      atomic.Uint64
	ConnectionsTotal       atomic.Uint64
	BackpressureDropsTotal atomic.Uint64
	SendSkipsTotal         atomic.Uint64
	ActiveConnections      atomic.Uint64
	ActiveRooms            atomic.Uint64
	ActivePeers            atomic.Uint64
)

func IncOpsProcessed()        { OpsProcessedTotal.Add(1) }
func IncConnections()         { ConnectionsTotal.Add(1) }
func IncBackpressure()        { BackpressureDropsTotal.Add(1) }
func IncSendSkips()           { SendSkipsTotal.Add(1) }
func DecActiveConns()         { ActiveConnections.Add(^uint64(0)) }
func SetActiveConns(n uint64) { ActiveConnections.Store(n) }
func SetActiveRooms(n uint64) { ActiveRooms.Store(n) }
func SetActivePeers(n uint64) { ActivePeers.Store(n) }

func Handler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("format") == "json" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ops_processed_total":      OpsProcessedTotal.Load(),
			"connections_total":        ConnectionsTotal.Load(),
			"backpressure_drops_total": BackpressureDropsTotal.Load(),
			"send_skips_total":         SendSkipsTotal.Load(),
			"active_connections":       ActiveConnections.Load(),
			"active_rooms":             ActiveRooms.Load(),
			"active_peers":             ActivePeers.Load(),
		})
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte("skepsi_ops_processed_total counter\n"))
	w.Write([]byte("skepsi_ops_processed_total " + strconv.FormatUint(OpsProcessedTotal.Load(), 10) + "\n"))
	w.Write([]byte("skepsi_connections_total counter\n"))
	w.Write([]byte("skepsi_connections_total " + strconv.FormatUint(ConnectionsTotal.Load(), 10) + "\n"))
	w.Write([]byte("skepsi_backpressure_drops_total counter\n"))
	w.Write([]byte("skepsi_backpressure_drops_total " + strconv.FormatUint(BackpressureDropsTotal.Load(), 10) + "\n"))
	w.Write([]byte("skepsi_send_skips_total counter\n"))
	w.Write([]byte("skepsi_send_skips_total " + strconv.FormatUint(SendSkipsTotal.Load(), 10) + "\n"))
	w.Write([]byte("skepsi_active_rooms gauge\n"))
	w.Write([]byte("skepsi_active_rooms " + strconv.FormatUint(ActiveRooms.Load(), 10) + "\n"))
	w.Write([]byte("skepsi_active_peers gauge\n"))
	w.Write([]byte("skepsi_active_peers " + strconv.FormatUint(ActivePeers.Load(), 10) + "\n"))
}
