/**
 * Offload executor: runs scripts as child processes outside the LLM
 * context window, capturing stdout, stderr, exit code, and timing.
 *
 * Supports bash, node, python, and custom script types. Each execution
 * writes the script to a temp file, spawns an interpreter, and collects
 * results. Timeout enforcement kills long-running scripts.
 *
 * The OffloadExecutor class wraps executeOffloadOp with optional signal
 * bus integration for notifying downstream consumers on completion.
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdtemp, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OffloadOperation, OffloadResult } from './types.js';
import { SignalBus, createCompletionSignal } from './signals.js';

/** Map script types to file extensions. */
const SCRIPT_EXTENSIONS: Record<string, string> = {
  bash: '.sh',
  node: '.js',
  python: '.py',
  custom: '.sh',
};

/** Map script types to interpreters. */
const INTERPRETERS: Record<string, string> = {
  bash: 'bash',
  node: 'node',
  python: 'python3',
};

/**
 * Execute an OffloadOperation as a child process.
 *
 * Writes the script to a temporary file, spawns the appropriate
 * interpreter, captures stdout/stderr, and enforces the timeout.
 *
 * @param operation - The offload operation to execute
 * @returns Execution result with exit code, output, and timing
 */
export async function executeOffloadOp(operation: OffloadOperation): Promise<OffloadResult> {
  // Create a temp directory for the script file
  const scriptDir = await mkdtemp(join(tmpdir(), 'offload-exec-'));
  const ext = SCRIPT_EXTENSIONS[operation.scriptType] ?? '.sh';
  const scriptPath = join(scriptDir, `script${ext}`);

  // Write script content to temp file
  await writeFile(scriptPath, operation.script, { mode: 0o755 });

  // For bash/custom, ensure executable (chmod is a no-op on Windows NTFS; skip explicitly)
  if ((operation.scriptType === 'bash' || operation.scriptType === 'custom') && process.platform !== 'win32') {
    await chmod(scriptPath, 0o755);
  }

  // Determine spawn arguments
  let command: string;
  let args: string[];

  if (operation.scriptType === 'custom') {
    command = scriptPath;
    args = [];
  } else {
    command = INTERPRETERS[operation.scriptType] ?? 'bash';
    args = [scriptPath];
  }

  const startTime = Date.now();
  let timedOut = false;

  return new Promise<OffloadResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: operation.workingDir || '.',
      env: { ...process.env, ...operation.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Set up timeout enforcement -- kill the entire process group
    // so that child processes (e.g., sleep) are also terminated
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== 'win32') {
        // Unix: kill the entire process group so child processes are also terminated
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          // Process may have already exited
          child.kill('SIGTERM');
        }
      } else {
        // Windows: process groups not supported; kill the direct child
        // child.kill() maps SIGTERM to force-terminate on Windows
        child.kill('SIGTERM');
      }
    }, operation.timeout);

    child.on('close', (code: number | null) => {
      clearTimeout(timer);

      // Clean up temp file (fire-and-forget)
      unlink(scriptPath).catch(() => {});

      resolve({
        operationId: operation.id,
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        timedOut,
      });
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);

      // Clean up temp file (fire-and-forget)
      unlink(scriptPath).catch(() => {});

      resolve({
        operationId: operation.id,
        exitCode: -1,
        stdout,
        stderr: stderr + err.message,
        durationMs: Date.now() - startTime,
        timedOut: false,
      });
    });
  });
}

/**
 * Offload executor with optional signal bus integration.
 *
 * Wraps executeOffloadOp and emits completion signals to an attached
 * SignalBus after each execution finishes. This allows downstream
 * consumers (e.g., Copper synchronization) to react to offload completions
 * without tight coupling.
 */
export class OffloadExecutor {
  private signalBus?: SignalBus;

  /**
   * @param signalBus - Optional bus for emitting completion signals
   */
  constructor(signalBus?: SignalBus) {
    this.signalBus = signalBus;
  }

  /**
   * Execute an offload operation and optionally emit a completion signal.
   *
   * @param operation - The operation to execute
   * @returns Execution result
   */
  async execute(operation: OffloadOperation): Promise<OffloadResult> {
    const result = await executeOffloadOp(operation);

    if (this.signalBus) {
      const signal = createCompletionSignal(result);
      this.signalBus.emit(signal);
    }

    return result;
  }
}
