package logger

import (
	"log/slog"
	"os"
)

var Log *slog.Logger

func init() {
	Log = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			return a
		},
	}))
}

func WithConn(connID uint64) *slog.Logger {
	return Log.With("conn_id", connID)
}

func WithDoc(docID string) *slog.Logger {
	return Log.With("doc_id", docID)
}

func WithConnAndDoc(connID uint64, docID string) *slog.Logger {
	return Log.With("conn_id", connID, "doc_id", docID)
}
