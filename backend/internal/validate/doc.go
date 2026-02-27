package validate

import (
	"errors"
	"unicode"
)

var (
	ErrDocIDEmpty   = errors.New("doc id is required")
	ErrDocIDTooLong = errors.New("doc id must be at most 256 characters")
	ErrDocIDInvalid = errors.New("doc id may only contain letters, numbers, hyphens and underscores")
)

const MaxDocIDLen = 256

func DocID(doc string) error {
	if doc == "" {
		return ErrDocIDEmpty
	}
	runes := []rune(doc)
	if len(runes) > MaxDocIDLen {
		return ErrDocIDTooLong
	}
	for _, r := range runes {
		if !isAllowedDocIDRune(r) {
			return ErrDocIDInvalid
		}
	}
	return nil
}

func isAllowedDocIDRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsNumber(r) || r == '-' || r == '_'
}
