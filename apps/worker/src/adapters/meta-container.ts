/** Meta recommends checking processing once a minute, for up to five minutes. */
export async function waitForMetaContainer(
  provider: string,
  readStatus: () => Promise<{ statusCode: string }>,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { statusCode } = await readStatus();
    if (statusCode === "FINISHED") return;
    if (statusCode !== "IN_PROGRESS") {
      throw Object.assign(new Error(`${provider} media container is ${statusCode || "missing its processing status"}. The post was not sent.`), { code: "media_processing_failed" });
    }
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 60_000));
  }
  throw Object.assign(new Error(`${provider} media is still processing. The post was not sent; check the media and retry later.`), { code: "media_processing_timeout" });
}
