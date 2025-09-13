# Yes! Gemini

A wrapper tool that automates interactions with the Gemini CLI by automatically handling common prompts and responses.

⚠️ **Important Security Warning**: Only run this on trusted repositories. This tool automatically responds to prompts and can execute commands without user confirmation. Be aware of potential prompt injection attacks where malicious code or instructions could be embedded in files or user inputs to manipulate the automated responses.

## Features

- Same as `gemini` command
- Automatically responds to common prompts like "Yes, proceed" and "Yes"
- So, this will Let gemini keep run until your task done, and wait for your next prompt.
- You can still Queue More Prompts or Cancel executing task by `ESC` or `Ctrl+C`

## Prerequirements

First, install Gemini CLI globally:

```bash
npm install -g @google/gemini-cli
```

Learn more about Gemini CLI: https://www.google.com/gemini-cli

Then install this project:

```bash
npm install gemini-yes -g
```

## Usage

### gemini-yes cli

```bash
gemini-yes [--exit-on-idle=60s] [gemini-command] [gemini-prompts]
# works exactly same as `gemini` command, and automatically says "Yes" to all yes/no prompts

# e.g.
gemini-yes "run all tests and commit current changes"
bunx gemini-yes "Solve TODO.md"

# Auto-exit when Gemini becomes idle (useful for automation scripts)
gemini-yes --exit-on-idle=60s "run all tests and commit current changes"

# Alternative: use with gemini-code-execute
gemini-code-execute gemini-yes "your task here"
```

The tool will:

1. run Gemini CLI
2. Whenever gemini stucked on yes/no prompts, Automatically say YES, YES, YES, YES, YES to gemini
3. When using `--exit-on-idle` flag, automatically exit when Gemini becomes idle for 3 seconds (useful for automation scripts)

<!-- TODO: add usage As lib: call await geminiYes() and it returns render result -->

## Options

- `--exit-on-idle`: Automatically exit when Gemini becomes idle for 3 seconds. Useful for automation scripts where you want the process to terminate when Gemini finishes its work.

## Implementation

The tool simply mirrors the terminal use node-pty and looks for "❯ 1. Yes" patterns to automatically respond with "\r" to proceed with Gemini's prompts.

```
❯ 1. Yes
  2. No
```

The tool will automatically send "\r" when it detects this pattern.

## Dependencies

- `node-pty` - For spawning and managing the Gemini CLI process

## Inspiration

This project was inspired by the Claude-yes project and adapted for Gemini CLI.

## License

MIT