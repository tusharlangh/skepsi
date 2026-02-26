import type { ConnectionStatus } from "@frontend/crdtClient";
import { useCallback, useEffect, useRef, useState } from "react";
import { CrdtClient } from "@frontend/crdtClient";
import { Undo2, Redo2, Copy, CopyPlus, Home } from "lucide-react";
import { createSnapshotForNewDoc } from "@frontend/snapshot";
import { generateDocId, setDocIdInUrl, clearDocIdFromUrl } from "./useDocId";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";

function getOrCreateSiteId(): string {
  let id = localStorage.getItem("skepsi_site_id");
  if (!id) {
    id = "site-" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem("skepsi_site_id", id);
  }
  return id;
}

function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

type EditorProps = { docId: string };

export default function Editor({ docId }: EditorProps) {
  const [, setRefresh] = useState(0);
  const clientRef = useRef<CrdtClient | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cursorRef = useRef(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("offline");

  useEffect(() => {
    // Per-tab siteId so ops from another tab are not treated as self-acks (which skip UI refresh).
    const siteId = getOrCreateSiteId() + "-" + Math.random().toString(36).slice(2, 8);
    const siteBias = Math.floor(Math.random() * 100);
    let rafId: number | null = null;
    const client = new CrdtClient({
      url: WS_URL,
      docId,
      siteId,
      siteBias,
      onStateChange: () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          setRefresh((n) => n + 1);
          if (clientRef.current)
            cursorRef.current = clientRef.current.getCursorIndex();
        });
      },
      onConnectionStatusChange: setConnectionStatus,
    });
    clientRef.current = client;
    cursorRef.current = 0;
    client.connect();
    setConnectionStatus(client.getConnectionStatus());
    setRefresh((n) => n + 1);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      client.disconnect();
      clientRef.current = null;
    };
  }, [docId]);

  const client = clientRef.current;
  const text = client?.getVisibleText() ?? "";
  const canUndo = client?.canUndo() ?? false;
  const canRedo = client?.canRedo() ?? false;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (ta.selectionStart !== cursorIndex || ta.selectionEnd !== cursorIndex) {
      ta.setSelectionRange(cursorIndex, cursorIndex);
    }
  }, [text, cursorIndex]);

  const syncCursorFromClient = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const idx = client.getCursorIndex();
    cursorRef.current = idx;
    setCursorIndex(idx);
    const ta = textareaRef.current;
    if (ta) ta.setSelectionRange(idx, idx);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const client = clientRef.current;
      if (!client) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (client.redo()) setRefresh((n) => n + 1);
        } else {
          if (client.undo()) setRefresh((n) => n + 1);
        }
        syncCursorFromClient();
      }
    },
    [syncCursorFromClient],
  );

  const handleSelect = useCallback(() => {
    const ta = textareaRef.current;
    const client = clientRef.current;
    if (!ta || !client) return;
    const start = ta.selectionStart;
    client.setCursorIndex(start);
    cursorRef.current = start;
    setCursorIndex(start);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const client = clientRef.current;
      if (!client) return;

      const newVal = e.target.value;
      const oldVal = client.getVisibleText();
      const ta = textareaRef.current;

      let start = 0;
      while (
        start < oldVal.length &&
        start < newVal.length &&
        oldVal[start] === newVal[start]
      ) {
        start++;
      }

      let oldEnd = oldVal.length - 1;
      let newEnd = newVal.length - 1;
      while (
        oldEnd >= start &&
        newEnd >= start &&
        oldVal[oldEnd] === newVal[newEnd]
      ) {
        oldEnd--;
        newEnd--;
      }

      const deleted = oldVal.slice(start, oldEnd + 1);
      const inserted = newVal.slice(start, newEnd + 1);

      if (deleted.length > 0) {
        const positions = client.getVisibleState().getPositions();
        const posToDelete: number[][] = [];
        for (let i = start; i <= oldEnd; i++) {
          if (positions[i]) posToDelete.push(positions[i]);
        }
        client.deleteRange(posToDelete);
      }

      if (inserted.length > 0) {
        client.insertRange(start, inserted);
      }

      if (ta) {
        const cursor = ta.selectionStart;
        client.setCursorIndex(cursor);
        cursorRef.current = cursor;
        setCursorIndex(cursor);
      }
      setRefresh((n) => n + 1);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    if (clientRef.current?.undo()) setRefresh((n) => n + 1);
    syncCursorFromClient();
  }, [syncCursorFromClient]);

  const handleRedo = useCallback(() => {
    if (clientRef.current?.redo()) setRefresh((n) => n + 1);
    syncCursorFromClient();
  }, [syncCursorFromClient]);

  const handleCopyText = useCallback(() => {
    const t = clientRef.current?.getVisibleText() ?? "";
    if (t) navigator.clipboard.writeText(t);
  }, []);

  const handleSaveMyCopy = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const text = client.getVisibleText();
    const newDocId = generateDocId();
    createSnapshotForNewDoc(text, newDocId, client.getSiteId());
    setDocIdInUrl(newDocId);
  }, []);

  const pendingCount = client?.getPendingCount() ?? 0;
  const wordCount = countWords(text);
  const statusLabel =
    connectionStatus === "offline"
      ? pendingCount > 0
        ? `Offline · ${pendingCount} edits pending`
        : "Offline"
      : connectionStatus === "connecting"
        ? "Connecting…"
        : connectionStatus === "syncing"
          ? "Syncing…"
          : "Online";

  return (
    <div className="doc-wrap">
      <div className="toolbar">
        <span
          className={`connection-pill ${connectionStatus}`}
          title={statusLabel}
        >
          <span className="dot" />
          {statusLabel}
        </span>
        <span className="word-count">{wordCount} words</span>
        <div className="actions">
          <button
            type="button"
            onClick={clearDocIdFromUrl}
            title="New document"
          >
            <Home size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleCopyText}
            disabled={!text}
            title="Copy document"
          >
            <Copy size={18} strokeWidth={2} />
          </button>
          <button type="button" onClick={handleSaveMyCopy} title="Save my copy">
            <CopyPlus size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo"
          >
            <Undo2 size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo"
          >
            <Redo2 size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="editor-area" onClick={() => textareaRef.current?.focus()}>
        <textarea
          ref={textareaRef}
          key="editor"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          placeholder="Start typing…"
          autoFocus
          spellCheck={false}
        />
      </div>
    </div>
  );
}
