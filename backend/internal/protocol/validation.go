package protocol

import (
	"encoding/json"
	"errors"
)

const MaxPayloadBytes = 1 << 20

var (
	ErrInvalidType     = errors.New("invalid operation type")
	ErrMissingDocId    = errors.New("missing docId")
	ErrMissingSiteId   = errors.New("missing siteId")
	ErrMissingTarget   = errors.New("missing target")
	ErrPayloadTooLarge = errors.New("payload exceeds max size")
)

type messageEnvelope struct {
	Type   string `json:"type"`
	DocId  string `json:"docId"`
	Target string `json:"target"`
}

func ValidateOperation(raw []byte) (*Operation, error) {
	if len(raw) > MaxPayloadBytes {
		return nil, ErrPayloadTooLarge
	}
	var op Operation
	if err := json.Unmarshal(raw, &op); err != nil {
		return nil, err
	}
	if !ValidOperationTypes[op.Type] {
		return nil, ErrInvalidType
	}
	if op.DocId == "" {
		return nil, ErrMissingDocId
	}
	if op.SiteId == "" {
		return nil, ErrMissingSiteId
	}
	return &op, nil
}

func ParseMessageType(raw []byte) (msgType string, err error) {
	var env struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return "", err
	}
	return env.Type, nil
}

func ValidateJoin(raw []byte) (*JoinMessage, error) {
	if len(raw) > MaxPayloadBytes {
		return nil, ErrPayloadTooLarge
	}
	var j JoinMessage
	if err := json.Unmarshal(raw, &j); err != nil {
		return nil, err
	}
	if j.Type != TypeJoin {
		return nil, ErrInvalidType
	}
	if j.DocId == "" {
		return nil, ErrMissingDocId
	}
	if j.SiteId == "" {
		return nil, ErrMissingSiteId
	}
	return &j, nil
}

func ParseTargetedMessage(raw []byte) (docId, target string, err error) {
	if len(raw) > MaxPayloadBytes {
		return "", "", ErrPayloadTooLarge
	}
	var env messageEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return "", "", err
	}
	if !ValidTargetedTypes[env.Type] {
		return "", "", ErrInvalidType
	}
	if env.DocId == "" {
		return "", "", ErrMissingDocId
	}
	if env.Target == "" {
		return "", "", ErrMissingTarget
	}
	return env.DocId, env.Target, nil
}
