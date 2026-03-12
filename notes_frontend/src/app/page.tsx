"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Note = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type NotesListResponse = {
  items: Note[];
  total: number;
};

const API_BASE =
  process.env.NEXT_PUBLIC_NOTES_API_BASE?.replace(/\/+$/, "") ||
  "http://localhost:3001";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

// PUBLIC_INTERFACE
export default function Home() {
  /** Main NoteMaster UI: sidebar list + editor pane. */
  const [notes, setNotes] = useState<Note[]>([]);
  const [total, setTotal] = useState<number>(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [q, setQ] = useState<string>("");
  const [tag, setTag] = useState<string>("");

  const [allTags, setAllTags] = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [loadingNote, setLoadingNote] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState<string>("");
  const [draftContent, setDraftContent] = useState<string>("");
  const [draftTagsText, setDraftTagsText] = useState<string>("");

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) || null,
    [notes, selectedId],
  );

  async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as any;
        if (body?.detail) detail = body.detail;
      } catch {
        // ignore
      }
      throw new Error(detail);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async function loadTags() {
    try {
      const tags = await apiFetch<string[]>("/tags");
      setAllTags(tags);
    } catch {
      // Non-fatal if tags endpoint isn't reachable yet.
    }
  }

  async function loadNotes(nextSelectedId?: string | null) {
    setLoadingList(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set("q", q.trim());
      if (tag.trim()) qs.set("tag", tag.trim());
      qs.set("limit", "200");
      const data = await apiFetch<NotesListResponse>(`/notes?${qs.toString()}`);
      setNotes(data.items);
      setTotal(data.total);

      const desired = nextSelectedId ?? selectedId;
      if (desired && data.items.some((n) => n.id === desired)) {
        setSelectedId(desired);
      } else {
        setSelectedId(data.items.length ? data.items[0].id : null);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load notes.");
    } finally {
      setLoadingList(false);
    }
  }

  async function loadNote(id: string) {
    setLoadingNote(true);
    setError(null);
    try {
      const note = await apiFetch<Note>(`/notes/${id}`);
      setDraftTitle(note.title);
      setDraftContent(note.content);
      setDraftTagsText(note.tags.join(", "));
    } catch (e: any) {
      setError(e?.message || "Failed to load note.");
    } finally {
      setLoadingNote(false);
    }
  }

  useEffect(() => {
    loadNotes(null);
    loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) {
      void loadNote(selectedId);
    } else {
      setDraftTitle("");
      setDraftContent("");
      setDraftTagsText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void onNew();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, draftTitle, draftContent, draftTagsText]);

  function parseTags(text: string): string[] {
    const parts = text
      .split(",")
      .map((t) => normalizeTag(t))
      .filter(Boolean);
    // dedupe preserving order
    return Array.from(new Set(parts));
  }

  async function onNew() {
    setSaving(true);
    setError(null);
    try {
      const created = await apiFetch<Note>("/notes", {
        method: "POST",
        body: JSON.stringify({
          title: "Untitled note",
          content: "",
          tags: [],
        }),
      });
      await loadNotes(created.id);
      await loadTags();
    } catch (e: any) {
      setError(e?.message || "Failed to create note.");
    } finally {
      setSaving(false);
    }
  }

  async function onSave() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const tags = parseTags(draftTagsText);
      const updated = await apiFetch<Note>(`/notes/${selectedId}`, {
        method: "PUT",
        body: JSON.stringify({
          title: draftTitle.trim() || "Untitled note",
          content: draftContent,
          tags,
        }),
      });

      // Update in list optimistically.
      setNotes((prev) =>
        prev
          .map((n) => (n.id === updated.id ? updated : n))
          .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
      );
      await loadTags();
    } catch (e: any) {
      setError(e?.message || "Failed to save note.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!selectedId) return;
    const note = selectedNote;
    if (!note) return;

    if (!confirm(`Delete "${note.title}"? This cannot be undone.`)) return;

    setDeleting(true);
    setError(null);
    try {
      await apiFetch<void>(`/notes/${selectedId}`, { method: "DELETE" });
      const remaining = notes.filter((n) => n.id !== selectedId);
      setNotes(remaining);
      setTotal((t) => Math.max(0, t - 1));
      setSelectedId(remaining.length ? remaining[0].id : null);
      await loadTags();
    } catch (e: any) {
      setError(e?.message || "Failed to delete note.");
    } finally {
      setDeleting(false);
    }
  }

  async function onApplyFilters() {
    await loadNotes(null);
  }

  return (
    <div className="nm-app">
      <header className="nm-header">
        <div className="nm-brand">
          <div className="nm-brandBadge" aria-hidden="true">
            NM
          </div>
          <div>
            <div className="nm-title">NoteMaster</div>
            <div className="nm-subtitle">
              Retro notes • <span className="nm-kbd">/</span> search •{" "}
              <span className="nm-kbd">Ctrl/⌘</span>+<span className="nm-kbd">S</span>{" "}
              save • <span className="nm-kbd">Ctrl/⌘</span>+<span className="nm-kbd">N</span>{" "}
              new
            </div>
          </div>
        </div>

        <div className="nm-headerActions">
          <button className="nm-btn nm-btnPrimary" onClick={() => void onNew()} disabled={saving || deleting}>
            + New
          </button>
          <button
            className="nm-btn"
            onClick={() => void onSave()}
            disabled={!selectedId || saving || deleting || loadingNote}
            title="Save (Ctrl/⌘+S)"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className="nm-btn nm-btnDanger"
            onClick={() => void onDelete()}
            disabled={!selectedId || deleting || saving}
            title="Delete note"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </header>

      <div className="nm-shell">
        <aside className="nm-sidebar" aria-label="Notes list">
          <div className="nm-panel">
            <div className="nm-panelTitle">Search & Filter</div>

            <label className="nm-label" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              ref={searchInputRef}
              className="nm-input"
              placeholder="Type to search title + content…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onApplyFilters();
              }}
            />

            <label className="nm-label" htmlFor="tag">
              Tag
            </label>
            <div className="nm-row">
              <input
                id="tag"
                className="nm-input"
                placeholder="e.g. retro"
                value={tag}
                onChange={(e) => setTag(normalizeTag(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onApplyFilters();
                }}
              />
              <button className="nm-btn" onClick={() => void onApplyFilters()} disabled={loadingList}>
                Filter
              </button>
            </div>

            <div className="nm-tags">
              {allTags.length ? (
                allTags.map((t) => (
                  <button
                    key={t}
                    className={`nm-chip ${tag === t ? "isActive" : ""}`}
                    onClick={() => {
                      setTag((prev) => (prev === t ? "" : t));
                    }}
                    title={`Filter by ${t}`}
                  >
                    #{t}
                  </button>
                ))
              ) : (
                <div className="nm-muted">No tags yet.</div>
              )}
            </div>

            <div className="nm-divider" />

            <div className="nm-muted">
              API: <span className="nm-mono">{API_BASE}</span>
            </div>
          </div>

          <div className="nm-listHeader">
            <div className="nm-listTitle">
              Notes{" "}
              <span className="nm-pill" title="Total matching notes">
                {total}
              </span>
            </div>
            <button
              className="nm-btn nm-btnSmall"
              onClick={() => void loadNotes(selectedId)}
              disabled={loadingList}
              title="Refresh list"
            >
              {loadingList ? "…" : "Refresh"}
            </button>
          </div>

          <div className="nm-list" role="list">
            {notes.length === 0 ? (
              <div className="nm-empty">
                <div className="nm-emptyTitle">No notes found.</div>
                <div className="nm-muted">Try clearing filters or create a new one.</div>
              </div>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  className={`nm-noteCard ${selectedId === n.id ? "isSelected" : ""}`}
                  onClick={() => setSelectedId(n.id)}
                  role="listitem"
                >
                  <div className="nm-noteCardTitle">{n.title}</div>
                  <div className="nm-noteCardMeta">
                    Updated {formatDate(n.updated_at)}
                    {n.tags?.length ? (
                      <span className="nm-noteCardTags">
                        {" "}
                        • {n.tags.slice(0, 2).map((t) => `#${t}`).join(" ")}
                        {n.tags.length > 2 ? " …" : ""}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="nm-main" aria-label="Editor">
          <div className="nm-editor">
            {error ? (
              <div className="nm-alert" role="alert">
                <div className="nm-alertTitle">Something went wrong</div>
                <div className="nm-alertBody">{error}</div>
              </div>
            ) : null}

            {!selectedId ? (
              <div className="nm-emptyMain">
                <div className="nm-emptyTitle">No note selected</div>
                <div className="nm-muted">Create a new note to start writing.</div>
              </div>
            ) : (
              <>
                <div className="nm-editorRow">
                  <label className="nm-label" htmlFor="title">
                    Title
                  </label>
                  <input
                    id="title"
                    className="nm-input nm-inputTitle"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    disabled={loadingNote || saving || deleting}
                    placeholder="Your note title…"
                  />
                </div>

                <div className="nm-editorRow">
                  <label className="nm-label" htmlFor="tags">
                    Tags (comma separated)
                  </label>
                  <input
                    id="tags"
                    className="nm-input"
                    value={draftTagsText}
                    onChange={(e) => setDraftTagsText(e.target.value)}
                    disabled={loadingNote || saving || deleting}
                    placeholder="retro, ideas, work"
                  />
                </div>

                <div className="nm-editorRow nm-editorGrow">
                  <label className="nm-label" htmlFor="content">
                    Content
                  </label>
                  <textarea
                    id="content"
                    className="nm-textarea"
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    disabled={loadingNote || saving || deleting}
                    placeholder="Write something rad…"
                  />
                </div>

                <div className="nm-statusBar">
                  <div className="nm-muted">
                    {selectedNote ? (
                      <>
                        Created <span className="nm-mono">{formatDate(selectedNote.created_at)}</span> • Updated{" "}
                        <span className="nm-mono">{formatDate(selectedNote.updated_at)}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="nm-muted">
                    {loadingNote ? "Loading…" : saving ? "Saving…" : deleting ? "Deleting…" : "Ready"}
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
