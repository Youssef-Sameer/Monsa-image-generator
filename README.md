# Monsa Studio

AI product photos for MONSA (@monsa.eg).

## Start it
Double-click **start.bat**. The site opens at http://localhost:8080. To stop it, close the black window.
It needs Java 17 or newer, which is already installed on this computer.

The first time you open it, create your admin account.

## Where things are
| What | Where |
|---|---|
| All wording sent to the AI (default) | `config/prompts.json`, also editable in Admin > Prompts |
| Default styles, poses, colours, sizes, engines, feature toggles | `config/options.json`, also editable in Admin > Options |
| Starter models | `config/models.json` |
| Your saved data (users, products, gallery, settings, AI key) | `data/` (your edits override `config/`) |
| Your images | `storage/` |
| Colours of the website | the top of `public/style.css` |
| Server code (and the AI "engine" part: `callEngine`) | `Server.java` |

Back up `data/` and `storage/` to keep everything safe.

## AI key (free)
1. Sign up at https://enter.pollinations.ai
2. Create a secret key (it starts with `sk_`).
3. Paste it in Admin > Settings.

Without a key, use **Copy prompt**. It gives you the prompt and the reference photos to use in Gemini or ChatGPT, and you then upload the result back to the gallery.
