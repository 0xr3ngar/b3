// Append-only. The index + 1 is the schema version stored in `PRAGMA user_version`.
export const UNIVERSAL_MIGRATIONS: ReadonlyArray<string> = [
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    topic TEXT,
    confidence REAL NOT NULL,
    origin TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    superseded_by TEXT,
    deleted_at TEXT,
    source_thread_id TEXT,
    source_thread_title TEXT,
    source_message_ids TEXT NOT NULL DEFAULT '[]',
    extractor_model TEXT,
    reason TEXT,
    batch_id TEXT,
    embedder_id TEXT,
    embedding BLOB
  );
  CREATE INDEX memories_current ON memories (deleted_at, superseded_by, updated_at);
  CREATE INDEX memories_embed ON memories (embedder_id);
  CREATE VIRTUAL TABLE memories_fts USING fts5 (
    text, content='memories', content_rowid='rowid', tokenize='trigram'
  );
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts (rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts (memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
  CREATE TRIGGER memories_au AFTER UPDATE OF text ON memories BEGIN
    INSERT INTO memories_fts (memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO memories_fts (rowid, text) VALUES (new.rowid, new.text);
  END;

  CREATE TABLE memory_tombstones (
    id TEXT PRIMARY KEY,
    normalized TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE memory_batches (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    thread_id TEXT,
    cursor_from TEXT,
    cursor_to TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    messages_json TEXT NOT NULL DEFAULT '{}',
    committed_at TEXT,
    ops_added INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE memory_signals (
    id TEXT PRIMARY KEY,
    concept TEXT NOT NULL,
    topic TEXT,
    strength REAL NOT NULL,
    source_message_ids TEXT NOT NULL,
    created_at TEXT NOT NULL,
    consumed_at TEXT
  );

  CREATE TABLE learn_lines (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    color TEXT NOT NULL,
    ord INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  );

  CREATE TABLE learn_concepts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    claim TEXT,
    minutes INTEGER NOT NULL DEFAULT 12,
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT,
    source TEXT,
    x REAL,
    y REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE learn_concept_lines (
    concept_id TEXT NOT NULL,
    line_id TEXT NOT NULL,
    ord INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (concept_id, line_id)
  );

  CREATE TABLE learn_edges (
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    planned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (from_id, to_id)
  );

  CREATE TABLE learn_cards (
    concept_id TEXT PRIMARY KEY,
    card_json TEXT NOT NULL,
    mastery REAL NOT NULL DEFAULT 0,
    passes_json TEXT NOT NULL DEFAULT '[]',
    due_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE learn_review_log (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL,
    item_id TEXT,
    thread_id TEXT,
    rating TEXT NOT NULL,
    outcome TEXT NOT NULL,
    help TEXT NOT NULL,
    confidence TEXT NOT NULL,
    overridden INTEGER NOT NULL DEFAULT 0,
    reviewed_at TEXT NOT NULL,
    card_before TEXT,
    card_after TEXT
  );
  CREATE INDEX learn_review_log_concept ON learn_review_log (concept_id, reviewed_at);

  CREATE TABLE learn_misconceptions (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE learn_items (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    widget TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    states_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reported_at TEXT
  );

  CREATE TABLE learn_taught (
    concept_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    thread_title TEXT NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (concept_id, thread_id)
  );

  CREATE TABLE learn_sessions (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    summary_json TEXT
  );
  `,
];
