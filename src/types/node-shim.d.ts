declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
  exit: (code?: number) => never;
};

declare class Buffer extends Uint8Array {
  static from(value: string | ArrayBuffer | ArrayBufferView, encoding?: string): Buffer;
  static concat(chunks: Uint8Array[]): Buffer;
  static isBuffer(value: unknown): value is Buffer;
  toString(encoding?: string): string;
}

declare namespace NodeJS {
  type Timeout = number & {
    unref(): void;
  };
}

declare function setTimeout(
  handler: (...args: any[]) => void,
  timeout?: number,
  ...args: any[]
): NodeJS.Timeout;
declare function setInterval(
  handler: (...args: any[]) => void,
  timeout?: number,
  ...args: any[]
): NodeJS.Timeout;
declare function setImmediate(handler: (...args: any[]) => void, ...args: any[]): NodeJS.Timeout;

declare module "node:crypto" {
  export function createCipheriv(...args: any[]): any;
  export function createDecipheriv(...args: any[]): any;
  export function createHash(...args: any[]): any;
  export function randomBytes(...args: any[]): any;
  export function randomUUID(): string;
  export function scryptSync(...args: any[]): any;
  export function timingSafeEqual(...args: any[]): boolean;
}

declare module "node:fs" {
  export function createReadStream(...args: any[]): any;
  export function existsSync(...args: any[]): boolean;
  export function mkdirSync(...args: any[]): void;
  export function mkdtempSync(...args: any[]): string;
  export function readFileSync(...args: any[]): string;
  export function rmSync(...args: any[]): void;
  export function statSync(...args: any[]): any;
}

declare module "node:http" {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: string, listener: (...args: any[]) => void): void;
    [Symbol.asyncIterator](): AsyncIterableIterator<Buffer>;
  }
  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string | number | readonly string[]): void;
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    end(chunk?: any): void;
  }
  const http: any;
  export default http;
}

declare module "node:module" {
  export function createRequire(url: string | URL): any;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function basename(...args: any[]): string;
  export function dirname(...args: any[]): string;
  export function extname(...args: any[]): string;
  export function join(...args: any[]): string;
  export function resolve(...args: any[]): string;
}

declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(...args: any[]);
    prepare(...args: any[]): any;
    exec(...args: any[]): any;
    close(...args: any[]): void;
  }
}

declare module "node:stream" {
  export const Readable: any;
}

declare module "node:url" {
  export const URL: typeof globalThis.URL;
  export function fileURLToPath(url: string | URL): string;
}
