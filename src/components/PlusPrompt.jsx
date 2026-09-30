// @ts-nocheck
/**
 * @file Where a Basic account meets a Plus feature: what it is, and the
 * way to Plus. Calm, one line and a button; never a wall.
 */
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * @param {{ feature: string, detail?: string, className?: string }} props
 *   feature: e.g. "Calendar sync"; detail: one more sentence
 */
export default function PlusPrompt({ feature, detail, className }) {
  return (
    <div
      className={cn("flex items-start gap-3 rounded-xl border border-border-hairline bg-surface-card px-4 py-3", className)}
      data-testid="plus-prompt"
    >
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-medium">{feature}</span> is part of Zephyrly Plus.
          {detail ? ` ${detail}` : ""}
        </p>
        <Button asChild size="sm" variant="outline">
          <Link to="/Settings#plus">See Plus</Link>
        </Button>
      </div>
    </div>
  );
}
