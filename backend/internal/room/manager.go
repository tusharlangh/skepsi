package room

import (
	"context"
	"math/rand"
	"sync"
	"time"

	"skepsi/backend/internal/logger"
	"skepsi/backend/internal/metrics"
)

const (
	managerCommandTimeout = 5 * time.Second
	managerCommandBuffer  = 2048
	roomCommandBuffer     = 1024
)

type Manager struct {
	onDrop   func(connID uint64)
	rooms    map[string]*room
	commands chan managerCmd
	mu       sync.Mutex
	done     chan struct{}
}

type managerCmd struct {
	ensureJoin *struct {
		docId   string
		connID  uint64
		siteId  string
		sendCh  chan []byte
	}
	leaveAll  *uint64
	broadcast *struct {
		docId   string
		raw     []byte
		exclude uint64
	}
	forwardJoinToOnePeer *struct {
		docId         string
		excludeConnID uint64
		raw          []byte
	}
	sendToTarget *struct {
		docId        string
		targetSiteId string
		raw          []byte
	}
}

const dropAfterFailures = 5

type peer struct {
	connID       uint64
	siteId       string
	ch           chan []byte
	sendFailures int
}

type room struct {
	docId       string
	peersByConn map[uint64]*peer
	siteToConn  map[string]uint64
	commands    chan roomCmd
	manager     *Manager
}

type roomCmd struct {
	join     *struct {
		connID uint64
		siteId string
		ch     chan []byte
	}
	leave    *uint64
	broadcast *struct {
		raw     []byte
		exclude uint64
	}
	forwardJoinToOnePeer *struct {
		excludeConnID uint64
		raw          []byte
	}
	sendToTarget *struct {
		targetSiteId string
		raw          []byte
	}
}

func NewManager(onDrop func(connID uint64)) *Manager {
	m := &Manager{
		onDrop:   onDrop,
		rooms:    make(map[string]*room),
		commands: make(chan managerCmd, managerCommandBuffer),
		done:     make(chan struct{}),
	}
	go m.run()
	return m
}

func (m *Manager) SetDropCallback(fn func(connID uint64)) {
	m.mu.Lock()
	m.onDrop = fn
	m.mu.Unlock()
}

func (m *Manager) Drop(connID uint64) {
	m.mu.Lock()
	fn := m.onDrop
	m.mu.Unlock()
	if fn != nil {
		fn(connID)
	}
}

func (m *Manager) run() {
	defer close(m.done)
	for cmd := range m.commands {
		if cmd.ensureJoin != nil {
			e := cmd.ensureJoin
			m.mu.Lock()
			r, ok := m.rooms[e.docId]
			if !ok {
				r = newRoom(e.docId, m)
				m.rooms[e.docId] = r
				go r.run()
			}
			m.mu.Unlock()
			r.commands <- roomCmd{
				join: &struct {
					connID uint64
					siteId string
					ch     chan []byte
				}{e.connID, e.siteId, e.sendCh},
			}
		}
		if cmd.leaveAll != nil {
			connID := *cmd.leaveAll
			m.mu.Lock()
			for _, r := range m.rooms {
				r.commands <- roomCmd{leave: &connID}
			}
			m.mu.Unlock()
		}
		if cmd.broadcast != nil {
			b := cmd.broadcast
			m.mu.Lock()
			r, ok := m.rooms[b.docId]
			m.mu.Unlock()
			if ok {
				select {
				case r.commands <- roomCmd{
					broadcast: &struct {
						raw     []byte
						exclude uint64
					}{b.raw, b.exclude},
				}:
				default:
				}
			}
		}
		if cmd.forwardJoinToOnePeer != nil {
			f := cmd.forwardJoinToOnePeer
			m.mu.Lock()
			r, ok := m.rooms[f.docId]
			m.mu.Unlock()
			if ok {
				select {
				case r.commands <- roomCmd{
					forwardJoinToOnePeer: &struct {
						excludeConnID uint64
						raw          []byte
					}{f.excludeConnID, f.raw},
				}:
				default:
				}
			}
		}
		if cmd.sendToTarget != nil {
			s := cmd.sendToTarget
			m.mu.Lock()
			r, ok := m.rooms[s.docId]
			m.mu.Unlock()
			if ok {
				select {
				case r.commands <- roomCmd{
					sendToTarget: &struct {
						targetSiteId string
						raw          []byte
					}{s.targetSiteId, s.raw},
				}:
				default:
				}
			}
		}
	}
}

func newRoom(docId string, manager *Manager) *room {
	return &room{
		docId:       docId,
		peersByConn: make(map[uint64]*peer),
		siteToConn:  make(map[string]uint64),
		commands:    make(chan roomCmd, roomCommandBuffer),
		manager:     manager,
	}
}

func safeSend(ch chan []byte, msg []byte) (ok bool) {
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	select {
	case ch <- msg:
		return true
	default:
		return false
	}
}

