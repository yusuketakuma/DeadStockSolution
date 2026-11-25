/**
 * Workers 用 readable-stream シム。
 * unzipper は古い Node 向けのフォールバックとしてのみ参照するため、node:stream をそのまま返す。
 */
import stream from 'node:stream';

export = stream;
