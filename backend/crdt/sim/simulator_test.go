package sim

import (
	"testing"
)

const testSeed int64 = 42

func assertConvergence(t *testing.T, clients []*Client, expectedLen int) {
	t.Helper()
	if len(clients) == 0 {
		return
	}
	ref := clients[0].Document()
	for i, c := range clients {
		s := c.Document()
		if s != ref {
			t.Errorf("client %d (%s) diverged: got %q, expected %q", i, c.SiteId, s, ref)
		}
	}
	if expectedLen >= 0 && len(ref) != expectedLen {
		t.Errorf("document length: got %d, expected %d; doc = %q", len(ref), expectedLen, ref)
	}
	for _, c := range clients {
		_ = c.Document()
	}
}

func TestConcurrentInsert(t *testing.T) {
	const seed = testSeed
	config := DefaultChaosConfig(seed)
	net := NewNetwork(config)
	clients := make([]*Client, 2)
	clients[0] = NewClient("A", 0)
	clients[1] = NewClient("B", 100)

	leftA := clients[0].Left()
	rightA := clients[0].Right()
	leftB := clients[1].Left()
	rightB := clients[1].Right()

	for _, r := range "HELLO" {
		op := clients[0].LocalInsert(leftA, rightA, r)
		net.Send(op, "A")
		pos := clients[0].Positions()
		if len(pos) > 0 {
			leftA = pos[len(pos)-1]
		}
	}
	for _, r := range "WORLD" {
		op := clients[1].LocalInsert(leftB, rightB, r)
		net.Send(op, "B")
		pos := clients[1].Positions()
		if len(pos) > 0 {
			leftB = pos[len(pos)-1]
		}
	}

	net.DeliverAll(clients)
	assertConvergence(t, clients, -1)
	ref := clients[0].Document()
	if len(ref) != 10 {
		t.Errorf("expected 10 characters total, got %d: %q", len(ref), ref)
	}
	hasHello, hasWorld := false, false
	for _, r := range ref {
		if r == 'H' {
			hasHello = true
		}
		if r == 'W' {
			hasWorld = true
		}
	}
	if !hasHello || !hasWorld {
		t.Errorf("expected both HELLO and WORLD content; got %q", ref)
	}
}

func TestSamePositionInsert(t *testing.T) {
	const seed = testSeed + 1
	config := DefaultChaosConfig(seed)
	net := NewNetwork(config)
	clients := make([]*Client, 3)
	for i := 0; i < 3; i++ {
		siteId := string(rune('A' + i))
		clients[i] = NewClient(siteId, i*100)
	}

	left := clients[0].Left()
	right := clients[0].Right()
	op0 := clients[0].LocalInsert(left, right, 'X')
	net.Send(op0, "A")
	net.DeliverAll(clients)
	pos := clients[0].Positions()
	if len(pos) == 0 {
		t.Fatal("expected one position after X")
	}
	right = pos[0]
	for i := 0; i < 3; i++ {
		c := clients[i]
		op := c.LocalInsert(left, right, rune('a'+i))
		net.Send(op, c.SiteId)
	}
	net.DeliverAll(clients)
	assertConvergence(t, clients, 4)
	ref := clients[0].Document()
	if len(ref) != 4 {
		t.Errorf("expected 4 characters, got %d: %q", len(ref), ref)
	}
	for _, r := range []rune("abcX") {
		if !containsRune(ref, r) {
			t.Errorf("expected %q in %q", r, ref)
		}
	}
}

func containsRune(s string, r rune) bool {
	for _, c := range s {
		if c == r {
			return true
		}
	}
	return false
}

func TestUndoCollision(t *testing.T) {
	const seed = testSeed + 2
	config := DefaultChaosConfig(seed)
	net := NewNetwork(config)
	clients := make([]*Client, 3)
	clients[0] = NewClient("A", 0)
	clients[1] = NewClient("B", 100)
	clients[2] = NewClient("C", 200)

	left := clients[0].Left()
	right := clients[0].Right()

	opA := clients[0].LocalInsert(left, right, 'A')
	net.Send(opA, "A")
	net.DeliverAll(clients)
	pos := clients[0].Positions()
	leftA, rightA := pos[0], clients[0].Right()
	opB := clients[1].LocalInsert(leftA, rightA, 'B')
	net.Send(opB, "B")
	net.DeliverAll(clients)
	pos = clients[0].Positions()
	posA, posB := pos[0], pos[1]
	opC := clients[0].LocalInsert(posA, posB, 'C')
	net.Send(opC, "A")
	net.DeliverAll(clients)
	undoA, ok := clients[0].Undo()
	if !ok {
		t.Fatal("A undo failed")
	}
	net.Send(undoA, "A")
	undoB, ok := clients[1].Undo()
	if !ok {
		t.Fatal("B undo failed")
	}
	net.Send(undoB, "B")
	net.DeliverAll(clients)
	assertConvergence(t, clients, -1)
	ref := clients[0].Document()
	if ref != "A" {
		t.Errorf("after undo collision expected \"A\", got %q", ref)
	}
}

