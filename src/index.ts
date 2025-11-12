import React from "react";
import { render } from "ink";
import { program } from "commander";
import * as dotenv from "dotenv";
import { GrokAgent } from "./agent/grok-agent.js";
import ChatInterface from "./ui/components/chat-interface.js";
import { getSettingsManager } from "./utils/settings-manager.js";
import { ConfirmationService } from "./utils/confirmation-service.js";
import { createMCPCommand } from "./commands/mcp.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat";
import pkg from "../package.json" with { type: "json" };
import { checkForUpdates } from "./utils/version-checker.js";

// Load environment variables
dotenv.config();

// Disable default SIGINT handling to let Ink handle Ctrl+C
// We'll handle exit through the input system instead

process.on("SIGTERM", () => {
  // Restore terminal to normal mode before exit
  if (process.stdin.isTTY && process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // Ignore errors when setting raw mode
    }
  }
  console.log("\nGracefully shutting down...");
  process.exit(0);
});

// Handle uncaught exceptions to prevent hanging
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Ensure user settings are initialized
function ensureUserSettingsDirectory(): void {
  try {
    const manager = getSettingsManager();
    // This will create default settings if they don't exist
    manager.loadUserSettings();
  } catch {
    // Silently ignore errors during setup
  }
}

// Check for updates at startup (non-blocking)
async function checkStartupUpdates(): Promise<void> {
  try {
    const versionInfo = await checkForUpdates();
    if (versionInfo.isUpdateAvailable) {
      console.log(
        `\n🔄 Update available: v${versionInfo.latest} (current: v${versionInfo.current})`,
      );
      console.log(
        `   Use '/upgrade' command or run: ${versionInfo.updateCommand}\n`,
      );
    }
  } catch {
    // Silently ignore network errors during startup
  }
}

// Load API key from user settings if not in environment
function loadApiKey(): string | undefined {
  const manager = getSettingsManager();
  return manager.getApiKey();
}

// Load base URL from user settings if not in environment
function loadBaseURL(): string {
  const manager = getSettingsManager();
  return manager.getBaseURL();
}

// Save command line settings to user settings file
async function saveCommandLineSettings(
  apiKey?: string,
  baseURL?: string,
): Promise<void> {
  try {
    const manager = getSettingsManager();

    // Update with command line values
    if (apiKey) {
      manager.updateUserSetting("apiKey", apiKey);
      console.log("✅ API key saved to ~/.grok/user-settings.json");
    }
    if (baseURL) {
      manager.updateUserSetting("baseURL", baseURL);
      console.log("✅ Base URL saved to ~/.grok/user-settings.json");
    }
  } catch (error) {
    console.warn(
      "⚠️ Could not save settings to file:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

// Load model from user settings if not in environment
function loadModel(): string | undefined {
  // First check environment variables
  let model = process.env.GROK_MODEL;

  if (!model) {
    // Use the unified model loading from settings manager
    try {
      const manager = getSettingsManager();
      model = manager.getCurrentModel();
    } catch {
      // Ignore errors, model will remain undefined
    }
  }

  return model;
}

// Headless mode processing function
async function processPromptHeadless(
  prompt: string,
  apiKey: string,
  baseURL?: string,
  model?: string,
  maxToolRounds?: number,
): Promise<void> {
  try {
    const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds);

    // Configure confirmation service for headless mode (auto-approve all operations)
    const confirmationService = ConfirmationService.getInstance();
    confirmationService.setSessionFlag("allOperations", true);

    // Process the user message
    const chatEntries = await agent.processUserMessage(prompt);

    // Convert chat entries to OpenAI compatible message objects
    const messages: ChatCompletionMessageParam[] = [];

    for (const entry of chatEntries) {
      switch (entry.type) {
        case "user":
          messages.push({
            role: "user",
            content: entry.content,
          });
          break;

        case "assistant":
          const assistantMessage: ChatCompletionMessageParam = {
            role: "assistant",
            content: entry.content,
          };

          // Add tool calls if present
          if (entry.toolCalls && entry.toolCalls.length > 0) {
            assistantMessage.tool_calls = entry.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
              },
            }));
          }

          messages.push(assistantMessage);
          break;

        case "tool_result":
          if (entry.toolCall) {
            messages.push({
              role: "tool",
              tool_call_id: entry.toolCall.id,
              content: entry.content,
            });
          }
          break;
      }
    }

    // Output each message as a separate JSON object
    for (const message of messages) {
      console.log(JSON.stringify(message));
    }
  } catch (error: any) {
    // Output error in OpenAI compatible format
    console.log(
      JSON.stringify({
        role: "assistant",
        content: `Error: ${error.message}`,
      }),
    );
    process.exit(1);
  }
}

