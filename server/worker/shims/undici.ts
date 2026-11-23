/**
 * Workers 用 undici シム。
 * Workers の fetch は undici の dispatcher を使わないため、Agent は接続設定を保持するだけの
 * 互換クラスとして提供する。宛先の検証は validateExternalHttpsUrl が引き続き行い、
 * Cloudflare の fetch はプライベートネットワークへ到達できない。
 */
export class Agent {
  readonly options: unknown;

  constructor(options?: unknown) {
    this.options = options;
  }

  async close(): Promise<void> {}

  async destroy(): Promise<void> {}
}
