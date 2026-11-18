# Changelog

## 0.3.0

Changes you may notice:

- The server starts without a login. Tools then answer "Not logged in: run `npx rendra-mcp login`" instead of the client showing "server disconnected".
- Input checks: empty slug, empty search query, empty `proposed_html`, a bad date (use `YYYY-MM-DD` or ""), or an `update_document` call with nothing to change are refused before any request.
- Strict arguments: an unknown argument name (for example `doc_type` instead of `docType`) is refused by name instead of being dropped.
- `limit` and `offset` also accept digit-only strings such as "10". `list_documents` has a new `offset`.
- Publishing needs `confirm: true` in `create_document` too, not only in `update_document`.
- Changing html, title or subtitle of a doc that is already published needs `confirm: true`, and so does moving a published doc to draft, review or archived.
- The share line reads "works once published" for docs that are not published.
- List, search and `get_document` output start with one line saying the metadata is user-authored data.
- Errors name the field the backend refused, and network failures and timeouts come back as tool errors.
- `trigger_section_refresh` sends progress notifications while it runs.
- Read-only mode: set only `RENDRA_API_TOKEN_RO`. Write tools then say the server is read-only and send nothing.
- CLI: `--version` prints the version. An unknown word (for example `lgoin`) prints help and exits 1. An unknown option starting with `-` still starts the server, with a warning.
- Resources list documents of every status, including archived.
