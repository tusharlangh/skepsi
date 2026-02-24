import type { ConnectionStatus } from "@frontend/crdtClient";
import { useCallback, useEffect, useRef, useState } from "react";
import { CrdtClient } from "@frontend/crdtClient";
import { Undo2, Redo2, Link2, Copy, List, Download, CopyPlus } from "lucide-react";
import { createSnapshotForNewDoc } from "@frontend/snapshot";
import { generateDocId, setDocIdInUrl } from "./useDocId";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";

function getLineStart(text: string, cursorIndex: number): number {
  const lastNewline = text.lastIndexOf("\n", cursorIndex - 1);
  return lastNewline === -1 ? 0 : lastNewline + 1;
}

function getOrCreateSiteId(): string {
  let id = localStorage.getItem("skepsi_site_id");
  if (!id) {
    id = "site-" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem("skepsi_site_id", id);
  }
  return id;
}

type EditorProps = { docId: string };

export default function Editor({ docId }: EditorProps) {
  const [, setRefresh] = useState(0);
  const clientRef = useRef<CrdtClient | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cursorRef = useRef(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("offline");

  useEffect(() => {
    const siteId = getOrCreateSiteId();
    const siteBias = Math.floor(Math.random() * 100);
    const client = new CrdtClient({
      url: WS_URL,
      docId,
      siteId,
      siteBias,
      onStateChange: () => {
        setRefresh((n) => n + 1);
        if (clientRef.current)
          cursorRef.current = clientRef.current.getCursorIndex();
      },
      onConnectionStatusChange: setConnectionStatus,
    });
    clientRef.current = client;
    cursorRef.current = 0;
    client.connect();
    setConnectionStatus(client.getConnectionStatus());
    setRefresh((n) => n + 1);
    return () => {
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
        const posToDelete = [];
        for (let i = start; i <= oldEnd; i++) {
          if (positions[i]) posToDelete.push(positions[i]);
        }
        for (const pos of posToDelete) {
          client.deleteAtPosition(pos);
        }
      }

      if (inserted.length > 0) {
        for (let i = 0; i < inserted.length; i++) {
          client.insertAt(start + i, inserted[i]);
        }
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

  const handleInsertBullet = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const t = client.getVisibleText();
    const idx = client.getCursorIndex();
    const lineStart = getLineStart(t, idx);
    client.insertAt(lineStart, "•");
    client.insertAt(lineStart + 1, " ");
    cursorRef.current = lineStart + 2;
    setCursorIndex(lineStart + 2);
    setRefresh((n) => n + 1);
    const ta = textareaRef.current;
    if (ta) {
      ta.setSelectionRange(lineStart + 2, lineStart + 2);
      ta.focus();
    }
  }, []);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
  }, []);

  const handleCopyText = useCallback(() => {
    const t = clientRef.current?.getVisibleText() ?? "";
    if (t) navigator.clipboard.writeText(t);
  }, []);

  const handleDownload = useCallback(() => {
    const t = clientRef.current?.getVisibleText() ?? "";
    if (!t) return;
    const blob = new Blob([t], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notes-${docId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [docId]);

  const handleSaveMyCopy = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const text = client.getVisibleText();
    const newDocId = generateDocId();
    createSnapshotForNewDoc(text, newDocId, client.getSiteId());
    setDocIdInUrl(newDocId);
  }, []);

  const pendingCount = client?.getPendingCount() ?? 0;
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
        <div className="actions">
          <button
            type="button"
            onClick={handleInsertBullet}
            title="Bullet"
          >
            <List size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            title="Copy link"
          >
            <Link2 size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleCopyText}
            disabled={!text}
            title="Copy document"
          >
            <Copy size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!text}
            title="Save as file"
          >
            <Download size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={handleSaveMyCopy}
            title="Save my copy"
          >
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
      <div
        className="editor-area"
        onClick={() => textareaRef.current?.focus()}
      >
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
