/**
 * Workers バンドルに含めないオプショナル依存の代替。
 * unzipper の S3 読込など、本アプリが使わないコードパスからのみ参照される。
 */
throw new Error('This optional module is not available on Cloudflare Workers');
