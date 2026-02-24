package ws

import (
	"context"
	"sync/atomic"

	"skepsi/backend/internal/logger"
	"skepsi/backend/internal/metrics"
	"skepsi/backend/internal/protocol"
	"skepsi/backend/internal/room"

	"github.com/gorilla/websocket"
)

type Hub struct {
	connIDGen  atomic.Uint64
	conns      map[uint64]*Connection
	register   chan *Connection
	unregister chan *Connection
	incoming   chan incomingMsg
	rooms      *room.Manager
	done       chan struct{}
}

type incomingMsg struct {
	connID uint64
	raw    []byte
}

func NewHub(roomManager *room.Manager) *Hub {
	return &Hub{
		conns:      make(map[uint64]*Connection),
		register:   make(chan *Connection),
		unregister: make(chan *Connection),
		incoming:   make(chan incomingMsg, 1024),
		rooms:      roomManager,
		done:       make(chan struct{}),
	}
}

func (h *Hub) Run(ctx context.Context) {
	defer close(h.done)
	for {
		select {
		case <-ctx.Done():
			return
		case c := <-h.register:
			h.conns[c.ID] = c
			metrics.IncConnections()
			metrics.SetActiveConns(uint64(len(h.conns)))
			logger.Log.Info("client_connected", "conn_id", c.ID, "total", len(h.conns))
		case c := <-h.unregister:
			if _, ok := h.conns[c.ID]; !ok {
				continue
			}
			delete(h.conns, c.ID)
			metrics.SetActiveConns(uint64(len(h.conns)))
			h.rooms.LeaveAll(c.ID)
			c.Close()
			logger.Log.Info("client_disconnected", "conn_id", c.ID, "total", len(h.conns))
		case m := <-h.incoming:
			h.handleMessage(ctx, m.connID, m.raw)
		}
	}
}

func (h *Hub) handleMessage(ctx context.Context, connID uint64, raw []byte) {
	msgType, err := protocol.ParseMessageType(raw)
	if err != nil {
		logger.WithConn(connID).Warn("invalid_message_type", "error", err)
		return
	}
	c, ok := h.conns[connID]
	if !ok {
		return
	}
	switch msgType {
	case protocol.TypeJoin:
		j, err := protocol.ValidateJoin(raw)
		if err != nil {
			logger.WithConn(connID).Warn("invalid_join", "error", err)
			return
		}
		c.SiteId = j.SiteId
		h.rooms.EnsureJoin(j.DocId, connID, j.SiteId, c.Send)
		h.rooms.ForwardJoinToOnePeer(j.DocId, connID, raw)
		return
	case protocol.TypeSyncOp, protocol.TypeSyncDone:
		docId, target, err := protocol.ParseTargetedMessage(raw)
		if err != nil {
			logger.WithConn(connID).Warn("invalid_targeted_message", "error", err)
			return
		}
		h.rooms.SendToTarget(docId, target, raw)
		return
	default:
		op, err := protocol.ValidateOperation(raw)
		if err != nil {
			logger.WithConn(connID).Warn("invalid_message", "error", err)
			return
		}
		metrics.IncOpsProcessed()
		h.rooms.EnsureJoin(op.DocId, connID, op.SiteId, c.Send)
		h.rooms.Broadcast(op.DocId, raw, connID)
	}
}

func (h *Hub) Register(conn *websocket.Conn) *Connection {
	id := h.connIDGen.Add(1)
	c := NewConnection(conn, id)
	h.register <- c
	return c
}

func (h *Hub) Unregister(c *Connection) {
	h.unregister <- c
}

func (h *Hub) Incoming(connID uint64, raw []byte) {
	select {
	case h.incoming <- incomingMsg{connID: connID, raw: raw}:
	default:
		metrics.IncBackpressure()
		logger.WithConn(connID).Warn("router_backpressure_drop")
	}
}

func (h *Hub) Done() <-chan struct{} {
	return h.done
}

func (h *Hub) DropClient(connID uint64) {
	if c, ok := h.conns[connID]; ok {
		c.Close()
		select {
		case h.unregister <- c:
		default:
		}
	}
}
