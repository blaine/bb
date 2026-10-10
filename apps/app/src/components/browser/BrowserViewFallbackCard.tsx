import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

export interface BrowserViewFallbackCardProps {
  title: string;
  body: string;
  url: string;
  onRetry: (() => void) | null;
  className?: string;
}

export function BrowserViewFallbackCard({
  title,
  body,
  url,
  onRetry,
  className,
}: BrowserViewFallbackCardProps) {
  const parsedUrl = URL.canParse(url) ? new URL(url) : null;
  const canOpenExternally =
    parsedUrl?.protocol === "https:" || parsedUrl?.protocol === "http:";
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center",
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <Icon name="Globe" className="size-6" aria-hidden />
      </span>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p
        className={cn(
          "max-w-xs text-muted-foreground",
          COARSE_POINTER_TEXT_SM_CLASS,
        )}
      >
        {body}
      </p>
      {url.length > 0 ? (
        <p
          className={cn(
            "max-w-full truncate font-mono text-muted-foreground select-text",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
          title={url}
        >
          {url}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry !== null ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <Icon name="RotateCcw" aria-hidden />
            Try again
          </Button>
        ) : null}
        {url.length > 0 ? (
          <>
            {canOpenExternally ? (
              <Button
                type="button"
                variant={onRetry !== null ? "ghost" : "outline"}
                size="sm"
                onClick={() => openUrlInExternalBrowser(url)}
              >
                <Icon name="ExternalLink" aria-hidden />
                Open in browser
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void copyToClipboardWithToast(url, {
                  successMessage: "Link copied",
                });
              }}
            >
              <Icon name="Copy" aria-hidden />
              Copy link
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
