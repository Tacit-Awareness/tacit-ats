"use client";

import { Input } from "@/components/ui/input";

// The browser's own check for size: past the limit the post would be refused
// before the action could say why.

export function ResumeInput({ maxBytes, accept }: { maxBytes: number; accept: string }) {
  return (
    <Input
      id="resume"
      name="resume"
      type="file"
      accept={accept}
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.setCustomValidity(file && file.size > maxBytes ? `A file is at most ${maxBytes / (1024 * 1024)} MB.` : "");
      }}
    />
  );
}
