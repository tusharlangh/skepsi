package ws

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"skepsi/backend/internal/logger"

	"github.com/gorilla/websocket"
)

const (
	WriteWait       = 10 * time.Second
	PongWait        = 60 * time.Second
	PingPeriod      = (PongWait * 9) / 10
	MaxMessageBytes = 1 << 20
	SendBufferSize  = 2048
)

type Connection struct {
	conn   *websocket.Conn
	ID     uint64
	SiteId string
	Send   chan []byte
	closed chan struct{}
	once   sync.Once
	log    *slog.Logger
}

func NewConnection(conn *websocket.Conn, id uint64) *Connection {
	conn.SetReadLimit(MaxMessageBytes)
	return &Connection{
		conn:   conn,
		ID:     id,
		Send:   make(chan []byte, SendBufferSize),
		closed: make(chan struct{}),
		log:    logger.WithConn(id),
	}
}

func (c *Connection) ReadPump(ctx context.Context, onMessage func([]byte), onClosed func()) {
	defer func() {
		if onClosed != nil {
			onClosed()
		}
	}()
	c.conn.SetReadDeadline(time.Now().Add(PongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(PongWait))
		return nil
	})
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closed:
			return
		default:
		}
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.log.Warn("read_error", "error", err)
			}
			return
		}
		onMessage(raw)
	}
}

func (c *Connection) WritePump(ctx context.Context) {
	ticker := time.NewTicker(PingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closed:
			return
		case msg, ok := <-c.Send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(WriteWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				c.log.Warn("write_error", "error", err)
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(WriteWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Connection) Close() {
	c.once.Do(func() {
		close(c.closed)
		close(c.Send)
		_ = c.conn.Close()
	})
}

func (c *Connection) Closed() bool {
	select {
	case <-c.closed:
		return true
	default:
		return false
	}
}

func (c *Connection) SendNonBlocking(msg []byte) bool {
	select {
	case c.Send <- msg:
		return true
	default:
		return false
	}
}
