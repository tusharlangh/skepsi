package collab

import (
	"testing"
)

const (
	siteA = 0
	siteB = 100
	siteC = 200
)

func TestCompare(t *testing.T) {
	if Compare(Position{4}, Position{5}) >= 0 {
		t.Error("[4] should be less than [5]")
	}
	if Compare(Position{4, 1}, Position{4, 1, 9}) >= 0 {
		t.Error("[4,1] should be less than [4,1,9] (shorter prefix)")
	}
	if Compare(Position{4, 1, 9}, Position{5}) >= 0 {
		t.Error("[4,1,9] should be less than [5]")
	}
	if Compare(Position{4}, Position{4}) != 0 {
		t.Error("[4] should equal [4]")
	}
}

func TestGenerateBetween(t *testing.T) {
	left := Position{4}
	right := Position{5}
	p := GenerateBetween(left, right, 0)
	if Compare(left, p) >= 0 || Compare(p, right) >= 0 {
		t.Errorf("expected %v < %v < %v", left, p, right)
	}
	left2 := Position{4, 500}
	right2 := Position{4, 501}
	p2 := GenerateBetween(left2, right2, 0)
	if Compare(left2, p2) >= 0 || Compare(p2, right2) >= 0 {
		t.Errorf("expected %v < %v < %v", left2, p2, right2)
	}
	p3 := GenerateBetween(left2, right2, 1)
	if Compare(p2, p3) == 0 {
		t.Error("different siteBias should yield different positions")
	}
}

func TestConvergenceThreeSites(t *testing.T) {
	leftBound := Position{0}
	rightBound := Position{base - 1}

	makeReplica1 := func() *Engine {
		e := NewEngine()
		e.Insert(leftBound, rightBound, 'A', siteA)
		pos := e.Positions()
		posA := pos[0]
		e.Insert(posA, rightBound, 'B', siteA)
		pos = e.Positions()
		if len(pos) != 2 {
			t.Fatalf("expected 2 positions, got %d", len(pos))
		}
		posA, posB := pos[0], pos[1]
		e.Insert(posA, posB, 'X', siteB)
		e.Insert(posA, posB, 'Y', siteC)
		return e
	}

	makeReplica2 := func() *Engine {
		e := NewEngine()
		e.Insert(leftBound, rightBound, 'A', siteA)
		pos := e.Positions()
		posA := pos[0]
		e.Insert(posA, rightBound, 'B', siteA)
		pos = e.Positions()
		posA, posB := pos[0], pos[1]
		e.Insert(posA, posB, 'Y', siteC)
		e.Insert(posA, posB, 'X', siteB)
		return e
	}

	makeReplica3 := func() *Engine {
		e := NewEngine()
		e.Insert(leftBound, rightBound, 'A', siteA)
		pos := e.Positions()
		posA := pos[0]
		e.Insert(posA, rightBound, 'B', siteA)
		pos = e.Positions()
		posA, posB := pos[0], pos[1]
		e.Insert(posA, posB, 'X', siteB)
		e.Insert(posA, posB, 'Y', siteC)
		return e
	}

	r1 := makeReplica1()
	r2 := makeReplica2()
	r3 := makeReplica3()

	s1, s2, s3 := r1.String(), r2.String(), r3.String()
	if s1 != s2 || s2 != s3 {
		t.Errorf("replicas must converge: got %q, %q, %q", s1, s2, s3)
	}
	if len(s1) != 4 {
		t.Errorf("expected 4 characters, got %d: %q", len(s1), s1)
	}
}

func TestDeleteTombstone(t *testing.T) {
	e := NewEngine()
	left := Position{0}
	right := Position{base - 1}
	e.Insert(left, right, 'A', 0)
	pos := e.Positions()
	posA := pos[0]
	e.Insert(posA, right, 'B', 0)
	pos = e.Positions()
	if len(pos) != 2 {
		t.Fatalf("expected 2 positions, got %d", len(pos))
	}
	e.Delete(pos[0])
	if e.String() != "B" {
		t.Errorf("after delete first: expected \"B\", got %q", e.String())
	}
	e.Delete(pos[1])
	if e.String() != "" {
		t.Errorf("after delete both: expected \"\", got %q", e.String())
	}
}

func TestApplyRemote(t *testing.T) {
	e := NewEngine()
	left := Position{0}
	right := Position{base - 1}
	p := GenerateBetween(left, right, 0)
	e.ApplyRemote(p, 'Z', false)
	if e.String() != "Z" {
		t.Errorf("expected \"Z\", got %q", e.String())
	}
	e.ApplyRemote(p, 'Z', true)
	if e.String() != "" {
		t.Errorf("after remote delete: expected \"\", got %q", e.String())
	}
}
