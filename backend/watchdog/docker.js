// @ts-check
/**
 * @file The few Docker calls the watchdog needs, made straight to the
 * Docker socket: find the tunnel container, read its last log lines,
 * restart it — and, for the last resort, run one command on the host.
 *
 * The watchdog itself runs without extra privileges. Restarting the box
 * is done by a separate, short-lived container that enters the host and
 * runs `systemctl reboot` (a normal, clean restart), so that privilege
 * exists only for the seconds it's used.
 */
import http from "node:http";

export const WATCHDOG_LABEL = "app.zephyrly.watchdog";
export const HELPER_LABEL = "app.zephyrly.watchdog-helper";

/** Run a command as the host itself (its mounts, hostname, IPC, network). */
const ON_HOST = ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "--"];
/** Harmless: asks the host's systemd a question over the same channel a restart uses. */
export const CHECK_COMMAND = [...ON_HOST, "systemctl", "show", "--property=SystemState"];
export const REBOOT_COMMAND = [...ON_HOST, "systemctl", "reboot"];

/**
 * Docker sends container logs as frames: an 8-byte header (stream, three
 * zero bytes, big-endian length) then the text. Containers with a TTY
 * send plain text instead.
 *
 * @param {Buffer} raw
 */
export function demuxLogs(raw) {
  const framed = raw.length >= 8 && raw[0] <= 2 && raw[1] === 0 && raw[2] === 0 && raw[3] === 0;
  if (!framed) return raw.toString("utf8");
  let text = "";
  for (let offset = 0; offset + 8 <= raw.length; ) {
    const length = raw.readUInt32BE(offset + 4);
    text += raw.subarray(offset + 8, offset + 8 + length).toString("utf8");
    offset += 8 + length;
  }
  return text;
}

/**
 * @param {{ socketPath?: string, timeoutMs?: number }} [options]
 */
export function createDockerClient({ socketPath = "/var/run/docker.sock", timeoutMs = 20_000 } = {}) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @param {number} [deadlineMs]
   * @returns {Promise<{ status: number, raw: Buffer }>}
   */
  const call = (method, path, body, deadlineMs = timeoutMs) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const request = http.request(
        {
          socketPath,
          path,
          method,
          headers: payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {},
        },
        (/** @type {any} */ response) => {
          /** @type {Buffer[]} */
          const chunks = [];
          response.on("data", (/** @type {Buffer} */ chunk) => chunks.push(chunk));
          response.on("end", () => {
            clearTimeout(timer);
            resolve({ status: Number(response.statusCode) || 0, raw: Buffer.concat(chunks) });
          });
          response.on("error", reject);
        }
      );
      const timer = setTimeout(() => request.destroy(new Error(`Docker didn't answer within ${Math.round(deadlineMs / 1000)}s`)), deadlineMs);
      request.on("error", (/** @type {Error} */ error) => {
        clearTimeout(timer);
        reject(error);
      });
      request.end(payload ?? undefined);
    });

  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @param {number} [deadlineMs]
   */
  const json = async (method, path, body, deadlineMs) => {
    const { status, raw } = await call(method, path, body, deadlineMs);
    const text = raw.toString("utf8");
    if (status < 200 || status >= 300) {
      let message = text.trim();
      try {
        message = JSON.parse(text).message || message;
      } catch {
        // Not JSON; use the text.
      }
      throw new Error(`Docker ${method} ${path.split("?")[0]} failed (${status}): ${message.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : null;
  };

  /** @param {string[]} labels */
  const listByLabels = (labels) =>
    json("GET", `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: labels }))}`);

  return {
    /**
     * This container: the image it runs (reused for the host helper, so
     * nothing ever has to be downloaded mid-incident) and its compose
     * project (so only this project's tunnel is ever touched).
     *
     * @param {string | null} containerId  from /proc, when it could be read
     * @returns {Promise<{ image: string, project: string } | null>}
     */
    async self(containerId) {
      /** @type {any} */
      let info = null;
      if (containerId) {
        try {
          info = await json("GET", `/containers/${containerId}/json`);
        } catch {
          info = null;
        }
      }
      if (!info) {
        const mine = (await listByLabels([`${WATCHDOG_LABEL}=true`])).filter((/** @type {any} */ c) => c.State === "running");
        if (mine.length !== 1) return null;
        info = await json("GET", `/containers/${mine[0].Id}/json`);
      }
      const image = String(info?.Image || "");
      const project = String(info?.Config?.Labels?.["com.docker.compose.project"] || "");
      return image && project ? { image, project } : null;
    },

    /**
     * The tunnel container of this compose project, if there is exactly one.
     *
     * @param {string} project
     * @param {string} service
     * @returns {Promise<{ id: string, name: string, state: string } | null>}
     */
    async findService(project, service) {
      const found = await listByLabels([`com.docker.compose.project=${project}`, `com.docker.compose.service=${service}`]);
      if (found.length !== 1) return null;
      return { id: found[0].Id, name: String(found[0].Names?.[0] || found[0].Id).replace(/^\//, ""), state: String(found[0].State || "") };
    },

    /**
     * @param {string} id
     * @param {number} lines
     */
    async tailLogs(id, lines) {
      const { status, raw } = await call("GET", `/containers/${id}/logs?stdout=1&stderr=1&tail=${lines}`);
      if (status !== 200) throw new Error(`Docker logs failed (${status})`);
      return demuxLogs(raw).split("\n").map((line) => line.trimEnd()).filter(Boolean);
    },

    /** @param {string} id */
    async restart(id) {
      // Docker waits up to 10s for a clean stop before forcing it.
      await json("POST", `/containers/${id}/restart?t=10`, undefined, 60_000);
    },

    /**
     * Run one command as the host, in a short-lived privileged container
     * with no network. With `wait`, resolves to its exit code and removes
     * the container; without, returns once it has started (a reboot never
     * reports back).
     *
     * @param {string} image
     * @param {string[]} command
     * @param {{ wait: boolean }} options
     * @returns {Promise<number | null>}
     */
    async runOnHost(image, command, { wait }) {
      const created = await json("POST", "/containers/create", {
        Image: image,
        Entrypoint: [command[0]],
        Cmd: command.slice(1),
        Labels: { [HELPER_LABEL]: "true" },
        HostConfig: { Privileged: true, PidMode: "host", NetworkMode: "none", AutoRemove: !wait },
      });
      const id = created.Id;
      await json("POST", `/containers/${id}/start`);
      if (!wait) return null;
      try {
        const done = await json("POST", `/containers/${id}/wait`, undefined, 60_000);
        return Number(done?.StatusCode);
      } finally {
        await call("DELETE", `/containers/${id}?force=1`).catch(() => {});
      }
    },

    /** Clear away helpers left by an earlier run (e.g. across a reboot). */
    async removeHelpers() {
      const leftovers = await listByLabels([`${HELPER_LABEL}=true`]);
      for (const container of leftovers) {
        await call("DELETE", `/containers/${container.Id}?force=1`).catch(() => {});
      }
      return leftovers.length;
    },
  };
}
