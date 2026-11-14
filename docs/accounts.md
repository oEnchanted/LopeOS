# Accounts and LopeDrive

LopeOS is usable without an account. Setup offers account creation, sign-in, or
continuing as a guest. Settings → LopeOS Account can connect an account later;
existing data is included in the first sync. Each account receives 1,000,000,000
bytes of server storage. The account server is a separate process; see its
[deployment instructions](../services/accounts/README.md).

## Included data

Your profile picture can be added, replaced, or removed in Settings → LopeOS Account.
Pictures are center-cropped to 256 × 256 pixels and stored as compact JPEG images.
They sync as a separate encrypted profile record, including removals, and appear in
the account dashboard, Settings sidebar, profile page, and setup review.

- LopeDrive files and folders, including its recoverable Trash.
- Readable regular files and folders in the connected runtime workspace.
- Shared preferences, application preferences, wallpaper, pinned/startup apps,
  saved window layout, retained history, and editor session data.
- Weather's saved cities and their order, selected city, temperature units, and
  automatic refresh preference. Existing single-city preferences migrate into
  the saved list. Forecast responses remain a temporary device cache.
- Lightroom assets, original images, albums, and saved library records.
- Writer recovery documents and Image Editor recovery, sessions, documents, assets.

Cloud sync excludes local account credentials, service tokens, remote Chromium
profiles/cookies, running terminals/processes, model downloads, and unrelated
browser storage. Applications themselves are bundled with LopeOS; their settings
and saved data sync, rather than reinstalling application binaries. Unsaved work
must reach an application's recovery store or a saved file before it can sync.

The implementation uses an explicit storage/database allowlist. New applications
must register their persisted stores in the account data adapter. Unknown stores
are not silently uploaded. Unsupported/newer schemas produce an actionable error.

## Files and offline use

`/LopeDrive` is backed by IndexedDB and mounted into the shared application file
service and file dialogs. It works without Docker and while offline. Upload,
create folder, read/write, rename, duplicate, copy/move between volumes, and
recoverable Trash operations are available. Cloud storage and local browser
capacity are separate; browser quota errors retain the server copy.

Local files support up to 1 GB per file. The existing runtime API supports up to
8 MiB per file. Serialized application records have a 1 GB transfer limit;
binary serialization overhead counts toward that limit and the cloud quota.
Oversized or unavailable workspace files are reported as pending, never described
as backed up. Symbolic links and special runtime files remain in the workspace.
Terminal commands operate on runtime files; the browser-backed LopeDrive mount is
not a terminal filesystem.

The cloud status panel shows actual account usage, byte transfer progress, the
current item, and an estimate based on measured transfer speed. Sync starts after
file/preference changes, on reconnection, and periodically while signed in. Sync
requires an open LopeOS tab. Failed work remains local and retries; a partial
backup shows its reason. Sync now is available in Files and Settings.

## Conflict and session behavior

Each device keeps a per-account baseline. Content hashes identify unchanged
records, and manifest writes use revision checks. Downloaded data is verified
before application. Concurrent edits retain the server's canonical record and
preserve the other version under `LopeDrive/Conflicts`. Deletion races keep edited
content and needed parent folders. Local file writes and deletes use versions;
application database writes compare data inside an IndexedDB transaction.

Sign-out stops transfers and revokes the server session. Files already on the
device remain there. A different account cannot silently inherit that data:
use a separate browser profile or reset local LopeOS data first. Reset preserves
the runtime workspace's ownership fence, because that separate server workspace
is not erased. A different account can use its new LopeDrive but will not sync the
previous account's runtime files.

Settings update when restored. Saved layouts open missing applications while
preserving currently open documents. Lightroom refreshes its library without
replacing active edits. Word and Image Editor retain open documents; reopen them
to load newly synchronized recovery drafts. LopeOS reports when new app data is
available.

## Verification

`npm run test:accounts` runs server security/quota/persistence tests, pure merge
tests, a real-server two-browser sync test, and the optional-account UI tests.
`npm run test:setup` covers setup, accessibility, local AI, and reset behavior.
`npm run test:backup` now covers the legacy serialization/migration utilities;
the old portable-backup UI is no longer exposed. Runtime versioned deletions are
covered by `python3 -m unittest services/runtime/fs_test.py`.

Production must run the account service behind HTTPS and provide durable server
storage. A static frontend deployment by itself cannot provide account storage.
