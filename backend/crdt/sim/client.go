package sim

import (
	"skepsi/backend/internal/protocol"

	collab "skepsi/backend"
)

const base = 65536

type Client struct {
	SiteId    string
	SiteBias  int
	Engine    *collab.Engine
	Clock     int64
	OpCounter int
	OpLog     []Op
	UndoStack []int
}

func NewClient(siteId string, siteBias int) *Client {
	return &Client{
		SiteId:    siteId,
		SiteBias:  siteBias,
		Engine:    collab.NewEngine(),
		Clock:     0,
		OpCounter: 0,
		OpLog:     nil,
		UndoStack: nil,
	}
}

func (c *Client) nextOpId() protocol.OpId {
	id := protocol.OpId{Site: c.SiteId, Counter: c.OpCounter}
	c.OpCounter++
	return id
}

func (c *Client) Left() collab.Position  { return collab.Position{0} }
func (c *Client) Right() collab.Position { return collab.Position{base - 1} }

func (c *Client) LocalInsert(left, right collab.Position, value rune) Op {
	el := c.Engine.Insert(left, right, value, c.SiteBias)
	opId := c.nextOpId()
	pos := make(collab.Position, len(el.Position))
	copy(pos, el.Position)
	op := Op{
		SiteId:   c.SiteId,
		OpId:     opId,
		Position: pos,
		Value:    value,
		Deleted:  false,
	}
	c.Clock++
	c.OpLog = append(c.OpLog, op)
	c.UndoStack = append(c.UndoStack, len(c.OpLog)-1)
	return op
}

func (c *Client) LocalDelete(pos collab.Position) (Op, bool) {
	el := c.Engine.ElementAt(pos)
	if el == nil || el.Deleted {
		return Op{}, false
	}
	c.Engine.Delete(pos)
	opId := c.nextOpId()
	posCopy := make(collab.Position, len(pos))
	copy(posCopy, pos)
	op := Op{
		SiteId:   c.SiteId,
		OpId:     opId,
		Position: posCopy,
		Value:    el.Value,
		Deleted:  true,
	}
	c.Clock++
	c.OpLog = append(c.OpLog, op)
	c.UndoStack = append(c.UndoStack, len(c.OpLog)-1)
	return op, true
}

func (c *Client) Apply(op Op) {
	c.Engine.ApplyRemote(op.Position, op.Value, op.Deleted)
}

func (c *Client) Undo() (Op, bool) {
	if len(c.UndoStack) == 0 {
		return Op{}, false
	}
	idx := c.UndoStack[len(c.UndoStack)-1]
	c.UndoStack = c.UndoStack[:len(c.UndoStack)-1]
	orig := c.OpLog[idx]
	inverseOpId := c.nextOpId()
	posCopy := make(collab.Position, len(orig.Position))
	copy(posCopy, orig.Position)
	var inverse Op
	if orig.Deleted {
		c.Engine.ApplyRemote(posCopy, orig.Value, false)
		inverse = Op{
			SiteId:      c.SiteId,
			OpId:        inverseOpId,
			Position:    posCopy,
			Value:       orig.Value,
			Deleted:     false,
			InverseOpId: &orig.OpId,
		}
	} else {
		c.Engine.ApplyRemote(posCopy, orig.Value, true)
		inverse = Op{
			SiteId:      c.SiteId,
			OpId:        inverseOpId,
			Position:    posCopy,
			Value:       orig.Value,
			Deleted:     true,
			InverseOpId: &orig.OpId,
		}
	}
	c.Clock++
	c.OpLog = append(c.OpLog, inverse)
	return inverse, true
}

func (c *Client) Document() string {
	return c.Engine.String()
}

func (c *Client) Positions() []collab.Position {
	return c.Engine.Positions()
}

func (c *Client) SyncReplay(ops []Op) {
	for _, op := range ops {
		c.Apply(op)
	}
}

func (c *Client) CloneEngine() *collab.Engine {
	return c.Engine.Clone()
}
