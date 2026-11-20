# claude-mods

Mods for Claude Code. One so far: **reader**. It redraws Claude's replies in the terminal so they read faster: colors, aligned tables, flow diagrams, bar charts, status lists with icons, and a glossary that lasts across sessions.

Made for dark terminal themes. Built on Claude Code 2.1.329.

## Install

### Step by step for an agent

Paste this section to a Claude Code agent, or run it yourself.

1. Run `claude --version`. If it is older than 2.1.329, run `claude update` and check again.
2. Run `claude plugin list`. If it already shows `reader@oliver-mods`, skip to step 5.
3. Add the marketplace:
   ```sh
   claude plugin marketplace add olivercarvajal/claude-mods
   ```
4. Install the mod:
   ```sh
   claude plugin install reader@oliver-mods
   ```
5. Run `claude plugin list` again. It must show `reader@oliver-mods` with `Status: ✔ enabled`.
6. Tell the user to open a new chat, or to type `/reload-plugins` in each chat already open. An agent cannot run that command for them, and its own chat keeps the old look until then.
7. Ask the user to check it in that chat with a prompt like "show 800 KB and 400 KB as bars". A gray card with blue bars means it works.

### Update

```sh
claude plugin marketplace update oliver-mods
claude plugin update reader@oliver-mods
```

Then `/reload-plugins` in each open chat.

### Uninstall

```sh
claude plugin uninstall reader@oliver-mods
```

## What you get

### Colors

| Element | Color |
| --- | --- |
| Headings, and lines that are only bold | pink `#f49ad6` |
| Bold text | blue `#89b4fa` |
| Inline code | cream `#f0e2b6` |
| Claude's pick (`Mía:` or `Mi recomendación:`) | green `#b5d99c` |
| Code blocks | on a `#383b45` card, language name on top |
| List markers, table lines, arrows | the theme's subtle gray |

Pipe tables line up in columns with `│` and `─┼─`, headers in pink. A table wider than the terminal falls back to Claude Code's own table.

### Four new blocks

The mod adds a short section to Claude's system prompt that teaches it four fenced blocks and when to use each. Below, what Claude writes and roughly what you see (colors left out).

#### `flow`: something that moves across systems or steps

````
```flow
app: user taps Save
-> POST /notes
api: checks the session
  writes the row
postgres: notes table
```
````

```
╭────────────────╮
│ app            │
│ user taps Save │
╰────────────────╯
  │  POST /notes
  ▼
╭────────────────────╮
│ api                │
│ checks the session │
│ writes the row     │
╰────────────────────╯
  │
  ▼
╭─────────────╮
│ postgres    │
│ notes table │
╰─────────────╯
```

Node names are blue, arrow labels cream and italic.

#### `bars`: three or more numbers to compare

````
```bars
before: 800 KB
after: 400 KB
limit: 600
```
````

```
before  ████████████████████████████████████████ 800 KB
after   ████████████████████                     400 KB
limit   ─────────────────────────────┤           600 KB
```

Bars are blue on a card. With a `limit:` line, the bars past it turn red.

#### `status`: PRs, tasks or releases in order

````
```status
done: Parser for the new blocks
deployed: v0.1.2 on GitHub
in progress: Tests on CI
needs you: Pick a name for the pane
open: Light theme
blocked: Screenshots, waiting on the light theme
todo: Windows check
```
````

```
  1. ✅ done        Parser for the new blocks
  2. 🚀 deployed    v0.1.2 on GitHub
  3. ⏳ in progress Tests on CI
  4. 👉 needs you   Pick a name for the pane
  5. 📂 open        Light theme
  6. ⛔ blocked     Screenshots, waiting on the light theme
  7. 📝 todo        Windows check
```

Each state has its own color. "in progress" means it moves on its own; "needs you" means it waits on you.

#### `terms`: names a reply leans on that you have not seen yet

````
```terms
fork: a side call to the model over the same transcript
store: the mod's storage, kept across sessions
```
````

```
Terms
fork: a side call to the model over the same transcript
store: the mod's storage, kept across sessions
```

Terms are pink on a card. Every one is saved to a glossary (up to 300, newest first). `/terms` shows it.

### Two blocks it spots on its own

- An unlabeled fence with counts like `+51 -1` draws the `+` numbers green and the `-` numbers red. Handy for diff sizes.
- An unlabeled fence drawn with box-drawing characters or arrows gets gray lines, blue node names and cream labels.

### Commands

| Command | What it does |
| --- | --- |
| `/explain [question]` | Explains the question, or the text you selected in the chat, in a Reader pane next to the chat |
| `/catchup` | Recaps the session from the start: goal, what is decided, open items numbered, a status block, what comes next |
| `/terms` | Opens the glossary in the Reader pane |

The pane answers come from a fork of the model over the same transcript. The main chat never sees them.

### "Hard to follow?" band

After a reply longer than 20 lines, or with 4 or more inline code names, a band shows above the prompt:

```
Hard to follow?  [Short version]  [From zero]
```

`s` asks for the short version, `z` for an explanation from zero with an example. Both answer in the Reader pane. The hotkeys are letters so a digit typed as an answer never presses a button.

## Notes

- `Mía:` and `Mi recomendación:` are Spanish because my replies read that way. Change `INLINE_MARK` and `PICK` in `reader/hooks/blocks.ts` for your language.
- The colors are constants at the top of `reader/hooks/draw.tsx`.
- Only one mod should redraw Claude's replies (`AssistantMessage`). If you already run one that does, keep one of the two.
- Tests: `claude plugin test ./reader`