func TestLateJoin(t *testing.T) {
	const seed = testSeed + 3
	config := DefaultChaosConfig(seed)
	net := NewNetwork(config)
	n := 4
	clients := make([]*Client, n)
	for i := 0; i < n; i++ {
		siteId := string(rune('A' + i))
		clients[i] = NewClient(siteId, i*50)
	}

	var allOps []Op
	left := clients[0].Left()
	right := clients[0].Right()
	for i := 0; i < 200; i++ {
		c := clients[i%n]
		r := rune('a' + (i % 26))
		op := c.LocalInsert(left, right, r)
		allOps = append(allOps, op)
		net.Send(op, c.SiteId)
		pos := c.Positions()
		if len(pos) > 0 {
			left = pos[len(pos)-1]
		}
	}
	net.DeliverAll(clients)
	assertConvergence(t, clients, 200)
	refBefore := clients[0].Document()

	late := NewClient("E", 200)
	late.SyncReplay(allOps)
	clientsWithLate := append([]*Client{}, clients...)
	clientsWithLate = append(clientsWithLate, late)
	if late.Document() != refBefore {
		t.Errorf("late join after replay: got %q, expected %q", late.Document(), refBefore)
	}
	left = clients[0].Left()
	right = clients[0].Right()
	pos := clients[0].Positions()
	if len(pos) > 0 {
		left = pos[len(pos)-1]
	}
	for _, c := range clientsWithLate {
		op := c.LocalInsert(left, right, '!')
		net.Send(op, c.SiteId)
	}
	net.DeliverAll(clientsWithLate)
	assertConvergence(t, clientsWithLate, -1)
}

func TestOfflineEditing(t *testing.T) {
	const seed = testSeed + 4
	config := DefaultChaosConfig(seed)
	net := NewNetwork(config)
	clients := make([]*Client, 3)
	clients[0] = NewClient("A", 0)
	clients[1] = NewClient("B", 100)
	clients[2] = NewClient("C", 200)

	left := clients[0].Left()
	right := clients[0].Right()
	for _, r := range "AB" {
		op := clients[0].LocalInsert(left, right, r)
		net.Send(op, "A")
		pos := clients[0].Positions()
		if len(pos) > 0 {
			left = pos[len(pos)-1]
		}
	}
	for _, r := range "12" {
		op := clients[1].LocalInsert(left, right, r)
		net.Send(op, "B")
		pos := clients[1].Positions()
		if len(pos) > 0 {
			left = pos[len(pos)-1]
		}
	}
	net.DeliverAll(clients[:2])
	if clients[2].Document() != "" {
		t.Errorf("C should be offline (empty doc), got %q", clients[2].Document())
	}

	leftC := clients[2].Left()
	rightC := clients[2].Right()
	for _, r := range "XYZ" {
		op := clients[2].LocalInsert(leftC, rightC, r)
		net.Send(op, "C")
		pos := clients[2].Positions()
		if len(pos) > 0 {
			leftC = pos[len(pos)-1]
		}
	}

	var allOps []Op
	for _, c := range clients {
		allOps = append(allOps, c.OpLog...)
	}
	net2 := NewNetwork(DefaultChaosConfig(seed + 100))
	for _, op := range allOps {
		net2.Send(op, op.SiteId)
	}
	net2.DeliverAll(clients)
	assertConvergence(t, clients, -1)
	ref := clients[0].Document()
	if len(ref) != 7 {
		t.Errorf("expected 7 characters after merge, got %d: %q", len(ref), ref)
	}
}

func TestNoPanicNoInfiniteLoop(t *testing.T) {
	const seed = testSeed + 5
	config := ChaosConfig{Seed: seed, DuplicateProb: 0.3, MaxDelay: 20, Shuffle: true}
	net := NewNetwork(config)
	n := 5
	clients := make([]*Client, n)
	for i := 0; i < n; i++ {
		siteId := string(rune('A' + i))
		clients[i] = NewClient(siteId, i*40)
	}
	left := clients[0].Left()
	right := clients[0].Right()
	for i := 0; i < 30; i++ {
		c := clients[i%n]
		op := c.LocalInsert(left, right, rune('0'+i%10))
		net.Send(op, c.SiteId)
		pos := c.Positions()
		if len(pos) > 0 {
			left = pos[len(pos)-1]
		}
	}
	net.DeliverAll(clients)
	assertConvergence(t, clients, 30)
}