// Main program definition
program
  .name("grok")
  .description(
    "A conversational AI CLI tool powered by Grok with text editor capabilities",
  )
  .version(pkg.version)
  .argument("[message...]", "Initial message to send to Grok")
  .option("-d, --directory <dir>", "set working directory", process.cwd())
  .option("-k, --api-key <key>", "Grok API key (or set GROK_API_KEY env var)")
  .option(
    "-u, --base-url <url>",
    "Grok API base URL (or set GROK_BASE_URL env var)",
  )
  .option(
    "-m, --model <model>",
    "AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var)",
  )
  .option(
    "-p, --prompt <prompt>",
    "process a single prompt and exit (headless mode)",
  )
  .option(
    "--max-tool-rounds <rounds>",
    "maximum number of tool execution rounds (default: 400)",
    "400",
  )
  .option("--force-tty", "Force TTY mode even if not detected (debugging only)")
  .action(async (message, options) => {
    try {
      // Change to specified directory if provided
      if (options.directory && options.directory !== process.cwd()) {
        process.chdir(options.directory);
      }

      // Ensure user settings directory exists
      ensureUserSettingsDirectory();

      // Check for updates in background
      checkStartupUpdates();

      // Load configuration
      const apiKey = options.apiKey || process.env.GROK_API_KEY || loadApiKey();
      const baseURL =
        options.baseUrl || process.env.GROK_BASE_URL || loadBaseURL();
      const model = options.model || loadModel();
      const maxToolRounds = options.maxToolRounds
        ? parseInt(options.maxToolRounds)
        : undefined;

      // Validate API key
      if (!apiKey) {
        console.error(
          "❌ No API key found. Please provide one via:\n" +
            "   - Command line: --api-key <key>\n" +
            "   - Environment: GROK_API_KEY=<key>\n" +
            "   - Settings file: ~/.grok/user-settings.json\n\n" +
            "Get your API key from: https://console.x.ai/",
        );
        process.exit(1);
      }

      // Save API key and base URL to user settings if provided via command line
      if (options.apiKey || options.baseUrl) {
        await saveCommandLineSettings(options.apiKey, options.baseUrl);
      }

      // Check if we're in headless mode
      if (options.prompt) {
        await processPromptHeadless(
          options.prompt,
          apiKey,
          baseURL,
          model,
          maxToolRounds,
        );
        return;
      }

      // Check for TTY requirement (unless forced)
      if (!options.forceTty && !process.stdout.isTTY) {
        console.error(
          "❌ This application requires an interactive terminal (TTY).\n\n" +
            "Solutions:\n" +
            "• Run in a proper terminal emulator\n" +
            '• Use headless mode: grok --prompt "your question"\n' +
            "• Force TTY mode (debugging): grok --force-tty\n\n" +
            "For help: grok --help",
        );
        process.exit(1);
      }

      // Initialize the chat interface
      const initialMessage = message.length > 0 ? message.join(" ") : undefined;

      // Create the agent
      const agent = new GrokAgent(apiKey, baseURL, model, maxToolRounds);

      render(
        React.createElement(ChatInterface, {
          agent,
          initialMessage,
        }),
      );
    } catch (error: any) {
      console.error("❌ Error:", error.message);
      process.exit(1);
    }
  });

// Add MCP command
program.addCommand(createMCPCommand());

// Parse command line arguments
program.parse();
