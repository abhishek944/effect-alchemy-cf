import { ChatHostPortEnv, ChatHostTokenEnv } from "@highchat/chat-runtime";

/** Process configuration. Both values are required; the host invents no defaults. */
export interface Config {
  readonly port: number;
  readonly token: string;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};

export const readConfig = (): Config => {
  const rawPort = required(ChatHostPortEnv);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${ChatHostPortEnv} must be an integer TCP port`);
  }
  return { port, token: required(ChatHostTokenEnv) };
};
