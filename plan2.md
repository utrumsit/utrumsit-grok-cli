# Plan for Beautiful and Useful Grok CLI UI

## Goal

Create a clean, Claude Code-inspired terminal UI: stable, beautiful (light theme default, literate code rendering), useful (autocomplete, highlighting, headless support, emoji-free for pandoc). Prioritize stability—no errors/flicker. Use chalk for basic highlighting (skip tree-sitter to avoid deps issues). Test in iTerm2/Ghostty.

## Prerequisites

- Working directory: /Users/karlschudt/utrumsit-grok-cli
- Stable state: After git reset --hard main, no build errors.
- Tools: Bash for installs/builds, Edit for code, Read for verification.

## Step-by-Step Plan

### Step 1: Ensure Stable Build and Clean State

- Run `git reset --hard main` to restore stable files.
- Clean: `rm -rf dist node_modules/.cache && npm install`.
- Build: `npm run build` (expect success, no errors).
- Test: `npm run start` (expect banner, input prompt, no crash/flicker).
- Mark done when build succeeds and app runs.

### Step 2: Add Initial Greeting

- Edit src/ui/components/chat-interface.tsx: Add initialGreeting to useState<ChatEntry[]>([initialGreeting]).
- Greeting content: Single-line "Hello! I'm Grok CLI... What can I help with?" to avoid multiline issues.
- Remove console.clear() to prevent flicker.
- Build and test: Greeting shows in chat area, no errors.
- Mark done when greeting displays without crash.

### Step 3: Implement Light Theme Toggle

- Edit src/ui/colors.js: Add lightColors (soft black text, blue accents, green success) and getColors(theme) function.
- Edit src/utils/settings-manager.ts: Add theme: 'light' | 'dark' to Settings, default 'light'.
- Edit src/ui/components/chat-interface.tsx: Use useSettings hook, apply colors = getColors(settings.theme) to <Text color={colors.primary}> etc.
- Add /theme command in useInputHandler: Toggle light/dark, update settings.
- Build and test: /theme light → soft colors; /theme dark → original.
- Mark done when toggle works smoothly in iTerm2/Ghostty.

### Step 4: Add Basic Autocomplete for /commands

- Create src/ui/components/command-suggestions.tsx: Simple dropdown <Box> with suggestions, selectedIndex highlighting.
- Edit src/hooks/use-input-handler.ts: On input.startsWith('/'), filter commands (['/help', '/models', '/heal', '/init-agent', '/theme']), set showCommandSuggestions=true, render <CommandSuggestions /> below input.
- Arrow keys/Tab to select, Enter to complete input.
- Build and test: Type /h → dropdown with /help; select/complete.
- Mark done when autocomplete dropdown appears and works.

### Step 5: Add Basic Syntax Highlighting with Chalk

- Install chalk if missing: `npm install chalk`.
- Edit src/ui/components/chat-history.tsx: In assistant case, detect code blocks (`lang code `), use chalk to color keywords (e.g., chalk.blue('function')) for literate look.
- Fallback: Plain text if no chalk.
- Build and test: Type "Write TS function" → response code with blue "function"/"const".
- Mark done when keywords are colored in code blocks.

### Step 6: Emoji-Free Markdown Output

- Edit src/ui/utils/markdown-renderer.tsx: Add stripEmojis function (regex to remove emojis), apply to content before <Text>{stripped}</Text>.
- Build and test: Assistant response with emoji → plain text (e.g., ":smile:" instead of 😊).
- Mark done when output is pandoc-ready (no emojis).

### Step 7: Enhance Headless Mode

- Edit src/index.ts: If --prompt, process message; if --json, output JSON.stringify(result, null, 2); else plain content.
- Build and test: `npm run start -- --prompt "hello" --json` → JSON; without --json → plain text.
- Mark done when headless outputs JSON/plain cleanly.

### Step 8: Test and Polish in iTerm2/Ghostty

- Run `npm run start` in iTerm2: Check light theme (soft colors), no flicker, highlighting visible.
- Run in Ghostty: Same checks.
- Polish: Adjust colors if harsh, ensure literate code (indented, colored).
- Mark done when UI is beautiful/useful in both terminals.

### Step 9: Add Advanced Features (If Stable)

- Tooltip (Ctrl+I): Context details popup.
- Plan Mode (Shift+Tab): Read-only toggle.
- Full tree-sitter if deps resolve (optional).

## Success Criteria

- App runs without errors/flicker.
- Light theme soft, toggle works.
- Autocomplete dropdown functional.
- Code highlighted (blue keywords).
- Output emoji-free for pandoc.
- Headless JSON/plain works.
- Beautiful: Clean lines, literate code, useful info (tokens, files).

## Rollback

If issues, `git reset --hard main && rm -rf dist && npm install && npm run build`.

Date: Wed Nov 12 2025
