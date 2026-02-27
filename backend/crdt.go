package collab

const base = 65536

type Position []int

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

type Element struct {
	Position Position
	Value    rune
	Deleted  bool
}

type Engine struct {
	elements []*Element
}

func NewEngine() *Engine {
	return &Engine{
		elements: []*Element{
			{Position: Position{0}, Value: 0, Deleted: true},
			{Position: Position{base - 1}, Value: 0, Deleted: true},
		},
	}
}

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

func (e *Engine) Delete(pos Position) {
	i := e.indexOf(pos)
	if i >= 0 {
		e.elements[i].Deleted = true
	}
}

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

func (e *Engine) String() string {
	var b []rune
	for _, el := range e.elements {
		if !el.Deleted && el.Value != 0 {
			b = append(b, el.Value)
		}
	}
	return string(b)
}

func (e *Engine) Positions() []Position {
	var out []Position
	for _, el := range e.elements {
		if !el.Deleted {
			out = append(out, el.Position)
		}
	}
	return out
}

func (e *Engine) ElementAt(pos Position) *Element {
	i := e.indexOf(pos)
	if i < 0 {
		return nil
	}
	return e.elements[i]
}

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
