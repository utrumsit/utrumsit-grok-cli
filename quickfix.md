# ASCII Art Distortion Quick Fix Plan

## Executive Summary

Post-flicker fix, the welcome screen ASCII art is wrapping incorrectly and layout elements are misaligned. This is caused by overly rigid fixed dimensions from the flicker stabilization. The fix restores responsive sizing while maintaining flicker prevention.

## Problem Analysis

### Observed Issues

1. **ASCII Art Wrapping**: `██████` blocks break across lines instead of staying solid
2. **Context Line Truncation**: "Press Ctrl+ for details" gets cut off
3. **Bullet Point Misalignment**: Quick tips don't align properly
4. **Status Bar Overlap**: Bottom input prompt overlaps content
5. **General Layout**: Elements don't adapt to terminal width

### Root Cause

- Fixed `width={process.stdout.columns}` and `height={process.stdout.rows - 1}` from flicker fix are too rigid
- ASCII art assumes specific terminal width but gets truncated
- Ink's flex layout needs room to breathe for proper wrapping
- No responsive handling for varying terminal sizes

## Implementation Plan (15-20 minutes)

### Priority 1: Responsive ASCII Art (8 minutes)

**Target File**: `src/ui/components/banner.tsx`

1. **Create Responsive Art Component**

   ```typescript
   // Add to banner.tsx
   import { useState, useEffect } from 'react';
   import { Box, Text } from 'ink';

   interface ResponsiveAsciiProps {
     art: string;
     maxWidth?: number;
   }

   const ResponsiveAsciiArt: React.FC<ResponsiveAsciiProps> = ({ art, maxWidth }) => {
     const [terminalWidth, setTerminalWidth] = useState(process.stdout.columns);

     useEffect(() => {
       const handleResize = () => {
         setTerminalWidth(process.stdout.columns);
       };

       // Listen for SIGWINCH (terminal resize)
       process.on('SIGWINCH', handleResize);
       return () => process.off('SIGWINCH', handleResize);
     }, []);

     const lines = art.split('\n');
     const effectiveWidth = maxWidth || terminalWidth - 4; // Account for padding

     return (
       <Box flexDirection="column" width="100%">
         {lines.map((line, index) => {
           if (line.length === 0) return <Text key={index}> </Text>;

           // Truncate long lines, preserve short ones with padding
           const displayLine = line.length > effectiveWidth
             ? line.substring(0, effectiveWidth)
             : line.padEnd(effectiveWidth, ' ');

           return (
             <Text key={index} wrap="truncate">
               {displayLine}
             </Text>
           );
         })}
       </Box>
     );
   };

   // Update main Banner component
   export const Banner: React.FC<BannerProps> = ({ variant = 'default' }) => {
     const asciiArt = getAsciiArt(variant); // Your existing art generation
     const terminalWidth = process.stdout.columns;

     return (
       <Box marginBottom={1} flexShrink={0}>
         <ResponsiveAsciiArt art={asciiArt} maxWidth={Math.min(terminalWidth - 4, 80)} />
       </Box>
     );
   };
   ```

2. **Preserve Memoization**

   ```typescript
   // Keep the React.memo wrapper from flicker fix
   const MemoizedBanner = React.memo(Banner, (prev, next) => {
     return prev.variant === next.variant;
   });

   export default MemoizedBanner;
   ```

### Priority 2: Flexible Root Layout (5 minutes)

**Target File**: `src/ui/app.tsx`

1. **Replace Fixed Dimensions with Flexible Container**

   ```typescript
   // Replace the fixed width/height Box with flexible layout
   function App() {
     return (
       <Box
         flexDirection="column"
         flexGrow={1}
         paddingX={2}
         paddingTop={1}
         minHeight={process.stdout.rows - 3} // Reserve space for input + status
       >
         <AppContent />
       </Box>
     );
   }

   // Ensure content doesn't overflow
   const AppContent: React.FC = () => {
     return (
       <Box flexDirection="column" flexGrow={1} height="100%">
         {/* Banner, chat history, input - all flex children */}
         <Banner />
         <ChatInterface />
       </Box>
     );
   };
   ```

### Priority 3: Fix Context and Tips Layout (5 minutes)

**Target File**: `src/ui/components/chat-interface.tsx`

1. **Wrap Context Line with Proper Sizing**

   ```typescript
   // Around line 115-120, update welcome/context section
   <Box width="100%" flexWrap="wrap" marginBottom={1}>
     <Box flexDirection="row" flexWrap="wrap" width="100%">
       <Text color="yellow">
         Context:{' '}
         <Text color="green">📁 {workspaceFiles} files</Text>{' '}
         <Text color="cyan">💾 {indexSize}</Text>{' '}
         <Text color={restoreColor}>🔄 {restoreState}</Text>{' '}
         <Text color={pressureColor}>🔴 {pressureLevel}</Text>
       </Text>
       <Box flexGrow={1} />
       <Text color="gray" dimColor>
         Press <Text bold>Ctrl+I</Text> for details
       </Text>
     </Box>
   </Box>
   ```

