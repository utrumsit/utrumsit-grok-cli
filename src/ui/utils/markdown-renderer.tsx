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
  try {
    // Parse markdown and render it
    const rendered = marked(content);
    return <Text>{rendered}</Text>;
  } catch (error) {
    // Fallback to plain text if markdown parsing fails
    return <Text>{content}</Text>;
  }
}
