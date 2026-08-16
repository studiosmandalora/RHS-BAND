import { initials } from "../lib/date";
import { cn } from "./ui";

export function Avatar({
  name,
  url,
  size = "md",
  className,
}: {
  name: string;
  url?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    xs: "size-7 text-[10px]",
    sm: "size-9 text-xs",
    md: "size-11 text-sm",
    lg: "size-20 text-xl",
  };
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className={cn(
          "shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10",
          sizes[size],
          className
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-mid font-bold text-white",
        sizes[size],
        className
      )}
    >
      {initials(name || "?")}
    </div>
  );
}