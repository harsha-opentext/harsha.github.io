# NoteMD

NoteMD is a simple Markdown-based note-taking frontend that maps each note to a real `.md` file stored under `NoteMd/data/`.

Structure:

- NoteMd/
  - data/ (contains .md files and `index.json` mapping)
  - folders.yaml (stores folder hierarchy with parent/children references)
  - config.yaml (app config)

How it works:

- `note-md/index.html` is the web UI. It loads `NoteMd/data/index.json` to list notes and fetches the corresponding `.md` files from `NoteMd/data/`.
- When creating a note in the UI, the app updates its in-memory `state` and can download a `.md` file locally. To persist changes back to GitHub, implement a push flow similar to the other apps (PUT to GitHub contents API and update `index.json` and file contents).

Run locally:

```bash
python3 -m http.server 8000
open http://localhost:8000/note-md/index.html
```

GitHub (database) layout and sync:

- All application files for NoteMD live under the `NoteMd/` folder in your repository.
- The `data/` subfolder contains actual Markdown notes and `index.json` which maps notes to filenames.
- When you click `Fetch` in the UI, the app will read `NoteMd/data/index.json` from the configured GitHub repo (requires `note_token` and `note_repo` in `localStorage`).
- When you `Push`, the app will update `NoteMd/data/index.json` in the repo (it follows the same SHA-based PUT flow used by the other apps).

Set GitHub credentials in the browser console (or via a small settings page):

```js
localStorage.setItem('note_token', '<YOUR_PERSONAL_ACCESS_TOKEN>');
localStorage.setItem('note_repo', 'yourusername/yourrepo');
```

Notes file mapping example:

- `NoteMd/data/hello-world.md` — actual markdown file
- `NoteMd/data/index.json` — contains list of note metadata and filenames

