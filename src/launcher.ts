// Desktop and Start Menu shortcut / launcher generator
// Creates windowless app launcher shortcuts for Windows, macOS, and Linux.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export interface ShortcutOptions {
  desktop: boolean;
  startMenu: boolean;
  customDesktopDir?: string;
  customStartMenuDir?: string;
  execPath?: string;
  cliPath?: string;
}

export interface ShortcutPaths {
  desktop: string;
  startMenu: string;
}

export interface ShortcutResult {
  created: string[];
  errors: string[];
}

export function parseShortcutArgs(args: string[]): { desktop: boolean; startMenu: boolean } {
  let desktop = false;
  let startMenu = false;
  for (const arg of args) {
    if (arg === "--desktop") desktop = true;
    else if (arg === "--start-menu") startMenu = true;
  }
  // Default to desktop shortcut if neither flag was specified
  if (!desktop && !startMenu) {
    desktop = true;
  }
  return { desktop, startMenu };
}

export function resolveShortcutPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): ShortcutPaths {
  const p = platform === "win32" ? win32 : posix;

  if (platform === "win32") {
    const userProfile = env.USERPROFILE || homedir();
    const appData = env.APPDATA || p.join(userProfile, "AppData", "Roaming");
    return {
      desktop: p.join(userProfile, "Desktop"),
      startMenu: p.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    };
  }

  if (platform === "darwin") {
    const home = env.HOME || homedir();
    return {
      desktop: p.join(home, "Desktop"),
      startMenu: p.join(home, "Applications"),
    };
  }

  // Linux / POSIX
  const home = env.HOME || homedir();
  const desktop = env.XDG_DESKTOP_DIR || p.join(home, "Desktop");
  const dataHome = env.XDG_DATA_HOME || p.join(home, ".local", "share");
  return {
    desktop,
    startMenu: p.join(dataHome, "applications"),
  };
}

/** Real Desktop / Start Menu folders on Windows: OneDrive or a localized profile can move them away from %USERPROFILE%\Desktop. */
export function windowsShellFolders(): ShortcutPaths | undefined {
  const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('Programs')"],
    { windowsHide: true, encoding: "utf-8" });
  const [desktop, startMenu] = (ps.stdout ?? "").split(/\r?\n/).map(s => s.trim());
  return ps.status === 0 && desktop && startMenu ? { desktop, startMenu } : undefined;
}

export function getDefaultCliPath(): string {
  // Points to bin/agent-company.js relative to this file
  return resolve(dirname(fileURLToPath(import.meta.url)), "../bin/agent-company.js");
}

export function generateShortcutScript(
  platform: NodeJS.Platform,
  opts: {
    execPath: string;
    cliPath: string;
    targetLnkPath: string;
    workingDir: string;
  }
): string {
  if (platform === "win32") {
    // Generate PowerShell script using WScript.Shell to create .lnk
    // The target is powershell.exe running hidden, launching Node directly without console window
    const sanitizedTarget = opts.targetLnkPath.replace(/'/g, "''");
    const sanitizedExec = opts.execPath.replace(/'/g, "''");
    const sanitizedCli = opts.cliPath.replace(/'/g, "''");
    const sanitizedWork = opts.workingDir.replace(/'/g, "''");

    const psCommand = `Start-Process -FilePath '${sanitizedExec}' -ArgumentList '\\"${sanitizedCli}\\" start' -WindowStyle Hidden`;
    const psArguments = `-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "${psCommand}"`;

    return [
      `$w = New-Object -ComObject WScript.Shell`,
      `$s = $w.CreateShortcut('${sanitizedTarget}')`,
      `$s.TargetPath = 'powershell.exe'`,
      `$s.Arguments = '${psArguments.replace(/'/g, "''")}'`,
      `$s.WorkingDirectory = '${sanitizedWork}'`,
      `$s.Description = 'Agent Company - AI Team in a Pixel Office'`,
      `$s.Save()`,
    ].join("\r\n");
  }

  if (platform === "darwin") {
    // macOS .command launcher
    return [
      "#!/bin/bash",
      `cd "${opts.workingDir}"`,
      `"${opts.execPath}" "${opts.cliPath}" start &`,
      "exit 0",
    ].join("\n");
  }

  // Linux .desktop file
  return [
    "[Desktop Entry]",
    "Version=1.0",
    "Type=Application",
    "Name=Agent Company",
    "Comment=AI Team in a Pixel Office",
    `Exec="${opts.execPath}" "${opts.cliPath}" start`,
    "Terminal=false",
    "Categories=Development;Office;",
  ].join("\n");
}

export async function createShortcut(opts: ShortcutOptions): Promise<ShortcutResult> {
  const result: ShortcutResult = { created: [], errors: [] };
  const platform = process.platform;
  const paths = (platform === "win32" && windowsShellFolders()) || resolveShortcutPaths(platform);

  const targets: { dir: string; filename: string }[] = [];
  const ext = platform === "win32" ? ".lnk" : platform === "darwin" ? ".command" : ".desktop";
  const baseName = "Agent Company";

  if (opts.desktop) {
    targets.push({
      dir: opts.customDesktopDir || paths.desktop,
      filename: `${baseName}${ext}`,
    });
  }
  if (opts.startMenu) {
    targets.push({
      dir: opts.customStartMenuDir || paths.startMenu,
      filename: `${baseName}${ext}`,
    });
  }

  const execPath = opts.execPath || process.execPath;
  const cliPath = opts.cliPath || getDefaultCliPath();
  const workingDir = homedir();

  for (const t of targets) {
    try {
      if (!existsSync(t.dir)) {
        mkdirSync(t.dir, { recursive: true });
      }
      const targetPath = join(t.dir, t.filename);

      if (platform === "win32") {
        const psScript = generateShortcutScript("win32", {
          execPath,
          cliPath,
          targetLnkPath: targetPath,
          workingDir,
        });
        const ps = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript], {
          windowsHide: true,
          encoding: "utf-8",
        });
        if (ps.status !== 0 || !existsSync(targetPath)) {
          throw new Error(ps.stderr?.trim() || `PowerShell exit code ${ps.status}`);
        }
      } else {
        const content = generateShortcutScript(platform, {
          execPath,
          cliPath,
          targetLnkPath: targetPath,
          workingDir,
        });
        writeFileSync(targetPath, content, { encoding: "utf-8" });
        try {
          chmodSync(targetPath, 0o755);
        } catch {
          // ignore chmod errors on unsupported filesystems
        }
      }

      result.created.push(targetPath);
    } catch (err) {
      result.errors.push(`${t.dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

export async function runShortcutCommand(args: string[]): Promise<number> {
  const parsed = parseShortcutArgs(args);
  console.log("Đang tạo lối tắt mở nhanh ứng dụng Agent Company...");
  const res = await createShortcut(parsed);

  for (const c of res.created) {
    console.log(`✔ Đã tạo lối tắt: ${c}`);
  }
  for (const e of res.errors) {
    console.error(`✖ Không thể tạo lối tắt tại: ${e}`);
  }

  if (res.created.length > 0) {
    console.log("\n✨ Xong! Bây giờ bạn chỉ cần click đúp vào biểu tượng để mở app mà không hiện cửa sổ đen.");
    return 0;
  }
  return 1;
}
