import { useState } from "react";
import { generateDocId, setDocIdInUrl, parseDocIdFromUrl } from "./useDocId";

export default function Landing() {
  const [pasteUrl, setPasteUrl] = useState("");
  const [joinError, setJoinError] = useState("");

  const handleNewLecture = () => {
    const id = generateDocId();
    setDocIdInUrl(id);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError("");
    const id = parseDocIdFromUrl(pasteUrl.trim());
    if (id) {
      setDocIdInUrl(id);
    } else {
      setJoinError("Couldn't find a document in that link.");
    }
  };

  return (
    <div className="landing">
      <div className="landing-inner">
        <img src="/logo.svg" alt="Skepsi" className="landing-logo" />
        <h1>Skepsi</h1>
        <p className="landing-subtitle">Collaborative notes that sync offline. Share a link and edit together.</p>
        <div className="landing-actions">
          <button type="button" className="landing-btn primary" onClick={handleNewLecture}>
            New lecture
          </button>
          <form onSubmit={handleJoin} className="landing-join">
            <input
              type="text"
              placeholder="Paste link to join…"
              value={pasteUrl}
              onChange={(e) => {
                setPasteUrl(e.target.value);
                setJoinError("");
              }}
              className={`landing-input ${joinError ? "landing-input-error" : ""}`}
              aria-invalid={!!joinError}
              aria-describedby={joinError ? "join-error" : undefined}
            />
            <button type="submit" className="landing-btn" disabled={!pasteUrl.trim()}>
              Join
            </button>
          </form>
          {joinError && (
            <p id="join-error" className="landing-error" role="alert">
              {joinError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
