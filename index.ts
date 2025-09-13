import { fromReadable, fromWritable } from 'from-node-stream';
import sflow from 'sflow';
import { createIdleWatcher } from './createIdleWatcher';
import { removeControlCharacters } from './removeControlCharacters';
import { sleepms } from './utils';
import { TerminalTextRender } from 'terminal-render';
import { writeFile } from 'fs/promises';
import path from 'path';
import { mkdir } from 'fs/promises';
import { ReadyManager } from './ReadyManager';

/**
 * Main function to run Gemini with automatic yes/no responses
 * @param options Configuration options
 * @param options.continueOnCrash - If true, automatically restart Gemini when it crashes:
 *   1. Shows message 'Gemini crashed, restarting..'
 *   2. Spawns a new 'gemini --continue' process
 *   3. Re-attaches the new process to the shell stdio (pipes new process stdin/stdout)
 *   4. If it crashes with "No conversation found to continue", exits the process
 * @param options.exitOnIdle - Exit when Gemini is idle. Boolean or timeout in milliseconds
 * @param options.geminiArgs - Additional arguments to pass to the Gemini CLI
 * @param options.removeControlCharactersFromStdout - Remove ANSI control characters from stdout. Defaults to !process.stdout.isTTY
 */
export default async function geminiYes({
  geminiArgs = [],
  continueOnCrash,
  cwd,
  env,
  exitOnIdle = 60e3,
  logFile,
  removeControlCharactersFromStdout = false, // = !process.stdout.isTTY,
  verbose = false,
}: {
  geminiArgs?: string[];
  continueOnCrash?: boolean;
  cwd?: string;
  env?: Record<string, string>;
  exitOnIdle?: number;
  logFile?: string;
  removeControlCharactersFromStdout?: boolean;
  verbose?: boolean;
} = {}) {
  if (verbose) {
    console.log('calling geminiYes: ', {
      continueOnCrash,
      exitOnIdle,
      geminiArgs,
      cwd,
      removeControlCharactersFromStdout,
      logFile,
      verbose,
    });
  }
  console.log(
    '⭐ Starting gemini, automatically responding to yes/no prompts...'
  );
  console.log(
    '⚠️ Important Security Warning: Only run this on trusted repositories. This tool automatically responds to prompts and can execute commands without user confirmation. Be aware of potential prompt injection attacks where malicious code or instructions could be embedded in files or user inputs to manipulate the automated responses.'
  );

  process.stdin.setRawMode?.(true); //must be called any stdout/stdin usage
  const prefix = ''; // "YESC|"
  const PREFIXLENGTH = prefix.length;
  let errorNoConversation = false; // match 'No conversation found to continue'
  const shellReady = new ReadyManager();

  const shellOutputStream = new TransformStream<string, string>();
  const outputWriter = shellOutputStream.writable.getWriter();
  // const pty = await import('node-pty');

  // recommened to use bun pty in windows
  const pty = process.versions.bun
    ? await import('bun-pty')
    : await import('node-pty');

  const getPtyOptions = () => ({
    name: 'xterm-color',
    cols: process.stdout.columns - PREFIXLENGTH,
    rows: process.stdout.rows,
    cwd: cwd ?? process.cwd(),
    env: env ?? (process.env as Record<string, string>),
  });
  let shell = pty.spawn('gemini', geminiArgs, getPtyOptions());
  let pendingExitCode = Promise.withResolvers<number | null>();
  let pendingExitCodeValue = null;

  // TODO handle error if gemini is not installed, show msg:
  // npm install -g @google/gemini-cli

  async function onData(data: string) {
    // append data to the buffer, so we can process it later
    await outputWriter.write(data);
    shellReady.ready(); // shell has output, also means ready for stdin
  }

  shell.onData(onData);
  shell.onExit(function onExit({ exitCode }) {
    shellReady.unready(); // start buffer stdin
    const geminiCrashed = exitCode !== 0;
    if (geminiCrashed && continueOnCrash) {
      if (errorNoConversation) {
        console.log(
          'Gemini crashed with "No conversation found to continue", exiting...'
        );
        return pendingExitCode.resolve((pendingExitCodeValue = exitCode));
      }
      console.log('Gemini crashed, restarting...');

      shell = pty.spawn('gemini', ['--continue', 'continue'], getPtyOptions());
      shell.onData(onData);
      shell.onExit(onExit);
      return;
    }
    return pendingExitCode.resolve((pendingExitCodeValue = exitCode));
  });

  const exitGeminiCode = async () => {
    continueOnCrash = false;
    // send exit command to the shell, must sleep a bit to avoid gemini treat it as pasted input
    await sflow(['\r', '/exit', '\r'])
      .forEach(async () => await sleepms(200))
      .forEach(async (e) => shell.write(e))
      .run();

    // wait for shell to exit or kill it with a timeout
    let exited = false;
    await Promise.race([
      pendingExitCode.promise.then(() => (exited = true)), // resolve when shell exits
      // if shell doesn't exit in 5 seconds, kill it
      new Promise<void>((resolve) =>
        setTimeout(() => {
          if (exited) return; // if shell already exited, do nothing
          shell.kill(); // kill the shell process if it doesn't exit in time
          resolve();
        }, 5000)
      ), // 5 seconds timeout
    ]);
  };

  // when current tty resized, resize the pty
  process.stdout.on('resize', () => {
    const { columns, rows } = process.stdout;
    shell.resize(columns - PREFIXLENGTH, rows);
  });

  const render = new TerminalTextRender();
  const idleWatcher = !exitOnIdle
    ? null
    : createIdleWatcher(async () => {
        if (
          render
            .render()
            .replace(/\s+/g, ' ')
            .match(/esc to interrupt|to run in background/)
        ) {
          console.log(
            '[gemini-yes] Gemini is idle, but seems still working, not exiting yet'
          );
        } else {
          console.log('[gemini-yes] Gemini is idle, exiting...');
          await exitGeminiCode();
        }
      }, exitOnIdle);
  const confirm = async () => {
    await sleepms(200);
    shell.write('\r');
  };

  sflow(fromReadable<Buffer>(process.stdin))
    .map((buffer) => buffer.toString())
    // .forEach(e => appendFile('.cache/io.log', "input |" + JSON.stringify(e) + '\n')) // for debugging
    // pipe
    .by({
      writable: new WritableStream<string>({
        write: async (data) => {
          await shellReady.wait();
          shell.write(data);
        },
      }),
      readable: shellOutputStream.readable,
    })
    // handle terminal render
    .forEach((text) => render.write(text))

    // handle idle
    .forEach(() => idleWatcher?.ping()) // ping the idle watcher on output for last active time to keep track of gemini status
    // auto-response
    .forkTo((e) =>
      e
        .map((e) => removeControlCharacters(e as string))
        .map((e) => e.replaceAll('\r', '')) // remove carriage return
        .forEach(async (e) => {
          if (e.match(/❯ 1. Yes/)) return await confirm();
          if (e.match(/❯ 1. Dark mode✔|Press Enter to continue…/))
            return await confirm();
          if (e.match(/No conversation found to continue/)) {
            errorNoConversation = true; // set flag to true if error message is found
            return;
          }
        })
        // .forEach(e => appendFile('.cache/io.log', "output|" + JSON.stringify(e) + '\n')) // for debugging
        .run()
    )
    .replaceAll(/.*(?:\r\n?|\r?\n)/g, (line) => prefix + line) // add prefix
    .map((e) =>
      removeControlCharactersFromStdout ? removeControlCharacters(e) : e
    )
    .to(fromWritable(process.stdout));

  const exitCode = await pendingExitCode.promise; // wait for the shell to exit
  console.log(`[gemini-yes] gemini exited with code ${exitCode}`);

  if (logFile) {
    verbose && console.log(`[gemini-yes] Writing rendered logs to ${logFile}`);
    const logFilePath = path.resolve(logFile);
    await mkdir(path.dirname(logFilePath), { recursive: true }).catch(
      () => null
    );
    await writeFile(logFilePath, render.render());
  }

  return { exitCode, logs: render.render() };
}

export { removeControlCharacters };