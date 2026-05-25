const https = require("node:https");

function normalizeChannel(channel) {
  return String(channel || "").trim().toLowerCase();
}

function getChannelConfig(channel) {
  const normalized = normalizeChannel(channel);
  switch (normalized) {
    case "nightly":
      return { channel: "nightly", titlePrefix: "Nightly Release", color: 3447003 };
    case "weekly":
      return { channel: "weekly", titlePrefix: "Weekly Release", color: 15844367 };
    case "stable":
      return { channel: "stable", titlePrefix: "Stable Release", color: 3066993 };
    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}

function selectWebhookUrl(channel, webhooks) {
  const { channel: normalized } = getChannelConfig(channel);
  const webhookUrl = (webhooks && webhooks[normalized]) || "";
  if (!webhookUrl) {
    throw new Error(`Missing Discord webhook URL for channel: ${normalized}`);
  }
  return webhookUrl;
}

function buildPayload({ channel, tag, releaseUrl }) {
  const version = String(tag || "").replace(/^v/, "");
  const config = getChannelConfig(channel);
  return {
    content: "",
    embeds: [
      {
        title: `${config.titlePrefix}: v${version}`,
        description: `A new **${config.channel}** build is available.`,
        color: config.color,
        fields: [
          { name: "Version", value: `\`${version}\``, inline: true },
          { name: "Channel", value: `\`${config.channel}\``, inline: true },
          { name: "Downloads", value: `[Open GitHub Release](${releaseUrl})`, inline: false },
        ],
      },
    ],
  };
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => {
          responseBody += chunk.toString();
        });
        response.on("end", () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve();
            return;
          }
          reject(
            new Error(`Discord webhook request failed (${response.statusCode || "unknown"}): ${responseBody}`)
          );
        });
      }
    );
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function main() {
  const channel = process.env.CHANNEL || "";
  const tag = process.env.TAG || "";
  const releaseUrl = process.env.RELEASE_URL || "";
  if (!tag) {
    throw new Error("Missing TAG environment variable.");
  }
  if (!releaseUrl) {
    throw new Error("Missing RELEASE_URL environment variable.");
  }

  const webhooks = {
    nightly: process.env.NIGHTLY_WEBHOOK || "",
    weekly: process.env.WEEKLY_WEBHOOK || "",
    stable: process.env.STABLE_WEBHOOK || "",
  };

  const webhookUrl = selectWebhookUrl(channel, webhooks);
  const payload = buildPayload({ channel, tag, releaseUrl });
  await postJson(webhookUrl, payload);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildPayload,
  getChannelConfig,
  normalizeChannel,
  selectWebhookUrl,
};
