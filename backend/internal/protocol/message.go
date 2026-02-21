package protocol

import "encoding/json"

const (
	TypeInsert   = "insert"
	TypeDelete   = "delete"
	TypeCursor   = "cursor"
	TypeSync     = "sync"
	TypeJoin     = "join"
	TypeSyncOp   = "sync_op"
	TypeSyncDone = "sync_done"

	TypePeerJoined = "peer_joined"
)

var ValidOperationTypes = map[string]bool{
	TypeInsert: true,
	TypeDelete: true,
	TypeCursor: true,
	TypeSync:   true,
	TypeJoin:   true,
}

var ValidTargetedTypes = map[string]bool{
	TypeSyncOp:   true,
	TypeSyncDone: true,
}

type OpId struct {
	Site    string `json:"site"`
	Counter int    `json:"counter"`
}

type Operation struct {
	Type      string          `json:"type"`
	DocId     string          `json:"docId"`
	SiteId    string          `json:"siteId"`
	OpId      OpId            `json:"opId"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp int64           `json:"timestamp"`
}

type JoinMessage struct {
	Type       string `json:"type"`
	DocId      string `json:"docId"`
	SiteId     string `json:"siteId"`
	KnownClock int64  `json:"knownClock"`
}

type SyncOpMessage struct {
	Type   string    `json:"type"`
	DocId  string    `json:"docId"`
	Target string    `json:"target"`
	Op     Operation `json:"op"`
}

type SyncDoneMessage struct {
	Type   string `json:"type"`
	DocId  string `json:"docId"`
	Target string `json:"target"`
}

type PeerJoined struct {
	Type   string `json:"type"`
	DocId  string `json:"docId"`
	SiteId string `json:"siteId"`
}

func NewPeerJoined(docId, siteId string) PeerJoined {
	return PeerJoined{
		Type:   TypePeerJoined,
		DocId:  docId,
		SiteId: siteId,
	}
}

func (p PeerJoined) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Type   string `json:"type"`
		DocId  string `json:"docId"`
		SiteId string `json:"siteId"`
	}{
		Type:   p.Type,
		DocId:  p.DocId,
		SiteId: p.SiteId,
	})
}
