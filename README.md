# AI Writing Transparency

A small, fully static web app for generating a transparent **“this email was written or edited with AI”** badge for an email footer, and for keeping a private JSON record of each one you can reload later.

```
✶ Lightly AI-assisted (~20%) · Learn more
```

The badge carries **none** of your content: not the prompt, not the AI's output, not any chat link. Just the effort level, an optional context line, and a link to a static explainer page.

## Why it's tiny by design

- **No backend.** No server, no functions, no database. Nothing is ever sent anywhere.
- **No dependencies.** Vanilla HTML/CSS/JS, no build step, no bundler, no package manager.
- **Zero network requests.** Everything is inline or local. `<meta name="referrer" content="no-referrer">` is set anyway.
- **Runs from anywhere.** Works served over `https://` (GitHub Pages, Netlify, any static host) and opened directly from a `file://` path.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The composer / generator |
| `about.html` | Public, recipient-facing explainer (the badge's “Learn more” target) |
| `styles.css` | Engineer's Notebook design system, shared by both pages |
| `app.js` | Composer logic: inputs, effort estimate, badge generation, JSON save/load |
| `README.md` / `LICENSE` | This file; MIT license |

No `package.json`, no `netlify.toml`. There's nothing to build or install.

## Setup: the “Learn more” link

The badge's “Learn more” points at the full URL of your hosted About page. It is resolved in this order:

1. **UI override** — the *“Learn more” link* field on the page. Anyone using a hosted copy can point their badges at their own About page; the value is saved in their browser only (localStorage, no network).
2. **`LEARN_MORE_URL` constant** in `app.js` — the shipped default. If you fork this, set it to your own About page:
   ```js
   const LEARN_MORE_URL = 'https://ai-writing-transparency.netlify.app/about.html';
   ```
3. **Auto-derived** from the address bar (`…/about.html`), if `LEARN_MORE_URL` is left blank and the page is served over http(s).
4. **Placeholder** — only on `file://` with no override and a blank constant; clearly labelled so the badge stays copyable for inspection.

## Hosting

**GitHub Pages:** push these files, then in **Settings → Pages** set source = *Deploy from a branch*, branch = `main`, folder = `/ (root)`.

**Netlify:** drag the folder onto the Netlify dashboard (Sites → drop), or connect the repo with no build command and the project root as the publish directory.

Either way you can leave `BASE_URL` blank and the links auto-derive from the deployed URL, or set it explicitly to pin them.

## Using it

1. Pick how AI was involved: *a prompt you gave the AI*, or *your own draft the AI edited*.
2. Paste the original. Then paste the AI's result into the **rich AI-output box** — bold, lists, and links are preserved, so it stays formatted on the way to Outlook.
3. The **effort split** auto-estimates from your inputs. Drag the slider to override, and your value always wins.
4. Choose a **badge style**:
   - **Compact** — one clean line.
   - **Detailed** — a few lines with a short context note (e.g. “AI checked spelling, grammar, and wording.”) you can type or quick-pick. Optionally tick *Include a comparison stat* to add a line-3 figure that adapts to the mode: in edit mode it shows roughly how much of your wording the AI changed (a word-level diff); in prompt mode it shows how far your prompt expanded into the result.
5. **Copy email + badge** — copies your formatted AI output with the badge appended (as rich HTML), ready to paste straight into Outlook with fonts intact. The badge includes a small Human-vs-AI ratio bar built from table cells, so it renders natively in Outlook (no images or attachments). Rich copy needs a secure context (https), which Netlify/GitHub Pages provide; from `file://` it falls back to plain text.
   - Just the badge on its own? Open **Badge code** for the plain-text and HTML versions with their own copy buttons.

Optional extras (an AI conversation link and a short note) live under **Additional info**. They're saved in your JSON record only and never appear in the badge.

### The JSON archive

- **Save JSON** downloads the full record, including the AI's result and the chat link, as `AI-Writing_Transparency_YYYY-MM-DD_HH-MM-SS.json` (date and time, so saves never overwrite each other). This is your private local archive; recipients never see it.
- **Load JSON** reads a previously saved file back into every field and re-renders the badge. Save then load is lossless. A foreign or broken file fails with a friendly message rather than crashing.

```json
{
  "app": "aside",
  "v": 1,
  "kind": "prompt | edit",
  "original": "the prompt you gave, or your own draft",
  "result": "the AI output (sanitized HTML — formatting is preserved)",
  "aiLink": "optional AI conversation URL",
  "ai": 30,
  "note": "optional",
  "badgeMode": "compact | detailed",
  "context": "optional context line for the detailed badge",
  "showStats": false,
  "learnMore": "the full 'Learn more' URL this record uses",
  "contextChips": ["your saved quick-pick context options"],
  "created": 0,
  "updated": 0
}
```

`app: "aside"` is the internal format identifier (the project's working name); `created` is preserved across edits, `updated` is bumped on every save.

## A note on trust

The badge is a **good-faith, self-reported disclosure**. It is not cryptographic proof and not tamper-proof. It says what the sender chose to disclose. That's stated plainly on the About page too.

## License

MIT — see [LICENSE](LICENSE).
