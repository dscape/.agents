import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const legacyRoot = join(homedir(), ".s46");
const canonicalLegacyRoot = canonicalize(legacyRoot);
const absoluteLegacyReference = new RegExp(
  `${legacyRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s"'/:;|&<>])`,
);

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const command = getString(event.input, "command");
      if (
        isLegacyPath(canonicalize(ctx.cwd)) ||
        (command !== undefined && referencesLegacyRoot(command))
      ) {
        notify(ctx, "Blocked shell access to legacy ~/.s46 state");
        return {
          block: true,
          reason:
            "Shell access to ~/.s46 is blocked. Use canonical Git source, XDG state/cache/share paths, or an explicitly reviewed operator workflow outside Pi.",
        };
      }
      return undefined;
    }

    if (event.toolName !== "read" && event.toolName !== "write" && event.toolName !== "edit") {
      return undefined;
    }

    const rawPath = getString(event.input, "path");
    if (rawPath === undefined) return undefined;

    const target = resolveToolPath(ctx.cwd, rawPath);
    if (!isLegacyPath(target)) return undefined;

    if (event.toolName === "read" && !isSensitiveLegacyPath(target)) {
      return undefined;
    }

    const action = event.toolName === "read" ? "read sensitive legacy data from" : "modify";
    notify(ctx, `Blocked attempt to ${action} ${rawPath}`);
    return {
      block: true,
      reason:
        event.toolName === "read"
          ? `Sensitive legacy path "${rawPath}" is protected from agent reads`
          : `Legacy state path "${rawPath}" is read-only and cannot be canonical source`,
    };
  });
}

function getString(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function referencesLegacyRoot(command: string): boolean {
  if (absoluteLegacyReference.test(command)) return true;
  return [
    /(?:^|[\s"'=:(;|&<>])~\/\.s46(?=$|[\s"'/:;|&<>])/,
    /(?:^|[\s"'=:(;|&<>])\$(?:HOME|\{HOME\})\/\.s46(?=$|[\s"'/:;|&<>])/,
    /(?:^|[\s"'=:(;|&<>])\.s46(?=$|[\s"'/:;|&<>])/,
  ].some((pattern) => pattern.test(command));
}

function resolveToolPath(cwd: string, rawPath: string): string {
  const expanded =
    rawPath === "~"
      ? homedir()
      : rawPath.startsWith("~/")
        ? join(homedir(), rawPath.slice(2))
        : rawPath;
  return canonicalize(isAbsolute(expanded) ? expanded : resolve(cwd, expanded));
}

function canonicalize(target: string): string {
  const suffix: string[] = [];
  let cursor = resolve(target);

  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return resolve(target);
    suffix.unshift(basename(cursor));
    cursor = parent;
  }

  try {
    return resolve(realpathSync.native(cursor), ...suffix);
  } catch {
    return resolve(target);
  }
}

function isLegacyPath(target: string): boolean {
  return isWithin(target, canonicalLegacyRoot) || isWithin(resolve(target), legacyRoot);
}

function isWithin(target: string, root: string): boolean {
  const difference = relative(root, target);
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) && difference !== ".." && !isAbsolute(difference))
  );
}

function isSensitiveLegacyPath(target: string): boolean {
  const pathFromRoot = relative(canonicalLegacyRoot, target);
  const segments = pathFromRoot.split(sep);
  const name = basename(target).toLowerCase();

  if (
    segments[0] === "model-keys" ||
    segments[0] === "production-backups" ||
    segments[0] === "release-authority-credentials"
  )
    return true;
  if (
    segments[0] === "airplane-runner-provisioner" &&
    segments.some((segment) => segment.startsWith("production-"))
  )
    return true;
  if (segments.includes("release-broker-production")) return true;
  if (name === "auth.json" || /^models.*\.json$/.test(name)) return true;
  if (
    name === "db-password" ||
    name === "upstream-token" ||
    name === "gateway.env" ||
    name === "image.env"
  )
    return true;
  if (name.endsWith(".env") || name.endsWith(".pem") || name.endsWith(".key")) return true;
  if (/^id_(?:rsa|ecdsa|ed25519)(?!\.pub$)/.test(name)) return true;
  if (/(?:private.*key|key.*private|signing-key|password|secret|token)/.test(name)) return true;
  if (name.endsWith(".log") || name === "stdout" || name === "stderr") return true;
  return false;
}

function notify(
  ctx: { hasUI: boolean; ui: { notify(message: string, level: "warning"): void } },
  message: string,
) {
  if (ctx.hasUI) ctx.ui.notify(message, "warning");
}
