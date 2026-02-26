package router

import (
	"hash/fnv"
	"sync"
)

// Selector routes a doc ID to one of the configured backend base URLs using
// rendezvous (highest random weight) hashing: same docId maps to the same
// backend, and adding/removing a backend only moves docs that had that
// backend as winner.
type Selector struct {
	mu       sync.RWMutex
	backends []string
}

// NewSelector returns a selector that routes by rendezvous hashing over the
// given backends.
func NewSelector(backends []string) *Selector {
	if len(backends) == 0 {
		backends = nil
	}
	return &Selector{backends: backends}
}

// SetBackends updates the list of backend base URLs (e.g. http://localhost:8081).
func (s *Selector) SetBackends(backends []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(backends) == 0 {
		s.backends = nil
		return
	}
	s.backends = make([]string, len(backends))
	copy(s.backends, backends)
}

// Backend returns the base URL for the given docId using rendezvous hashing.
// Empty string if no backends.
func (s *Selector) Backend(docId string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := len(s.backends)
	if n == 0 {
		return ""
	}
	if n == 1 {
		return s.backends[0]
	}
	docBytes := []byte(docId)
	var best string
	var bestScore uint32
	for _, b := range s.backends {
		h := fnv.New32a()
		_, _ = h.Write(docBytes)
		_, _ = h.Write([]byte(b))
		score := h.Sum32()
		if best == "" || score > bestScore {
			best = b
			bestScore = score
		}
	}
	return best
}
