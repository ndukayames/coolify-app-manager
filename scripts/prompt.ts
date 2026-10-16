import { createInterface } from "node:readline";

// Reads a secret without echoing it, so tokens stay out of shell history and scrollback.
// Falls back to reading piped stdin when not attached to a terminal.
export const promptSecret = (question: string): Promise<string> =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    const writable = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    writable._writeToOutput = (text) => {
      if (!muted) writable.output.write(text);
    };

    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });

export const parseArgs = (argv: string[]): Record<string, string> => {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag.startsWith("--")) args[flag.slice(2)] = argv[index + 1] ?? "";
  }
  return args;
};