2. **Fix Quick Tips Layout**

   ```typescript
   // Update quick start tips section
   <Box width="100%" marginBottom={2}>
     <Text color="cyan" bold>💡 Quick Start Tips:</Text>
     <Box paddingLeft={2} marginTop={1}>
       <Box marginBottom={0.5}>
         <Text color="white">• </Text>
         <Text color="yellow">Get help:</Text>{' '}
         <Text color="green">Type "/help" for all commands</Text>
       </Box>
       <Box>
         <Text color="white">• </Text>
         <Text color="yellow">Paste code:</Text>{' '}
         <Text color="green">Just paste and I'll analyze it</Text>
       </Box>
     </Box>
   </Box>
   ```

3. **Ensure Input Area Doesn't Overlap**
   ```typescript
   // At bottom of chat-interface, wrap input in fixed-height container
   <Box
     flexDirection="column"
     flexShrink={0}
     borderStyle="single"
     borderColor="gray"
     paddingX={1}
     paddingY={0.5}
     marginTop={1}
     width="100%"
   >
     <Box flexDirection="row" justifyContent="space-between" alignItems="center">
       <Text dimColor>Ask me anything...</Text>
       <Box flexDirection="row">
         <Text dimColor>auto-edit: off (shift + tab)</Text>
         <Text dimColor> ≋ {currentModel}</Text>
         <Text dimColor> Plan Mode: Off</Text>
       </Box>
     </Box>
     <ChatInput />
   </Box>
   ```

### Priority 4: Status Bar Polish (2 minutes)

**Target File**: `src/ui/components/chat-interface.tsx`

1. **Fix Token/Status Display**
   ```typescript
   // Update status bar to prevent overflow
   <Box
     width="100%"
     flexDirection="row"
     justifyContent="space-between"
     paddingTop={1}
     paddingBottom={0.5}
     borderTopStyle="single"
     borderTopColor="gray"
   >
     <Box flexDirection="row" flexWrap="wrap">
       <Text dimColor>🧠 </Text>
       <Text dimColor>{tokenUsage}/{contextLimit} ({usagePercent})</Text>
       <Text dimColor> │ 📁 {fileCount} files │ 💬 {messageCount} msgs</Text>
     </Box>
   </Box>
   ```

## Testing Protocol

### 1. Visual Verification (Immediate)

```bash
bun run dev
```

- **Check**: ASCII art renders as solid blocks, no wrapping
- **Check**: Context line shows full "Press Ctrl+I for details"
- **Check**: Quick tips bullets align properly (2-space indent)
- **Check**: Input prompt has clean border, no overlap
- **Check**: Status bar tokens fit without truncation

### 2. Responsive Testing

```bash
# Test different terminal widths
# Resize terminal to 80 cols (minimum), 120 cols (standard), 200 cols (wide)
# Verify art scales appropriately
```

### 3. Cross-Terminal Validation

- **iTerm2**: Should render perfectly (best Ink support)
- **Terminal.app**: Verify no macOS-specific artifacts
- **VS Code Terminal**: Check integrated terminal behavior
- **Warp**: Modern terminal compatibility

### 4. Edge Cases

- **Very Small Terminal** (<80 cols): Graceful truncation with ellipsis
- **Very Large Terminal** (>200 cols): Art centered, no excessive padding
- **Resize During Session**: Dynamic adaptation without flicker
- **Emoji Rendering**: All icons (📁💾🔄🔴🧠) display correctly

## Success Criteria

- [ ] ASCII art renders as solid blocks (no `██████` wrapping)
- [ ] Context line displays fully: "Press Ctrl+I for details"
- [ ] Quick tips bullets align with 2-space indentation
- [ ] Input prompt has clean single-line border
- [ ] Status bar tokens fit without truncation
- [ ] Responsive: Adapts to terminal resize 80-200 columns
- [ ] No flicker regression from original fix
- [ ] Cross-terminal compatibility (iTerm2, Terminal.app, VS Code)

## Rollback Plan

If layout breaks:

1. Revert `banner.tsx` to pre-responsive version
2. Temporarily disable ASCII art (plain text only)
3. Use fixed-width art for 120-column terminals only

## Implementation Order

1. **ResponsiveAsciiArt component** (banner.tsx) - 8 min
2. **Flexible root layout** (app.tsx) - 5 min
3. **Context/tips layout** (chat-interface.tsx) - 5 min
4. **Status bar polish** (chat-interface.tsx) - 2 min
5. **Testing** - 5 min

## Expected Outcome

Clean, professional welcome screen that adapts to any terminal size while maintaining the flicker fix. ASCII art renders crisply, all text elements align properly, and the layout feels polished and responsive.

---

_Generated: $(date)_  
_Engineer: Quick Fix Plan Complete_  
_Status: Ready for grok-code Implementation_  
_Estimated Time: 15-20 minutes_