// sendWithFailureTracking attempts to send; on failure, increments peer's sendFailures
// and returns shouldDrop if the peer has exceeded the failure threshold.
func sendWithFailureTracking(p *peer, raw []byte) (shouldDrop bool) {
	if safeSend(p.ch, raw) {
		p.sendFailures = 0
		return false
	}
	p.sendFailures++
	metrics.IncSendSkips()
	return p.sendFailures >= dropAfterFailures
}

func (r *room) run() {
	for cmd := range r.commands {
		if cmd.join != nil {
			j := cmd.join
			p := &peer{connID: j.connID, siteId: j.siteId, ch: j.ch}
			r.peersByConn[j.connID] = p
			r.siteToConn[j.siteId] = j.connID
		}
		if cmd.leave != nil {
			connID := *cmd.leave
			if p, ok := r.peersByConn[connID]; ok {
				delete(r.siteToConn, p.siteId)
				delete(r.peersByConn, connID)
			}
		}
		if cmd.broadcast != nil {
			b := cmd.broadcast
			for id, p := range r.peersByConn {
				if id == b.exclude {
					continue
				}
				if sendWithFailureTracking(p, b.raw) {
					delete(r.siteToConn, p.siteId)
					delete(r.peersByConn, id)
					r.manager.Drop(id)
				}
			}
		}
		if cmd.forwardJoinToOnePeer != nil {
			f := cmd.forwardJoinToOnePeer
			var candidates []*peer
			for id, p := range r.peersByConn {
				if id != f.excludeConnID {
					candidates = append(candidates, p)
				}
			}
			if len(candidates) > 0 {
				p := candidates[rand.Intn(len(candidates))]
				if sendWithFailureTracking(p, f.raw) {
					delete(r.siteToConn, p.siteId)
					delete(r.peersByConn, p.connID)
					r.manager.Drop(p.connID)
				}
			}
		}
		if cmd.sendToTarget != nil {
			s := cmd.sendToTarget
			connID, ok := r.siteToConn[s.targetSiteId]
			if !ok {
				continue
			}
			p := r.peersByConn[connID]
			if p == nil {
				continue
			}
			if sendWithFailureTracking(p, s.raw) {
				delete(r.siteToConn, p.siteId)
				delete(r.peersByConn, p.connID)
				r.manager.Drop(p.connID)
			}
		}
	}
}

func (m *Manager) Stats() (rooms uint64, peers uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, r := range m.rooms {
		peers += uint64(len(r.peersByConn))
	}
	return uint64(len(m.rooms)), peers
}

func (m *Manager) EnsureJoin(docId string, connID uint64, siteId string, sendCh chan []byte) bool {
	select {
	case m.commands <- managerCmd{
		ensureJoin: &struct {
			docId   string
			connID  uint64
			siteId  string
			sendCh  chan []byte
		}{docId, connID, siteId, sendCh},
	}:
		return true
	case <-time.After(managerCommandTimeout):
		metrics.IncBackpressure()
		logger.WithConnAndDoc(connID, docId).Warn("room_manager_backpressure_drop")
		return false
	}
}

func (m *Manager) LeaveAll(connID uint64) {
	select {
	case m.commands <- managerCmd{leaveAll: &connID}:
	default:
	}
}

func (m *Manager) Broadcast(docId string, raw []byte, excludeConnID uint64) bool {
	select {
	case m.commands <- managerCmd{
		broadcast: &struct {
			docId   string
			raw     []byte
			exclude uint64
		}{docId, raw, excludeConnID},
	}:
		return true
	case <-time.After(managerCommandTimeout):
		metrics.IncBackpressure()
		logger.WithDoc(docId).Warn("room_broadcast_backpressure_drop")
		return false
	}
}

func (m *Manager) ForwardJoinToOnePeer(docId string, excludeConnID uint64, raw []byte) bool {
	select {
	case m.commands <- managerCmd{
		forwardJoinToOnePeer: &struct {
			docId         string
			excludeConnID uint64
			raw           []byte
		}{docId, excludeConnID, raw},
	}:
		return true
	case <-time.After(managerCommandTimeout):
		metrics.IncBackpressure()
		logger.WithDoc(docId).Warn("room_forward_join_backpressure_drop")
		return false
	}
}

func (m *Manager) SendToTarget(docId string, targetSiteId string, raw []byte) bool {
	select {
	case m.commands <- managerCmd{
		sendToTarget: &struct {
			docId        string
			targetSiteId string
			raw          []byte
		}{docId, targetSiteId, raw},
	}:
		return true
	case <-time.After(managerCommandTimeout):
		metrics.IncBackpressure()
		logger.WithDoc(docId).Warn("room_send_to_target_backpressure_drop")
		return false
	}
}

func (m *Manager) Shutdown(ctx context.Context) {
	close(m.commands)
	select {
	case <-m.done:
	case <-ctx.Done():
	}
}
