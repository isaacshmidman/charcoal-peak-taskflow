// @ts-nocheck
/**
 * @file "Export your data" sub-page: one button that downloads a ZIP of
 * everything the user has (see backend/export.js for the contents).
 *
 * The download is a plain link to the export URL, the same way
 * attachments download: the browser sends the session cookie, streams the
 * file straight to disk, and shows its own progress — the server sends a
 * Content-Length — instead of this page holding up to a gigabyte in
 * memory.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileJson, FileSpreadsheet, FileText, Paperclip, ShieldCheck } from "lucide-react";
import { apiClient, exportDownloadUrl } from "@/api/apiClient";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Long enough to cover a double-tap and the server starting the stream;
// the server refuses a second concurrent export anyway.
const RESTART_DELAY_MS = 8000;

/** SI units, matching StorageSection. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

const CONTENTS = [
  { icon: FileJson, name: "data.json", text: "Everything, complete: tasks and subtasks, notes, priorities, tags, Recently Deleted, settings and connected calendars." },
  { icon: FileSpreadsheet, name: "tasks.csv", text: "Your tasks, ready for Excel, Numbers or Google Sheets." },
  { icon: FileText, name: "notes", text: "Each note as its own text file." },
  { icon: Paperclip, name: "attachments", text: "The files on your tasks, one folder per task." },
];

export default function ExportSection() {
  const online = useOnlineStatus();
  const [started, setStarted] = useState(false);
  // Attachment bytes dominate the size; the rest is a few hundred KB.
  const { data: usage } = useQuery({
    queryKey: ["storageUsage"],
    queryFn: () => apiClient.attachments.usage(),
    enabled: online,
  });
  const size = formatBytes(usage?.used_bytes);

  useEffect(() => {
    if (!started) return undefined;
    const timer = setTimeout(() => setStarted(false), RESTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [started]);

  const download = () => {
    const a = document.createElement("a");
    a.href = exportDownloadUrl();
    a.download = "";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStarted(true);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Download a copy of everything in Zephyrly as a single .zip file. Keep it as a backup, or open it anywhere.
      </p>

      <Card className="divide-y divide-slate-100 dark:divide-[#303030]">
        {CONTENTS.map(({ icon: Icon, name, text }) => (
          <div key={name} className="flex items-start gap-3 px-4 py-3">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{name}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{text}</p>
            </div>
          </div>
        ))}
      </Card>

      <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Passwords and calendar sign-ins are never included.
      </p>

      <div className="space-y-2">
        <Button
          type="button"
          onClick={download}
          disabled={!online || started}
          data-testid="export-download"
          className="w-full gap-2 bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          <Download className="h-4 w-4" />
          {started ? "Download started" : "Download everything"}
        </Button>
        <p className="text-center text-xs text-slate-400 dark:text-slate-500" aria-live="polite">
          {!online
            ? "You're offline. Exporting needs a connection."
            : started
              ? "Your browser is saving the file. Check your downloads."
              : size
                ? `About ${size}, mostly attachments.`
                : "\u00a0"}
        </p>
      </div>
    </div>
  );
}
