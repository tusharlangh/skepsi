// Package collab implements a position-based list CRDT using variable-length
// integer paths. Ordering is lexicographic (shorter prefix is less). Insert
// uses GenerateBetween to pick a position strictly between two neighbors;
// when there is integer space the digit is chosen with siteBias so concurrent
// inserts at the same place get distinct, deterministic positions. Deletes
// are tombstones. Merge is by position only; arrival order does not affect outcome.
//
// Multiplayer undo/redo: Undo is not local state rewind but a new distributed
// operation. The client finds its last non-undone op, generates an inverse
// (insert→delete at same position, delete→reinsert at same position) and
// broadcasts it. The server treats undo as a normal insert or delete; the CRDT
// applies it like any other remote op. History is never removed; tombstones
// ensure convergence and late joiners reconstruct identical state.
package collab

const base = 65536

// Position is a variable-length path of integers. Elements are ordered
// lexicographically; a shorter prefix is less than a longer one when equal.
type Position []int

// Compare returns -1 if a < b, 0 if a == b, 1 if a > b.
// Lexicographic order; shorter prefix is less when one is prefix of the other.
func Compare(a, b Position) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	if len(a) < len(b) {
		return -1
	}
	if len(a) > len(b) {
		return 1
	}
	return 0
}

// GenerateBetween returns a position strictly between left and right.
// If there is integer space at some level, the midpoint is used.
// If not (e.g. [4,500] and [4,501]), depth is extended with a deterministic
// value derived from siteBias so different sites get different positions.
// Requires left < right. siteBias should be in [0, base) for deterministic spread.
func GenerateBetween(left, right Position, siteBias int) Position {
	half := base / 2
	if siteBias < 0 {
		siteBias = -siteBias
	}
	siteBias = siteBias % half
	for i := 0; ; i++ {
		var leftVal, rightVal int
		if i < len(left) {
			leftVal = left[i]
		} else {
			leftVal = 0
		}
		if i < len(right) {
			rightVal = right[i]
		} else {
			rightVal = base
		}
		if i >= len(left) && i < len(right) {
			if rightVal > 0 {
				out := make(Position, len(left)+1)
				copy(out, left)
				out[len(left)] = rightVal / 2
				return out
			}
			out := make(Position, len(left)+2)
			copy(out, left)
			out[len(left)] = 0
			out[len(left)+1] = half + siteBias
			return out
		}
		if leftVal+1 < rightVal {
			gap := rightVal - leftVal - 1
			if gap <= 1 {
				out := make(Position, len(left)+1)
				copy(out, left)
				out[len(left)] = half + siteBias
				return out
			}
			mid := leftVal + 1 + (siteBias % gap)
			out := make(Position, i+1)
			copy(out, left)
			out[i] = mid
			return out
		}
		if leftVal+1 == rightVal {
			out := make(Position, len(left)+1)
			copy(out, left)
			out[len(left)] = half + siteBias
			return out
		}
	}
}

// Element is a single character (or unit) in the sequence, with a position and optional tombstone.
type Element struct {
	Position Position
	Value    rune
	Deleted  bool
}

// Engine holds the sequence of elements (including tombstones) and orders by position.
type Engine struct {
	elements []*Element
}

// NewEngine returns an empty engine with the default boundaries [0] and [base-1].
func NewEngine() *Engine {
	return &Engine{
		elements: []*Element{
			{Position: Position{0}, Value: 0, Deleted: true},
			{Position: Position{base - 1}, Value: 0, Deleted: true},
		},
	}
}

// Insert inserts a rune between the two positions (after left, before right).
// left and right must be existing positions; siteBias is used when extending depth.
func (e *Engine) Insert(left, right Position, value rune, siteBias int) *Element {
	pos := GenerateBetween(left, right, siteBias)
	el := &Element{Position: pos, Value: value, Deleted: false}
	e.insertElement(el)
	return el
}

func (e *Engine) insertElement(el *Element) {
	i := e.indexOf(el.Position)
	if i >= 0 {
		return
	}
	insertAt := 0
	for insertAt < len(e.elements) && Compare(e.elements[insertAt].Position, el.Position) < 0 {
		insertAt++
	}
	newEl := make([]*Element, len(e.elements)+1)
	copy(newEl, e.elements[:insertAt])
	newEl[insertAt] = el
	copy(newEl[insertAt+1:], e.elements[insertAt:])
	e.elements = newEl
}

func (e *Engine) indexOf(pos Position) int {
	for i, el := range e.elements {
		if Compare(el.Position, pos) == 0 {
			return i
		}
	}
	return -1
}

// Delete marks the element at the given position as deleted (tombstone).
func (e *Engine) Delete(pos Position) {
	i := e.indexOf(pos)
	if i >= 0 {
		e.elements[i].Deleted = true
	}
}

// ApplyRemote applies a remote operation: insert or delete.
// Duplicates (same position) are ignored for insert; delete is idempotent.
func (e *Engine) ApplyRemote(pos Position, value rune, deleted bool) {
	i := e.indexOf(pos)
	if i >= 0 {
		if deleted {
			e.elements[i].Deleted = true
		}
		return
	}
	if deleted {
		return
	}
	el := &Element{Position: pos, Value: value, Deleted: false}
	e.insertElement(el)
}

// String returns the current document string (non-deleted elements in position order).
func (e *Engine) String() string {
	var b []rune
	for _, el := range e.elements {
		if !el.Deleted && el.Value != 0 {
			b = append(b, el.Value)
		}
	}
	return string(b)
}

// Positions returns the positions of all non-deleted elements in order (for finding neighbors).
func (e *Engine) Positions() []Position {
	var out []Position
	for _, el := range e.elements {
		if !el.Deleted {
			out = append(out, el.Position)
		}
	}
	return out
}

// ElementAt returns the element at the given position, or nil.
func (e *Engine) ElementAt(pos Position) *Element {
	i := e.indexOf(pos)
	if i < 0 {
		return nil
	}
	return e.elements[i]
}

// LeftNeighbor returns the position immediately before pos, or nil if none.
func (e *Engine) LeftNeighbor(pos Position) Position {
	idx := -1
	for i, el := range e.elements {
		if Compare(el.Position, pos) == 0 {
			idx = i
			break
		}
	}
	if idx <= 0 {
		return nil
	}
	for i := idx - 1; i >= 0; i-- {
		if !e.elements[i].Deleted {
			return e.elements[i].Position
		}
	}
	return nil
}

// RightNeighbor returns the position immediately after pos, or nil if none.
func (e *Engine) RightNeighbor(pos Position) Position {
	idx := -1
	for i, el := range e.elements {
		if Compare(el.Position, pos) == 0 {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil
	}
	for i := idx + 1; i < len(e.elements); i++ {
		if !e.elements[i].Deleted {
			return e.elements[i].Position
		}
	}
	return nil
}

// Clone returns a deep copy of the engine (for tests or merging).
func (e *Engine) Clone() *Engine {
	out := &Engine{
		elements: make([]*Element, len(e.elements)),
	}
	for i, el := range e.elements {
		posCopy := make(Position, len(el.Position))
		copy(posCopy, el.Position)
		out.elements[i] = &Element{Position: posCopy, Value: el.Value, Deleted: el.Deleted}
	}
	return out
}
