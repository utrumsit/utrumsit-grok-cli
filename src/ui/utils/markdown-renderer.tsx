import React from "react";
import { Text } from "ink";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";

// Configure marked to use the terminal renderer with no width limits
marked.setOptions({
  renderer: new (TerminalRenderer as any)({
    width: null, // Disable width limits
    reflowText: false, // Don't reflow text
  }),
});

export function MarkdownRenderer({ content }: { content: string }) {
  // Temporarily disable markdown rendering to debug truncation issues
  return <Text>{content}</Text>;
}
