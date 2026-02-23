package sim

import (
	"math/rand"
	"sort"

	"skepsi/backend/internal/protocol"

	collab "skepsi/backend"
)

type Op struct {
	SiteId      string
	OpId        protocol.OpId
	Position    collab.Position
	Value       rune
	Deleted     bool
	InverseOpId *protocol.OpId
}

func (o Op) Clone() Op {
	pos := make(collab.Position, len(o.Position))
	copy(pos, o.Position)
	out := o
	out.Position = pos
	if o.InverseOpId != nil {
		inv := *o.InverseOpId
		out.InverseOpId = &inv
	}
	return out
}

type Message struct {
	Op   Op
	From string
}

type ChaosConfig struct {
	Seed          int64
	DuplicateProb float64
	MaxDelay      int
	Shuffle       bool
}

func DefaultChaosConfig(seed int64) ChaosConfig {
	return ChaosConfig{
		Seed:          seed,
		DuplicateProb: 0.2,
		MaxDelay:      50,
		Shuffle:       true,
	}
}

type Network struct {
	pending []Message
	config  ChaosConfig
}

func NewNetwork(config ChaosConfig) *Network {
	return &Network{
		pending: nil,
		config:  config,
	}
}

func (n *Network) Send(op Op, from string) {
	n.pending = append(n.pending, Message{Op: op.Clone(), From: from})
}

func (n *Network) PendingCount() int {
	return len(n.pending)
}

type delivery struct {
	msg Message
	at  int
}

func (n *Network) DeliverAll(clients []*Client) {
	if len(n.pending) == 0 {
		return
	}
	rng := rand.New(rand.NewSource(n.config.Seed))
	var schedule []delivery
	for i, m := range n.pending {
		msg := m
		msg.Op = msg.Op.Clone()
		if n.config.Shuffle {
			at := rng.Intn(n.config.MaxDelay + 1)
			schedule = append(schedule, delivery{msg: msg, at: at})
		} else {
			schedule = append(schedule, delivery{msg: msg, at: i})
		}
		if rng.Float64() < n.config.DuplicateProb {
			dup := msg
			dup.Op = dup.Op.Clone()
			dupAt := n.config.MaxDelay + 1 + rng.Intn(n.config.MaxDelay*2)
			schedule = append(schedule, delivery{msg: dup, at: dupAt})
		}
	}
	sort.Slice(schedule, func(i, j int) bool {
		if schedule[i].at != schedule[j].at {
			return schedule[i].at < schedule[j].at
		}
		return i < j
	})
	for _, d := range schedule {
		for _, c := range clients {
			c.Apply(d.msg.Op)
		}
	}
	n.pending = nil
}
